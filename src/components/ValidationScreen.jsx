import { useState } from 'react';
import { formatDate, formatCurrency } from '../lib/formatters.js';

export default function ValidationScreen({ parsedData, settings, onConfirm, onBack }) {
  const [agreed, setAgreed] = useState(false);

  const { fileName } = parsedData;
  const {
    nominalRate, overdraftLimit, currency, columnMapping, resolvedRows,
    openingBalance, periodStart, periodEnd, bankInterestCharged,
  } = settings;
  // Use resolved rows (preamble excluded) if available, fall back to parsedData.rows
  const rows = resolvedRows || parsedData.rows || [];

  // Use explicit period dates from settings
  const startDate = periodStart ? new Date(periodStart) : null;
  const endDate = periodEnd ? new Date(periodEnd) : null;

  return (
    <div>
      <h3 style={{ marginBottom: '20px' }}>Confirm Analysis</h3>
      <p style={{ color: 'var(--color-text-light)', marginBottom: '24px', fontSize: 'var(--font-size-sm)' }}>
        Review the details below before running the overdraft interest verification.
      </p>

      <div className="glass-card" style={{ padding: '28px', marginBottom: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>File</div>
            <div style={{ fontWeight: 700 }}>{fileName}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Rows</div>
            <div style={{ fontWeight: 700 }}>{rows.length.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Analysis Period</div>
            <div style={{ fontWeight: 700 }}>
              {startDate && endDate
                ? `${formatDate(startDate)} — ${formatDate(endDate)}`
                : 'Unable to determine'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Currency</div>
            <div style={{ fontWeight: 700 }}>{currency}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Nominal Rate</div>
            <div style={{ fontWeight: 700 }}>{nominalRate}%</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Overdraft Limit</div>
            <div style={{ fontWeight: 700 }}>{overdraftLimit ? overdraftLimit.toLocaleString() : 'Not specified'}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Opening Cleared Balance</div>
            <div style={{ fontWeight: 700 }}>{formatCurrency(openingBalance, currency)}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Bank Interest Charged</div>
            <div style={{ fontWeight: 700 }}>
              {bankInterestCharged ? formatCurrency(bankInterestCharged, currency) : 'Not specified'}
            </div>
          </div>
        </div>
      </div>

      <div className="checkbox-group" style={{ marginBottom: '24px' }}>
        <input
          type="checkbox"
          id="disclaimer"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
        />
        <label htmlFor="disclaimer">
          I understand that this analysis is for informational purposes only and does not constitute
          financial advice. The results should be verified by a qualified financial professional.
        </label>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button className="btn btn-outline" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={!agreed}>
          Run Analysis
        </button>
      </div>
    </div>
  );
}
