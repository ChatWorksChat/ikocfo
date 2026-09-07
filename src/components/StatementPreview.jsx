import { useState, useEffect } from 'react';
import { autoDetectColumns } from '../lib/statementMapper.js';
import { COLUMN_TYPES, CURRENCIES } from '../lib/constants.js';

export default function StatementPreview({ parsedData, onConfirm }) {
  const { headers, rows } = parsedData;
  const [columnMapping, setColumnMapping] = useState({});
  const [nominalRate, setNominalRate] = useState('');
  const [overdraftLimit, setOverdraftLimit] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [error, setError] = useState('');

  useEffect(() => {
    setColumnMapping(autoDetectColumns(headers));
  }, [headers]);

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
    });
  }

  const previewRows = rows.slice(0, 10);

  return (
    <div>
      <h3 style={{ marginBottom: '20px' }}>Preview &amp; Map Columns</h3>
      <p style={{ color: 'var(--color-text-light)', marginBottom: '24px', fontSize: 'var(--font-size-sm)' }}>
        Showing first {Math.min(10, rows.length)} of {rows.length} rows. Verify the auto-detected column types and adjust if needed.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="table-wrapper" style={{ marginBottom: '28px' }}>
        <table>
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h}>
                  <div style={{ marginBottom: '6px', fontSize: 'var(--font-size-xs)' }}>{h}</div>
                  <select
                    value={columnMapping[h] || 'ignore'}
                    onChange={(e) => handleMappingChange(h, e.target.value)}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)', minWidth: '100px' }}
                  >
                    {COLUMN_TYPES.map(ct => (
                      <option key={ct.key} value={ct.key}>{ct.label}</option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i}>
                {headers.map(h => (
                  <td key={h}>{row[h] != null ? String(row[h]) : ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
