import { useState, useEffect, useMemo } from 'react';
import { autoDetectColumns, detectBank, applyMapping, classifyTransactions, classifyWithTemplate, detectBankFromTemplate } from '../lib/statementMapper.js';
import { COLUMN_TYPES, CURRENCIES, KENYA_BANKS } from '../lib/constants.js';
import { fetchBankRates, addBankRate, fetchBankTemplates, saveBankTemplate } from '../lib/auth.js';
import { parseDate, parseNumeric } from '../lib/formatters.js';
import { detectBankInterestCharged } from '../lib/dailyInterestCalculator.js';

export default function StatementPreview({ parsedData, onConfirm }) {
  const { rawRows: originalRawRows, headerRowIndex: initialHeaderRow } = parsedData;

  const [headerRowIdx, setHeaderRowIdx] = useState(initialHeaderRow);
  const [columnMapping, setColumnMapping] = useState({});
  const [nominalRate, setNominalRate] = useState('');
  const [overdraftLimit, setOverdraftLimit] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [detectedBank, setDetectedBank] = useState(null);
  const [selectedBank, setSelectedBank] = useState('');
  const [bankRates, setBankRates] = useState([]);
  const [bankTemplates, setBankTemplates] = useState([]);
  const [matchedTemplate, setMatchedTemplate] = useState(null);
  const [error, setError] = useState('');

  // New fields for daily interest calculation
  const [openingBalance, setOpeningBalance] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [bankInterestCharged, setBankInterestCharged] = useState('');
  const [autoDetectedInterest, setAutoDetectedInterest] = useState(false);
  const [autoDetectedBalance, setAutoDetectedBalance] = useState(false);
  const [balanceWarning, setBalanceWarning] = useState('');

  // Apply template-based transformations to raw rows:
  // - Reverse rows for reverse_chronological templates
  // - Filter out multiPageRepeatRow duplicates
  // - Filter out closingMarkers rows
  const rawRows = useMemo(() => {
    if (!matchedTemplate) return originalRawRows;

    const hIdx = initialHeaderRow;
    const preamble = originalRawRows.slice(0, hIdx + 1);
    let dataRows = originalRawRows.slice(hIdx + 1);

    // Reverse data rows if template says reverse_chronological
    if (matchedTemplate.transactionOrder === 'reverse_chronological') {
      dataRows = [...dataRows].reverse();
    }

    // Filter out multiPageRepeatRow duplicates (keep only first occurrence)
    if (matchedTemplate.multiPageRepeatRow) {
      const marker = matchedTemplate.multiPageRepeatRow.toUpperCase();
      let seen = false;
      dataRows = dataRows.filter(row => {
        const rowText = row.map(c => String(c || '')).join(' ').toUpperCase();
        if (rowText.includes(marker)) {
          if (seen) return false; // Remove duplicate
          seen = true;
        }
        return true;
      });
    }

    // Filter out closingMarkers rows
    const closingMarkers = matchedTemplate.closingMarkers || [];
    if (closingMarkers.length > 0) {
      const markersUpper = closingMarkers.map(m => m.toUpperCase());
      dataRows = dataRows.filter(row => {
        const rowText = row.map(c => String(c || '')).join(' ').toUpperCase();
        return !markersUpper.some(marker => rowText.includes(marker));
      });
    }

    return [...preamble, ...dataRows];
  }, [originalRawRows, matchedTemplate, initialHeaderRow]);

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

  // Fetch bank rates and templates from API on mount
  useEffect(() => {
    fetchBankRates().then(res => {
      if (res.success) setBankRates(res.rates);
    });
    fetchBankTemplates().then(res => {
      if (res.success) setBankTemplates(res.templates);
    });
  }, []);

  // Template detection: run once when templates are loaded
  useEffect(() => {
    if (bankTemplates.length > 0 && !matchedTemplate) {
      const template = detectBankFromTemplate(originalRawRows, initialHeaderRow, bankTemplates);
      if (template) {
        setMatchedTemplate(template);
        if (template.currency) setCurrency(template.currency);
      }
    }
  }, [bankTemplates, originalRawRows, initialHeaderRow]);

  // Re-run auto-detection whenever headers or bankRates change
  useEffect(() => {
    // If a template matched, apply its column mapping instead of auto-detect
    if (matchedTemplate && matchedTemplate.columnMapping) {
      const tplMapping = matchedTemplate.columnMapping;
      // Build mapping from current headers to template types
      const mapping = {};
      for (const h of headers) {
        if (tplMapping[h]) {
          mapping[h] = tplMapping[h];
        }
      }
      // Fill any unmapped headers with auto-detect fallback
      const autoMapping = autoDetectColumns(headers);
      for (const h of headers) {
        if (!mapping[h]) {
          mapping[h] = autoMapping[h] || 'ignore';
        }
      }
      setColumnMapping(mapping);
    } else {
      setColumnMapping(autoDetectColumns(headers));
    }

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
  }, [headers, rows, bankRates, matchedTemplate]);

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
      const classified = matchedTemplate
        ? classifyWithTemplate(mapped, matchedTemplate)
        : classifyTransactions(mapped);
      const detectedInterest = detectBankInterestCharged(classified);
      if (detectedInterest > 0 && !bankInterestCharged) {
        setBankInterestCharged(String(detectedInterest.toFixed(2)));
        setAutoDetectedInterest(true);
      }
    } catch {
      // Silently ignore classification errors during auto-detection
    }

    // Auto-detect opening balance using template method or defaults
    try {
      const descCol = Object.entries(mapping).find(([, t]) => t === 'description')?.[0];
      const balCol = Object.entries(mapping).find(([, t]) => t === 'balance')?.[0];
      const debitCol = Object.entries(mapping).find(([, t]) => t === 'debit')?.[0];
      const creditCol = Object.entries(mapping).find(([, t]) => t === 'credit')?.[0];
      const dateColKey = Object.entries(mapping).find(([, t]) => t === 'date')?.[0];

      if (balCol && !openingBalance) {
        let detected = null;
        const obMethod = matchedTemplate?.openingBalanceMethod || 'auto';
        const obPattern = matchedTemplate?.openingBalancePattern || '';

        if (obMethod === 'preamble' && obPattern) {
          // Scan preamble rows for the opening balance pattern
          const preambleRows = rawRows.slice(0, headerRowIdx);
          const patternUpper = obPattern.toUpperCase();
          for (const row of preambleRows) {
            const rowText = row.map(c => String(c || '')).join(' ');
            if (rowText.toUpperCase().includes(patternUpper)) {
              // Try to extract numeric value from the row
              for (const cell of row) {
                const val = parseNumeric(cell);
                if (val !== 0) {
                  detected = val;
                  break;
                }
              }
              if (detected != null) break;
            }
          }
        }

        if (detected == null && (obMethod === 'brought_forward' || obMethod === 'auto')) {
          // Look for "Brought Forward" / "B/F" / "Opening Balance" rows in data
          if (descCol) {
            const bfPatterns = [/brought?\s*f(or)?w/i, /\bb\.?\/?f\.?\b/i, /opening\s*bal/i, /balance\s*b\.?\/?f/i];
            if (obPattern) {
              bfPatterns.unshift(new RegExp(obPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
            }
            for (const row of rows) {
              const desc = String(row[descCol] || '');
              if (bfPatterns.some(p => p.test(desc))) {
                const bal = parseNumeric(row[balCol]);
                if (bal !== 0) {
                  detected = bal;
                  break;
                }
              }
            }
          }
        }

        // Method: Derive from first dated transaction (balance - credit + debit = opening)
        if (detected == null && (obMethod === 'first_transaction' || obMethod === 'auto') && dateColKey) {
          for (const row of rows) {
            if (!parseDate(row[dateColKey])) continue;
            const bal = parseNumeric(row[balCol]);
            const dr = debitCol ? parseNumeric(row[debitCol]) : 0;
            const cr = creditCol ? parseNumeric(row[creditCol]) : 0;
            if (bal !== 0) {
              detected = bal - cr + dr;
              break;
            }
          }
        }

        if (detected != null && detected !== 0) {
          setOpeningBalance(String(detected));
          setAutoDetectedBalance(true);
        }
      }
    } catch {
      // Silently ignore detection errors
    }
  }, [columnMapping, rows, matchedTemplate]);

  function handleMappingChange(header, type) {
    setColumnMapping(prev => ({ ...prev, [header]: type }));
    // Reset auto-detected values when mapping changes so they re-detect
    setAutoDetectedInterest(false);
    setBankInterestCharged('');
    setAutoDetectedBalance(false);
    setOpeningBalance('');
    setBalanceWarning('');
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

    // Use parseNumeric to handle comma-formatted values (e.g. "-75,286,209.03")
    const parsedBalance = parseNumeric(openingBalance);
    if (!openingBalance && openingBalance !== '0') {
      setError('Please enter the opening cleared balance.');
      return;
    }
    if (parsedBalance === 0 && !/^[\s\-]?0/.test(String(openingBalance).replace(/,/g, ''))) {
      setError('Could not parse the opening balance. Remove any non-numeric characters except minus sign, commas, and decimal point.');
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

    // Cross-validate: check that the entered balance is plausible against the first transaction
    const balCol = Object.entries(columnMapping).find(([, t]) => t === 'balance')?.[0];
    const debitCol = Object.entries(columnMapping).find(([, t]) => t === 'debit')?.[0];
    const creditCol = Object.entries(columnMapping).find(([, t]) => t === 'credit')?.[0];
    const dateColKey = Object.entries(columnMapping).find(([, t]) => t === 'date')?.[0];

    if (balCol && dateColKey) {
      for (const row of rows) {
        if (!parseDate(row[dateColKey])) continue;
        const bal = parseNumeric(row[balCol]);
        const dr = debitCol ? parseNumeric(row[debitCol]) : 0;
        const cr = creditCol ? parseNumeric(row[creditCol]) : 0;
        if (bal !== 0) {
          const implied = bal - cr + dr;
          // If the entered value differs from implied by more than 10×, warn
          if (implied !== 0 && Math.abs(parsedBalance / implied) < 0.1) {
            setBalanceWarning(
              `The entered balance (${parsedBalance.toLocaleString()}) seems far from the expected value (${implied.toLocaleString()}). Please double-check.`
            );
          }
          break;
        }
      }
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

    // If a template was matched, save updated column mapping back to the template
    if (matchedTemplate) {
      try {
        await saveBankTemplate({
          ...matchedTemplate,
          columnMapping,
          columnHeaders: headers,
        });
      } catch {
        // Non-blocking — template update is best-effort
      }
    }

    onConfirm({
      columnMapping,
      nominalRate: parseFloat(nominalRate),
      overdraftLimit: overdraftLimit ? parseFloat(overdraftLimit) : 0,
      currency,
      resolvedHeaders: headers,
      resolvedRows: rows,
      openingBalance: parsedBalance,
      periodStart,
      periodEnd,
      bankInterestCharged: bankInterestCharged ? parseNumeric(bankInterestCharged) : 0,
      matchedTemplate: matchedTemplate || null,
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

      {matchedTemplate && (
        <div className="alert alert-success" style={{ marginBottom: '16px' }}>
          Detected bank: <strong>{matchedTemplate.bankName}</strong> (template-matched)
          {matchedTemplate.transactionOrder === 'reverse_chronological' && ' — rows reversed to chronological order'}
        </div>
      )}

      {detectedBank && !matchedTemplate && (
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
              type="text"
              inputMode="numeric"
              placeholder="e.g. -75,286,209.03"
              value={openingBalance}
              onChange={e => {
                setOpeningBalance(e.target.value);
                setAutoDetectedBalance(false);
                setBalanceWarning('');
              }}
            />
            {autoDetectedBalance && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)', marginTop: '4px', display: 'block' }}>
                Auto-detected from statement. Verify this is correct.
              </span>
            )}
            {balanceWarning && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: '#e67e22', marginTop: '4px', display: 'block' }}>
                {balanceWarning}
              </span>
            )}
            {!autoDetectedBalance && !balanceWarning && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px', display: 'block' }}>
                Enter as negative if overdrawn (e.g. -75,290,000)
              </span>
            )}
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
