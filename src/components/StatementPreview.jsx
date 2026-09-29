import { useState, useEffect, useMemo } from 'react';
import { autoDetectColumns, detectBank } from '../lib/statementMapper.js';
import { COLUMN_TYPES, CURRENCIES, BANK_RATES } from '../lib/constants.js';

export default function StatementPreview({ parsedData, onConfirm }) {
  const { rawRows, headerRowIndex: initialHeaderRow } = parsedData;

  const [headerRowIdx, setHeaderRowIdx] = useState(initialHeaderRow);
  const [columnMapping, setColumnMapping] = useState({});
  const [nominalRate, setNominalRate] = useState('');
  const [overdraftLimit, setOverdraftLimit] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [detectedBank, setDetectedBank] = useState(null);
  const [error, setError] = useState('');

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

  // Re-run auto-detection whenever headers change
  useEffect(() => {
    setColumnMapping(autoDetectColumns(headers));

    const bank = detectBank(rows, headers, BANK_RATES);
    if (bank) {
      setDetectedBank(bank);
      setNominalRate(String(bank.odAPR));
      if (bank.currency) setCurrency(bank.currency);
    } else {
      setDetectedBank(null);
    }
  }, [headers, rows]);

  function handleMappingChange(header, type) {
    setColumnMapping(prev => ({ ...prev, [header]: type }));
  }

  function handleConfirm() {
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
    setError('');
    onConfirm({
      columnMapping,
      nominalRate: parseFloat(nominalRate),
      overdraftLimit: overdraftLimit ? parseFloat(overdraftLimit) : 0,
      currency,
      // Pass the derived headers/rows so downstream gets the right data
      resolvedHeaders: headers,
      resolvedRows: rows,
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

      <button className="btn btn-primary" onClick={handleConfirm}>
        Continue to Confirmation
      </button>
    </div>
  );
}
