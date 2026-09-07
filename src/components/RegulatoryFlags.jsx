export default function RegulatoryFlags({ flags }) {
  if (!flags || flags.length === 0) {
    return (
      <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '12px' }}>Regulatory Checks</h3>
        <div className="flag-item info">
          <span className="flag-icon">&#9989;</span>
          <div>
            <strong>All Clear</strong>
            <p style={{ marginTop: '4px', color: 'var(--color-text-light)' }}>
              No regulatory concerns were detected in this statement.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const iconMap = {
    danger: '\u26D4',
    warning: '\u26A0\uFE0F',
    info: '\u2139\uFE0F',
  };

  return (
    <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
      <h3 style={{ marginBottom: '16px' }}>Regulatory Flags</h3>
      <div className="flag-list">
        {flags.map((flag, i) => (
          <div key={i} className={`flag-item ${flag.severity}`}>
            <span className="flag-icon">{iconMap[flag.severity] || '\u2139\uFE0F'}</span>
            <div>
              <strong>{flag.title}</strong>
              <p style={{ marginTop: '4px', color: 'var(--color-text-light)' }}>
                {flag.message}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
