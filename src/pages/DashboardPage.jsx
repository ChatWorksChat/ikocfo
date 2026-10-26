import { Link, useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../lib/auth.js';
import { getHistory, canAnalyze } from '../lib/storage.js';
import { formatPercent, formatDate } from '../lib/formatters.js';
import { PLANS } from '../lib/constants.js';

export default function DashboardPage() {
  const user = getCurrentUser();
  const navigate = useNavigate();

  if (!user) return null;

  const history = getHistory(user.email);
  const usage = canAnalyze(user);
  const plan = PLANS[user.plan || 'free'];
  const usageCount = history.length;
  const maxUses = plan.statements === Infinity ? Infinity : plan.statements;
  const usagePercent = maxUses === Infinity ? 0 : Math.min(100, (usageCount / maxUses) * 100);

  return (
    <div className="page-container">
      {/* Welcome */}
      <div className="dashboard-welcome glass-card">
        <div>
          <h1>
            Welcome, {user.firstName || user.companyName || user.email}
          </h1>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <span className={`badge badge-${user.accountType || 'individual'}`}>
              {user.accountType || 'Individual'}
            </span>
            <span className="badge badge-individual">{plan.name} Plan</span>
          </div>
        </div>
        <Link to="/calculator" className="btn btn-primary">
          New Analysis
        </Link>
      </div>

      {/* Usage Meter */}
      <div className="usage-meter glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>
              {maxUses === Infinity
                ? `${usageCount} analyses used`
                : `${usageCount} of ${maxUses} analyses used`}
            </strong>
          </div>
          {!usage.allowed && (
            <Link to="/pricing" className="btn btn-sm btn-secondary">
              Upgrade
            </Link>
          )}
        </div>
        {maxUses !== Infinity && (
          <div className="usage-bar-track">
            <div
              className={`usage-bar-fill${usagePercent >= 100 ? ' exhausted' : ''}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        )}
        {!usage.allowed && (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-secondary)', marginTop: '8px' }}>
            Free tier exhausted. Upgrade to continue analyzing statements.
          </p>
        )}
      </div>

      {/* History */}
      <div className="glass-card" style={{ padding: '28px' }}>
        <h3 style={{ marginBottom: '16px' }}>Analysis History</h3>
        {history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>
            <p>No analyses yet.</p>
            <Link to="/calculator" className="btn btn-primary" style={{ marginTop: '16px' }}>
              Run Your First Analysis
            </Link>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>File</th>
                  <th>Variance %</th>
                  <th>Status</th>
                  <th>Currency</th>
                  <th>Transactions</th>
                </tr>
              </thead>
              <tbody>
                {history.map(entry => {
                  const statusColors = {
                    matches: 'var(--color-success)',
                    review: 'var(--color-warning)',
                    discrepancy: 'var(--color-danger)',
                  };
                  return (
                    <tr key={entry.id}>
                      <td>{formatDate(entry.date)}</td>
                      <td>{entry.fileName}</td>
                      <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                        {entry.variancePercent != null ? formatPercent(entry.variancePercent) : '--'}
                      </td>
                      <td>
                        {entry.status ? (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: '12px',
                            background: statusColors[entry.status] || 'var(--color-text-muted)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 'var(--font-size-xs)',
                            textTransform: 'capitalize',
                          }}>
                            {entry.status}
                          </span>
                        ) : '--'}
                      </td>
                      <td>{entry.currency}</td>
                      <td>{entry.transactionCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
