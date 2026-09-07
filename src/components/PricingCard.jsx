export default function PricingCard({ plan, featured, onSubscribe, currentPlan }) {
  const isCurrentPlan = currentPlan === plan.id;

  return (
    <div className={`pricing-card glass-card${featured ? ' featured' : ''}`}>
      <div className="pricing-name">{plan.name}</div>
      <div className="pricing-price">
        {plan.price === 0 ? 'Free' : `$${plan.price}`}
        {plan.price > 0 && <span>/mo</span>}
      </div>

      <ul className="pricing-features">
        <li>
          <span className="check">&#10003;</span>
          {plan.statements === Infinity
            ? 'Unlimited statements'
            : `${plan.statements} statement${plan.statements > 1 ? 's' : ''} ${plan.price > 0 ? '/month' : '(one-time)'}`}
        </li>
        <li>
          <span className="check">&#10003;</span>
          {plan.maxRows === Infinity ? 'Unlimited rows' : `Up to ${plan.maxRows.toLocaleString()} rows`}
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
        <li>
          <span className="check">&#10003;</span>
          Cost-ratio analysis
        </li>
        <li>
          <span className="check">&#10003;</span>
          Regulatory checks
        </li>
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
