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

  const hasOtherFacility = costRatio && costRatio.otherFacilityInterest > 0;

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

      {/* Cost Breakdown */}
      {costRatio && (
        <div className="breakdown-grid">
          <div className="breakdown-card glass-card">
            <div className="breakdown-value">{formatCurrency(costRatio.overdraftInterest, currency)}</div>
            <div className="breakdown-label">Overdraft Interest</div>
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

      {/* Other-facility interest notice */}
      {hasOtherFacility && (
        <div className="glass-card" style={{ padding: '20px', marginBottom: '24px', borderLeft: '4px solid var(--color-primary)' }}>
          <h4 style={{ marginBottom: '8px' }}>Other Credit Facility Interest</h4>
          <p style={{ color: 'var(--color-text-light)', fontSize: 'var(--font-size-sm)', marginBottom: '8px' }}>
            The statement includes interest charged for another credit facility. This amount is
            <strong> excluded</strong> from the overdraft cost calculation.
          </p>
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--color-text-muted)' }}>
            {formatCurrency(costRatio.otherFacilityInterest, currency)}
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 400, marginLeft: '8px' }}>
              (not included in effective rate)
            </span>
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
            {costRatio.usedValueDates && (
              <span> &middot; Balance weighted by value dates</span>
            )}
          </p>
        </div>
      )}

      {/* Workings */}
      {costRatio && (
        <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px' }}>Workings</h3>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)', marginBottom: '16px' }}>
            Step-by-step derivation of the Effective Annual Rate using the cost-ratio method.
          </p>

          {/* Step 1 — Identify costs */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
              Step 1 &mdash; Identify Costs
            </h4>
            <table style={{ width: '100%', fontSize: 'var(--font-size-sm)' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 0', color: 'var(--color-text-light)' }}>Overdraft Interest</td>
                  <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                    {formatCurrency(costRatio.overdraftInterest, currency)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: 'var(--color-text-light)' }}>Fees</td>
                  <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                    {formatCurrency(costRatio.totalFees, currency)}
                  </td>
                </tr>
                {hasOtherFacility && (
                  <tr>
                    <td style={{ padding: '4px 0', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      Other-facility interest (excluded)
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                      {formatCurrency(costRatio.otherFacilityInterest, currency)}
                    </td>
                  </tr>
                )}
                <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '6px 0 0', fontWeight: 700 }}>Total Cost</td>
                  <td style={{ padding: '6px 0 0', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                    {formatCurrency(costRatio.totalCost, currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Step 2 — Average balance */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
              Step 2 &mdash; Weighted Average Outstanding Balance
            </h4>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)', marginBottom: '4px' }}>
              Each closing balance is weighted by the number of days it was held
              {costRatio.usedValueDates ? ' (using value dates)' : ''}.
            </p>
            <div style={{ fontSize: 'var(--font-size-sm)', fontFamily: 'monospace', fontWeight: 700 }}>
              Avg Balance = {formatCurrency(costRatio.avgBalance, currency)}
            </div>
          </div>

          {/* Step 3 — Period & day-count */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
              Step 3 &mdash; Annualisation Factor
            </h4>
            {(() => {
              const daysInYear = currency === 'KES' ? 365 : 360;
              const convention = currency === 'KES' ? 'Actual / 365' : 'Actual / 360';
              return (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)' }}>
                  <p style={{ marginBottom: '4px' }}>
                    Day-count convention ({currency}): <strong>{convention}</strong>
                  </p>
                  <p style={{ fontFamily: 'monospace' }}>
                    Year Fraction = {formatNumber(costRatio.totalDays)} days &divide; {daysInYear} = {costRatio.yearFraction.toFixed(6)}
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Step 4 — Final computation */}
          <div style={{ marginBottom: nominalRate > 0 ? '20px' : '0' }}>
            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
              Step 4 &mdash; Effective Annual Rate
            </h4>
            <div style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'monospace',
              lineHeight: 1.9,
            }}>
              <div>EAR = (Total Cost &divide; Avg Balance) &divide; Year Fraction &times; 100</div>
              <div style={{ color: 'var(--color-text-light)' }}>
                {'    '}= ({formatCurrency(costRatio.totalCost, currency)} &divide; {formatCurrency(costRatio.avgBalance, currency)}) &divide; {costRatio.yearFraction.toFixed(6)} &times; 100
              </div>
              {costRatio.avgBalance > 0 && (
                <div style={{ color: 'var(--color-text-light)' }}>
                  {'    '}= {(costRatio.totalCost / costRatio.avgBalance).toFixed(6)} &divide; {costRatio.yearFraction.toFixed(6)} &times; 100
                </div>
              )}
              <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                {'    '}= {formatPercent(costRatio.effectiveAPR)}
              </div>
            </div>
          </div>

          {/* Nominal → EAR reference */}
          {nominalRate > 0 && nominalEAR && (
            <div>
              <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
                Reference &mdash; Nominal to EAR Conversion
              </h4>
              <div style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'monospace',
                lineHeight: 1.9,
              }}>
                <div>EAR = (1 + r/n)<sup>n</sup> &minus; 1 &nbsp;&nbsp; where r = nominal rate, n = 12 (monthly compounding)</div>
                <div style={{ color: 'var(--color-text-light)' }}>
                  {'    '}= (1 + {formatPercent(nominalRate)}/12)<sup>12</sup> &minus; 1
                </div>
                <div style={{ color: 'var(--color-text-light)' }}>
                  {'    '}= (1 + {(nominalRate / 100 / 12).toFixed(6)})<sup>12</sup> &minus; 1
                </div>
                <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                  {'    '}= {formatPercent(nominalEAR)}
                </div>
              </div>
            </div>
          )}
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
