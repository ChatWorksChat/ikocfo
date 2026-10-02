import { useState, useEffect, useMemo } from 'react';
import { autoDetectColumns, detectBank, applyMapping, classifyTransactions } from '../lib/statementMapper.js';
import { COLUMN_TYPES, CURRENCIES, KENYA_BANKS } from '../lib/constants.js';
import { fetchBankRates, addBankRate } from '../lib/auth.js';
import { parseDate, parseNumeric } from '../lib/formatters.js';
import { detectBankInterestCharged } from '../lib/dailyInterestCalculator.js';

export default function StatementPreview({ parsedData, onConfirm }) {
  const { rawRows, headerRowIndex: initialHeaderRow } = parsedData;

  const [headerRowIdx, setHeaderRowIdx] = useState(initialHeaderRow);
  const [columnMapping, setColumnMapping] = useState({});
  const [nominalRate, setNominalRate] = useState('');
  const [overdraftLimit, setOverdraftLimit] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [detectedBank, setDetectedBank] = useState(null);
  const [selectedBank, setSelectedBank] = useState('');
  const [bankRates, setBankRates] = useState([]);
  const [error, setError] = useState('');

  // New fields for daily interest calculation
  const [openingBalance, setOpeningBalance] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [bankInterestCharged, setBankInterestCharged] = useState('');
  const [autoDetectedInterest, setAutoDetectedInterest] = useState(false);

  // Derive headers and data rows from rawRows + headerRowIdx
  const { headers, rows } = useMemo(() => {
    const headerCells = rawRows[headerRowIdx] || [];
    const h = headerCells.map((cell, i) => {
      const text = String(cell || '').trim();
      return text || `Column ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`;
    });

    const dataRows = rawRows.slice(headerRowIdx + 1).map(row => {
      const obj = {};
      h.forEach((header, i) => {
        obj[header] = row[i] != null ? String(row[i]).trim() : '';
      });
      return obj;
    });

    // Filter out fully empty rows
    const nonEmpty = dataRows.filter(row =>
      Object.values(row).some(v => v !== '')
    );

    return { headers: h, rows: nonEmpty };
  }, [rawRows, headerRowIdx]);

  // Fetch bank rates from API on mount
  useEffect(() => {
    fetchBankRates().then(res => {
      if (res.success) setBankRates(res.rates);
    });
  }, []);

  // Re-run auto-detection whenever headers or bankRates change
  useEffect(() => {
    setColumnMapping(autoDetectColumns(headers));

    if (bankRates.length > 0) {
      const bank = detectBank(rows, headers, bankRates);
      if (bank) {
        setDetectedBank(bank);
        setSelectedBank(bank.id);
        setNominalRate(String(bank.odAPR));
        if (bank.currency) setCurrency(bank.currency);
      } else {
        setDetectedBank(null);
      }
    }
  }, [headers, rows, bankRates]);

  // Auto-detect period dates, bank interest charged when column mapping changes
  useEffect(() => {
    const mapping = columnMapping;
    if (!mapping || Object.keys(mapping).length === 0) return;

    // Derive period date range from parsed dates
    const dateCol = Object.entries(mapping).find(([, t]) => t === 'date')?.[0];
    if (dateCol) {
      const dates = rows
        .map(r => parseDate(r[dateCol]))
        .filter(d => d !== null)
        .sort((a, b) => a - b);
      if (dates.length > 0) {
        const start = dates[0];
        const end = dates[dates.length - 1];
        // Format as YYYY-MM-DD for date input
        const fmt = (d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };
        if (!periodStart) setPeriodStart(fmt(start));
        if (!periodEnd) setPeriodEnd(fmt(end));
      }
    }

    // Auto-detect bank interest charged from classified transactions
    try {
      const mapped = applyMapping(rows, mapping);
      const classified = classifyTransactions(mapped);
      const detectedInterest = detectBankInterestCharged(classified);
      if (detectedInterest > 0 && !bankInterestCharged) {
        setBankInterestCharged(String(detectedInterest.toFixed(2)));
        setAutoDetectedInterest(true);
      }
    } catch {
      // Silently ignore classification errors during auto-detection
    }
  }, [columnMapping, rows]);

  function handleMappingChange(header, type) {
    setColumnMapping(prev => ({ ...prev, [header]: type }));
    // Reset auto-detected interest when mapping changes so it re-detects
    setAutoDetectedInterest(false);
    setBankInterestCharged('');
  }

  async function handleConfirm() {
    const mappedTypes = Object.values(columnMapping);
    if (!mappedTypes.includes('date')) {
      setError('Please map at least one column as Date.');
      return;
    }
    if (!mappedTypes.includes('balance') && !mappedTypes.includes('debit') && !mappedTypes.includes('credit')) {
      setError('Please map at least a Balance, Debit, or Credit column.');
      return;
    }
    if (!nominalRate || parseFloat(nominalRate) <= 0) {
      setError('Please enter a valid nominal interest rate.');
      return;
    }
    if (!openingBalance && openingBalance !== '0') {
      setError('Please enter the opening cleared balance.');
      return;
    }
    if (!periodStart || !periodEnd) {
      setError('Please enter the analysis period start and end dates.');
      return;
    }
    if (new Date(periodStart) >= new Date(periodEnd)) {
      setError('Period start date must be before end date.');
      return;
    }
    setError('');

    // If a bank is selected but has no rate record yet, auto-create it
    if (selectedBank && selectedBank.startsWith('new:')) {
      const bankName = selectedBank.replace('new:', '');
      const kenyaBank = KENYA_BANKS.find(b => b.name === bankName);
      await addBankRate({
        name: bankName,
        odAPR: parseFloat(nominalRate),
        currency,
        country: 'Kenya',
        aliases: [bankName],
        type: kenyaBank?.type || 'commercial',
      });
    }

    onConfirm({
      columnMapping,
      nominalRate: parseFloat(nominalRate),
      overdraftLimit: overdraftLimit ? parseFloat(overdraftLimit) : 0,
      currency,
      resolvedHeaders: headers,
      resolvedRows: rows,
      openingBalance: parseFloat(openingBalance),
      periodStart,
      periodEnd,
      bankInterestCharged: bankInterestCharged ? parseFloat(bankInterestCharged) : 0,
    });
  }

  // For the preview table, show a limited view
  const preambleRows = rawRows.slice(0, headerRowIdx);
  const previewDataRows = rows.slice(0, 10);
  const totalDataRows = rows.length;

  return (
    <div>
      <h3 style={{ marginBottom: '20px' }}>Preview &amp; Map Columns</h3>
      <p style={{ color: 'var(--color-text-light)', marginBottom: '16px', fontSize: 'var(--font-size-sm)' }}>
        The header row is highlighted in purple. Rows above it are statement preamble and will be excluded from the analysis. Adjust if needed.
      </p>

      {detectedBank && (
        <div className="alert alert-success" style={{ marginBottom: '16px' }}>
          Detected bank: <strong>{detectedBank.name}</strong> — nominal OD rate pre-filled at {detectedBank.odAPR}%.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* Header row selector */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        marginBottom: '16px', padding: '12px 16px',
        background: 'rgba(132, 88, 163, 0.06)', borderRadius: 'var(--radius-sm)',
        border: '1px solid rgba(132, 88, 163, 0.15)',
        fontSize: 'var(--font-size-sm)',
      }}>
        <span style={{ fontWeight: 600 }}>Data starts at row:</span>
        <button
          className="btn btn-sm btn-outline"
          disabled={headerRowIdx <= 0}
          onClick={() => setHeaderRowIdx(prev => Math.max(0, prev - 1))}
          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
        >
          &uarr;
        </button>
        <span style={{ fontWeight: 700, minWidth: '24px', textAlign: 'center' }}>
          {headerRowIdx + 1}
        </span>
        <button
          className="btn btn-sm btn-outline"
          disabled={headerRowIdx >= rawRows.length - 2}
          onClick={() => setHeaderRowIdx(prev => Math.min(rawRows.length - 2, prev + 1))}
          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
        >
          &darr;
        </button>
        <span style={{ color: 'var(--color-text-muted)' }}>
          ({totalDataRows} data rows below header)
        </span>
      </div>

      <div className="table-wrapper" style={{ marginBottom: '28px' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          {/* Preamble rows — greyed out, no column mapping */}
          {preambleRows.length > 0 && (
            <tbody>
              {preambleRows.map((row, i) => (
                <tr
                  key={`pre-${i}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setHeaderRowIdx(i)}
                  title={`Click to set row ${i + 1} as the header row`}
                >
                  <td style={{
                    padding: '4px 8px', fontSize: '0.7rem', color: 'var(--color-text-muted)',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'rgba(0,0,0,0.02)', fontWeight: 600, width: '30px', textAlign: 'center',
                  }}>
                    {i + 1}
                  </td>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{
                      padding: '4px 10px', fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)', background: 'rgba(0,0,0,0.02)',
                      borderBottom: '1px solid var(--color-border)',
                      borderLeft: ci > 0 ? '1px solid var(--color-border)' : 'none',
                      fontStyle: 'italic',
                    }}>
                      {String(cell || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}

          {/* Header row — column mapping dropdowns */}
          <thead>
            <tr>
              <th style={{
                padding: '8px',
                borderBottom: '3px solid var(--color-primary)',
                background: 'rgba(132, 88, 163, 0.1)',
                fontSize: '0.7rem', fontWeight: 700, width: '30px', textAlign: 'center',
                verticalAlign: 'bottom',
              }}>
                {headerRowIdx + 1}
              </th>
              {headers.map((h, idx) => {
                const mapped = columnMapping[h] || 'ignore';
                const typeColor = mapped === 'date' ? '#8458a3'
                  : mapped === 'balance' ? '#2980b9'
                  : mapped === 'debit' ? '#e74c3c'
                  : mapped === 'credit' ? '#27ae60'
                  : mapped === 'description' ? '#f39c12'
                  : mapped === 'amount' ? '#2980b9'
                  : mapped === 'valueDate' ? '#8458a3'
                  : mapped === 'interest' ? '#e67e22'
                  : mapped === 'fees' ? '#e67e22'
                  : 'transparent';
                return (
                  <th key={idx} style={{
                    borderLeft: idx > 0 ? '1px solid var(--color-border)' : 'none',
                    borderBottom: `3px solid ${typeColor}`,
                    verticalAlign: 'bottom',
                    background: 'rgba(132, 88, 163, 0.1)',
                  }}>
                    <div style={{ marginBottom: '6px', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{h}</div>
                    <select
                      value={mapped}
                      onChange={(e) => handleMappingChange(h, e.target.value)}
                      className="form-input"
                      style={{
                        padding: '4px 8px',
                        fontSize: 'var(--font-size-xs)',
                        minWidth: '100px',
                        borderColor: typeColor !== 'transparent' ? typeColor : undefined,
                      }}
                    >
                      {COLUMN_TYPES.map(ct => (
                        <option key={ct.key} value={ct.key}>{ct.label}</option>
                      ))}
                    </select>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Data rows */}
          <tbody>
            {previewDataRows.map((row, i) => (
              <tr key={i}>
                <td style={{
                  padding: '4px 8px', fontSize: '0.7rem', color: 'var(--color-text-muted)',
                  borderBottom: '1px solid var(--color-border)',
                  textAlign: 'center', fontWeight: 600,
                }}>
                  {headerRowIdx + 2 + i}
                </td>
                {headers.map((h, idx) => (
                  <td key={idx} style={{
                    borderLeft: idx > 0 ? '1px solid var(--color-border)' : 'none',
                  }}>{row[h] != null ? String(row[h]) : ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginTop: '-20px', marginBottom: '24px' }}>
        Showing {Math.min(10, totalDataRows)} of {totalDataRows} data rows. {preambleRows.length > 0 ? `${preambleRows.length} preamble row(s) excluded.` : ''}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="form-group">
          <label className="form-label">Bank</label>
          <select
            className="form-input"
            value={selectedBank}
            onChange={e => {
              const val = e.target.value;
              setSelectedBank(val);
              // If selecting an existing bank rate, pre-fill the OD rate
              if (val && !val.startsWith('new:')) {
                const rate = bankRates.find(r => r.id === val);
                if (rate) {
                  setNominalRate(String(rate.odAPR));
                  if (rate.currency) setCurrency(rate.currency);
                }
              }
            }}
          >
            <option value="">— Select bank (optional) —</option>
            {bankRates.length > 0 && (
              <optgroup label="Banks with OD rates">
                {bankRates.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.odAPR}%)</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Add new bank">
              {KENYA_BANKS
                .filter(b => !bankRates.some(r => r.name === b.name))
                .map(b => (
                  <option key={b.name} value={`new:${b.name}`}>{b.name}</option>
                ))
              }
            </optgroup>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Nominal Interest Rate (%)</label>
          <input
            className="form-input"
            type="number"
            step="0.01"
            placeholder="e.g. 14.5"
            value={nominalRate}
            onChange={e => setNominalRate(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Overdraft Limit</label>
          <input
            className="form-input"
            type="number"
            step="0.01"
            placeholder="e.g. 1000000"
            value={overdraftLimit}
            onChange={e => setOverdraftLimit(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Currency</label>
          <select
            className="form-input"
            value={currency}
            onChange={e => setCurrency(e.target.value)}
          >
            {Object.values(CURRENCIES).map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Daily Interest Verification Inputs */}
      <div style={{
        padding: '20px', marginBottom: '24px',
        background: 'rgba(132, 88, 163, 0.04)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid rgba(132, 88, 163, 0.12)',
      }}>
        <h4 style={{ marginBottom: '4px', fontSize: 'var(--font-size-sm)', fontWeight: 700 }}>
          Interest Verification Inputs
        </h4>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '16px' }}>
          Required for daily interest reconstruction. Period dates are auto-detected from the statement.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">Period Start Date</label>
            <input
              className="form-input"
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Period End Date</label>
            <input
              className="form-input"
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Opening Cleared Balance</label>
            <input
              className="form-input"
              type="number"
              step="0.01"
              placeholder="e.g. -75290000"
              value={openingBalance}
              onChange={e => setOpeningBalance(e.target.value)}
            />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px', display: 'block' }}>
              Enter as negative if overdrawn (e.g. -75,290,000)
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Bank Interest Charged</label>
            <input
              className="form-input"
              type="number"
              step="0.01"
              placeholder="e.g. 1087813.65"
              value={bankInterestCharged}
              onChange={e => {
                setBankInterestCharged(e.target.value);
                setAutoDetectedInterest(false);
              }}
            />
            {autoDetectedInterest && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)', marginTop: '4px', display: 'block' }}>
                Auto-detected from OD interest transactions. You can edit this value.
              </span>
            )}
          </div>
        </div>
      </div>

      {selectedBank && selectedBank.startsWith('new:') && nominalRate && (
        <div className="alert alert-success" style={{ marginBottom: '16px', fontSize: 'var(--font-size-sm)' }}>
          The OD rate for <strong>{selectedBank.replace('new:', '')}</strong> will be saved automatically when you run the analysis.
        </div>
      )}

      <button className="btn btn-primary" onClick={handleConfirm}>
        Continue to Confirmation
      </button>
    </div>
  );
}
