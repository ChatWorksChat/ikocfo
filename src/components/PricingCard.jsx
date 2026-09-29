export default function PricingCard({ plan, featured, onSubscribe, currentPlan }) {
  const isCurrentPlan = currentPlan === plan.id;
  const currency = plan.currency || 'USD';
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : currency === 'KES' ? 'KSh' : '$';
  const interval = plan.interval || 'month';
  const intervalLabel = interval === 'year' ? '/yr' : '/mo';

  return (
    <div className={`pricing-card glass-card${featured ? ' featured' : ''}`}>
      <div className="pricing-name">{plan.name}</div>
      {plan.description && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
          {plan.description}
        </div>
      )}
      <div className="pricing-price">
        {plan.price === 0 ? 'Free' : `${symbol}${plan.price}`}
        {plan.price > 0 && <span>{intervalLabel}</span>}
      </div>

      <ul className="pricing-features">
        {plan.features && plan.features.length > 0 ? (
          plan.features.map((feature, i) => (
            <li key={i}>
              <span className="check">&#10003;</span>
              {feature}
            </li>
          ))
        ) : (
          <>
            <li>
              <span className="check">&#10003;</span>
              {(plan.statements === Infinity || plan.statements === 0)
                ? 'Unlimited statements'
                : `${plan.statements} statement${plan.statements > 1 ? 's' : ''} ${plan.price > 0 ? '/month' : '(one-time)'}`}
            </li>
            <li>
              <span className="check">&#10003;</span>
              {(plan.maxRows === Infinity || plan.maxRows === 0) ? 'Unlimited rows' : `Up to ${plan.maxRows.toLocaleString()} rows`}
            </li>
            <li>
              {plan.xirr
                ? <><span className="check">&#10003;</span> XIRR method</>
                : <><span className="cross">&#10007;</span> XIRR method</>}
            </li>
            <li>
              {plan.pdfExport
                ? <><span className="check">&#10003;</span> PDF export</>
                : <><span className="cross">&#10007;</span> PDF export</>}
            </li>
            <li><span className="check">&#10003;</span> Cost-ratio analysis</li>
            <li><span className="check">&#10003;</span> Regulatory checks</li>
          </>
        )}
      </ul>

      {isCurrentPlan ? (
        <button className="btn btn-outline" disabled style={{ opacity: 0.6 }}>
          Current Plan
        </button>
      ) : plan.price === 0 ? (
        <button className="btn btn-outline" disabled style={{ opacity: 0.6 }}>
          Default
        </button>
      ) : (
        <button className="btn btn-primary" onClick={() => onSubscribe(plan.id)}>
          Subscribe
        </button>
      )}
    </div>
  );
}
