import { formatPercent, formatCurrency, formatNumber, formatDateRange } from '../lib/formatters.js';

export default function CalculationResults({ results }) {
  if (!results || results.error) {
    return (
      <div className="alert alert-error">
        {results?.error || 'Calculation failed. Please check your data and try again.'}
      </div>
    );
  }

  const { effectiveAPR, costRatio, xirr, nominalEAR, currency, nominalRate } = results;

  const nominalWidth = nominalRate && effectiveAPR
    ? Math.min(95, Math.max(5, (nominalRate / Math.max(effectiveAPR, nominalRate)) * 100))
    : 50;
  const effectiveWidth = 100 - nominalWidth;

  return (
    <div>
      {/* Primary metric */}
      <div className="result-hero glass-card">
        <div className="result-label">Effective Annual Rate</div>
        <div className="result-apr">{formatPercent(effectiveAPR)}</div>
        {nominalRate && (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '8px' }}>
            vs. Nominal Rate: {formatPercent(nominalRate)}
            {nominalEAR && ` (EAR: ${formatPercent(nominalEAR)})`}
          </div>
        )}

        {/* Comparison bar */}
        {nominalRate > 0 && effectiveAPR > 0 && (
          <div className="comparison-bar">
            <div
              className="comparison-segment"
              style={{ width: `${nominalWidth}%`, background: 'var(--color-primary-light)' }}
            >
              Nominal {formatPercent(nominalRate)}
            </div>
            <div
              className="comparison-segment"
              style={{
                width: `${effectiveWidth}%`,
                background: effectiveAPR > nominalRate ? 'var(--color-secondary)' : 'var(--color-success)'
              }}
            >
              Effective {formatPercent(effectiveAPR)}
            </div>
          </div>
        )}
      </div>

      {/* Breakdown */}
      {costRatio && (
        <div className="breakdown-grid">
          <div className="breakdown-card glass-card">
            <div className="breakdown-value">{formatCurrency(costRatio.totalInterest, currency)}</div>
            <div className="breakdown-label">Total Interest</div>
          </div>
          <div className="breakdown-card glass-card">
            <div className="breakdown-value">{formatCurrency(costRatio.totalFees, currency)}</div>
            <div className="breakdown-label">Total Fees</div>
          </div>
          <div className="breakdown-card glass-card">
            <div className="breakdown-value">{formatCurrency(costRatio.totalCost, currency)}</div>
            <div className="breakdown-label">Total Cost</div>
          </div>
          <div className="breakdown-card glass-card">
            <div className="breakdown-value">{formatCurrency(costRatio.avgBalance, currency)}</div>
            <div className="breakdown-label">Avg. Outstanding Balance</div>
          </div>
        </div>
      )}

      {/* Methods table */}
      <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>Calculation Methods</h3>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Result</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Cost-Ratio Method</td>
                <td>{costRatio ? formatPercent(costRatio.effectiveAPR) : '--'}</td>
                <td>{costRatio ? 'Computed' : 'N/A'}</td>
              </tr>
              <tr>
                <td>XIRR Method</td>
                <td>{xirr?.rate != null ? formatPercent(xirr.rate) : '--'}</td>
                <td>
                  {xirr
                    ? xirr.converged
                      ? 'Converged'
                      : xirr.error || 'Did not converge'
                    : 'Not included'}
                </td>
              </tr>
              {nominalEAR && (
                <tr>
                  <td>Nominal to EAR</td>
                  <td>{formatPercent(nominalEAR)}</td>
                  <td>Reference</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Period info */}
      {costRatio && (
        <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px' }}>Period Details</h3>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)' }}>
            Date Range: {formatDateRange(costRatio.startDate, costRatio.endDate)} &middot;{' '}
            {formatNumber(costRatio.totalDays)} days &middot;{' '}
            {formatNumber(results.transactionCount)} transactions
          </p>
        </div>
      )}

      {/* CTA */}
      <div className="glass-card" style={{ padding: '28px', textAlign: 'center' }}>
        <h3 style={{ marginBottom: '8px' }}>Need Expert Analysis?</h3>
        <p style={{ color: 'var(--color-text-light)', marginBottom: '16px', fontSize: 'var(--font-size-sm)' }}>
          Book a consultation with IKO CFO for a detailed review of your overdraft costs
          and strategies to reduce them.
        </p>
        <a
          href="https://ikocfo.com"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary"
        >
          Book a Consultation
        </a>
      </div>
    </div>
  );
}
