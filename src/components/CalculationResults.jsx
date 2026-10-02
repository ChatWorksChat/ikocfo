import { useState } from 'react';
import { formatPercent, formatCurrency, formatNumber, formatDate, formatDateRange } from '../lib/formatters.js';

const STATUS_CONFIG = {
  matches: {
    label: 'Matches',
    color: '#27ae60',
    bg: 'rgba(39, 174, 96, 0.08)',
    border: 'rgba(39, 174, 96, 0.3)',
    description: 'The bank\'s interest charge is consistent with the independently calculated amount.',
  },
  review: {
    label: 'Review',
    color: '#f39c12',
    bg: 'rgba(243, 156, 18, 0.08)',
    border: 'rgba(243, 156, 18, 0.3)',
    description: 'There is a moderate variance between the bank\'s charge and the calculated interest. Worth investigating.',
  },
  discrepancy: {
    label: 'Discrepancy',
    color: '#e74c3c',
    bg: 'rgba(231, 76, 60, 0.08)',
    border: 'rgba(231, 76, 60, 0.3)',
    description: 'A significant difference exists between the bank\'s charge and the independently calculated interest.',
  },
};

export default function CalculationResults({ results }) {
  const [showDailyTable, setShowDailyTable] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);

  if (!results || results.error) {
    return (
      <div className="alert alert-error">
        {results?.error || 'Calculation failed. Please check your data and try again.'}
      </div>
    );
  }

  const { dailyInterest, costRatio, xirr, nominalEAR, currency, nominalRate } = results;

  // If daily interest is available, show the verification view
  if (dailyInterest) {
    return (
      <DailyInterestView
        di={dailyInterest}
        currency={currency}
        nominalRate={nominalRate}
        nominalEAR={nominalEAR}
        costRatio={costRatio}
        xirr={xirr}
        showDailyTable={showDailyTable}
        setShowDailyTable={setShowDailyTable}
        showSecondary={showSecondary}
        setShowSecondary={setShowSecondary}
      />
    );
  }

  // Fallback: legacy cost-ratio view (when daily interest inputs were not provided)
  return <LegacyView results={results} />;
}

function DailyInterestView({
  di, currency, nominalRate, nominalEAR,
  costRatio, xirr,
  showDailyTable, setShowDailyTable,
  showSecondary, setShowSecondary,
}) {
  const statusCfg = STATUS_CONFIG[di.status] || STATUS_CONFIG.review;

  return (
    <div>
      {/* Hero section: Status badge */}
      <div className="result-hero glass-card" style={{
        borderLeft: `5px solid ${statusCfg.color}`,
        background: statusCfg.bg,
      }}>
        <div style={{
          display: 'inline-block',
          padding: '6px 18px',
          borderRadius: '20px',
          background: statusCfg.color,
          color: '#fff',
          fontWeight: 700,
          fontSize: 'var(--font-size-sm)',
          letterSpacing: '0.5px',
          marginBottom: '12px',
        }}>
          {statusCfg.label}
        </div>

        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)', marginBottom: '16px' }}>
          {statusCfg.description}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Variance</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: statusCfg.color, fontFamily: 'monospace' }}>
              {di.variance >= 0 ? '+' : ''}{formatCurrency(di.variance, currency)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Variance %</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: statusCfg.color }}>
              {di.variancePercent >= 0 ? '+' : ''}{formatPercent(di.variancePercent)}
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown cards */}
      <div className="breakdown-grid">
        <div className="breakdown-card glass-card">
          <div className="breakdown-value">{formatCurrency(di.expectedInterest, currency)}</div>
          <div className="breakdown-label">Expected OD Interest</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Independently calculated
          </div>
        </div>
        <div className="breakdown-card glass-card">
          <div className="breakdown-value">{formatCurrency(di.bankInterestCharged, currency)}</div>
          <div className="breakdown-label">Bank Interest Charged</div>
        </div>
        <div className="breakdown-card glass-card">
          <div className="breakdown-value">{formatCurrency(di.avgDailyODBalance, currency)}</div>
          <div className="breakdown-label">Avg Daily OD Balance</div>
        </div>
        <div className="breakdown-card glass-card">
          <div className="breakdown-value">{formatCurrency(di.maxODBalance, currency)}</div>
          <div className="breakdown-label">Maximum Overdraft Used</div>
        </div>
        <div className="breakdown-card glass-card">
          <div className="breakdown-value">{formatNumber(di.daysInOverdraft)} / {formatNumber(di.totalDays)}</div>
          <div className="breakdown-label">Days in Overdraft</div>
        </div>
        <div className="breakdown-card glass-card">
          <div className="breakdown-value">{formatPercent(di.annualRate)}</div>
          <div className="breakdown-label">Annual Rate ({di.dayCountBasis})</div>
        </div>
      </div>

      {/* Workings section */}
      <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>Workings</h3>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)', marginBottom: '16px' }}>
          Step-by-step derivation of the expected overdraft interest using daily balance reconstruction.
        </p>

        {/* Step 1: Opening balance */}
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
            Step 1 — Opening Balance
          </h4>
          <table style={{ width: '100%', fontSize: 'var(--font-size-sm)' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 0', color: 'var(--color-text-light)' }}>User-entered opening balance</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCurrency(di.adjustedOpeningBalance - di.backValuedAdjustment, currency)}
                </td>
              </tr>
              {di.backValuedAdjustment !== 0 && (
                <tr>
                  <td style={{ padding: '4px 0', color: 'var(--color-text-light)' }}>Back-valued adjustment</td>
                  <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                    {di.backValuedAdjustment >= 0 ? '+' : ''}{formatCurrency(di.backValuedAdjustment, currency)}
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '6px 0 0', fontWeight: 700 }}>Adjusted opening balance</td>
                <td style={{ padding: '6px 0 0', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                  {formatCurrency(di.adjustedOpeningBalance, currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Step 2: Daily interest formula */}
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
            Step 2 — Daily Interest Formula
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
            <div>For each day where closing balance is negative (overdrawn):</div>
            <div style={{ color: 'var(--color-text-light)' }}>
              {'  '}OD Balance = |Closing Balance|
            </div>
            <div style={{ color: 'var(--color-text-light)' }}>
              {'  '}Daily Interest = OD Balance &times; ({formatPercent(di.annualRate)} / 100) / {di.dailySchedule[0]?.denominator || 365}
            </div>
          </div>
        </div>

        {/* Step 3: Summation */}
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
            Step 3 — Summation
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
            <div>Sum of daily interest over {formatNumber(di.totalDays)} days ({formatNumber(di.daysInOverdraft)} in overdraft):</div>
            <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
              {'  '}Expected Interest = {formatCurrency(di.expectedInterest, currency)}
            </div>
          </div>
        </div>

        {/* Step 4: Comparison */}
        <div>
          <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, marginBottom: '8px', color: 'var(--color-primary)' }}>
            Step 4 — Comparison with Bank Charge
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
            <div>Bank Interest Charged: {formatCurrency(di.bankInterestCharged, currency)}</div>
            <div>Expected Interest:{'     '}{formatCurrency(di.expectedInterest, currency)}</div>
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '4px', marginTop: '4px' }}>
              <span style={{ fontWeight: 700, color: STATUS_CONFIG[di.status]?.color }}>
                Variance: {di.variance >= 0 ? '+' : ''}{formatCurrency(di.variance, currency)} ({di.variancePercent >= 0 ? '+' : ''}{formatPercent(di.variancePercent)})
              </span>
            </div>
          </div>
        </div>

        {/* Data quality notes */}
        {(di.missingValueDateCount > 0 || di.excludedFutureCount > 0) && (
          <div style={{ marginTop: '16px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {di.missingValueDateCount > 0 && (
              <p>{formatNumber(di.missingValueDateCount)} transaction(s) had no value date — posting date was used instead.</p>
            )}
            {di.excludedFutureCount > 0 && (
              <p>{formatNumber(di.excludedFutureCount)} future-dated transaction(s) were excluded from the analysis.</p>
            )}
          </div>
        )}
      </div>

      {/* Daily Audit Table */}
      <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowDailyTable(!showDailyTable)}
        >
          <h3 style={{ marginBottom: 0 }}>Daily Audit Schedule</h3>
          <button
            className="btn btn-sm btn-outline"
            style={{ fontSize: 'var(--font-size-xs)' }}
          >
            {showDailyTable ? 'Collapse' : 'Expand'} ({formatNumber(di.dailySchedule.length)} days)
          </button>
        </div>

        {showDailyTable && (
          <div className="table-wrapper" style={{ marginTop: '16px' }}>
            <table style={{ fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Opening Bal</th>
                  <th style={{ textAlign: 'right' }}>Credits</th>
                  <th style={{ textAlign: 'right' }}>Debits</th>
                  <th style={{ textAlign: 'right' }}>Closing Bal</th>
                  <th style={{ textAlign: 'right' }}>OD Balance</th>
                  <th style={{ textAlign: 'right' }}>Rate %</th>
                  <th style={{ textAlign: 'right' }}>Denom</th>
                  <th style={{ textAlign: 'right' }}>Daily Interest</th>
                </tr>
              </thead>
              <tbody>
                {di.dailySchedule.map(day => {
                  const hasOD = day.odBalance > 0;
                  const rowStyle = hasOD ? { background: 'rgba(231, 76, 60, 0.04)' } : {};
                  return (
                    <tr key={day.date} style={rowStyle}>
                      <td style={{ fontFamily: 'monospace' }}>{day.date}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatCurrency(day.openingBalance, currency)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: day.credits > 0 ? '#27ae60' : undefined }}>
                        {day.credits > 0 ? formatCurrency(day.credits, currency) : '--'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: day.debits > 0 ? '#e74c3c' : undefined }}>
                        {day.debits > 0 ? formatCurrency(day.debits, currency) : '--'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                        {formatCurrency(day.closingBalance, currency)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: hasOD ? 700 : 400, color: hasOD ? '#e74c3c' : undefined }}>
                        {hasOD ? formatCurrency(day.odBalance, currency) : '--'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        {hasOD ? formatPercent(day.rate) : '--'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        {hasOD ? day.denominator : '--'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: hasOD ? 600 : 400 }}>
                        {hasOD ? formatCurrency(day.dailyInterest, currency) : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 700 }}>
                  <td>Totals</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {formatCurrency(di.dailySchedule.reduce((s, d) => s + d.credits, 0), currency)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {formatCurrency(di.dailySchedule.reduce((s, d) => s + d.debits, 0), currency)}
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--color-primary)' }}>
                    {formatCurrency(di.expectedInterest, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Secondary methods (collapsible) */}
      {(costRatio || xirr) && (
        <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setShowSecondary(!showSecondary)}
          >
            <h3 style={{ marginBottom: 0 }}>
              Reference Methods
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: '8px' }}>
                (Reference Only)
              </span>
            </h3>
            <button className="btn btn-sm btn-outline" style={{ fontSize: 'var(--font-size-xs)' }}>
              {showSecondary ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {showSecondary && (
            <div style={{ marginTop: '16px' }}>
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
                      <td>{costRatio ? 'Reference' : 'N/A'}</td>
                    </tr>
                    <tr>
                      <td>XIRR Method</td>
                      <td>{xirr?.rate != null ? formatPercent(xirr.rate) : '--'}</td>
                      <td>
                        {xirr
                          ? xirr.converged
                            ? 'Reference'
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
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                These methods use different approaches and are provided for reference only.
                The daily interest reconstruction above is the primary verification method.
              </p>
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

/**
 * Fallback legacy view when daily interest inputs are not available.
 */
function LegacyView({ results }) {
  const { costRatio, xirr, nominalEAR, currency, nominalRate } = results;
  const effectiveAPR = costRatio?.effectiveAPR;

  return (
    <div>
      {/* Primary metric */}
      <div className="result-hero glass-card">
        <div className="result-label">Effective Annual Rate (Cost-Ratio)</div>
        <div className="result-apr">{formatPercent(effectiveAPR)}</div>
        {nominalRate && (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '8px' }}>
            vs. Nominal Rate: {formatPercent(nominalRate)}
            {nominalEAR && ` (EAR: ${formatPercent(nominalEAR)})`}
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
