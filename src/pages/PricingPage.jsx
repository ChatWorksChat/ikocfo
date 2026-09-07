import { useState } from 'react';
import { getCurrentUser } from '../lib/auth.js';
import { PLANS } from '../lib/constants.js';
import { redirectToCheckout, isStripeConfigured } from '../lib/stripe.js';
import { upgradeUserPlan } from '../lib/auth.js';
import PricingCard from '../components/PricingCard.jsx';

export default function PricingPage() {
  const user = getCurrentUser();
  const [error, setError] = useState('');

  async function handleSubscribe(planId) {
    if (!user) {
      window.location.href = '/register';
      return;
    }

    if (isStripeConfigured()) {
      try {
        await redirectToCheckout(planId, user.email);
      } catch (err) {
        setError(err.message);
      }
    } else {
      // MVP fallback: directly upgrade plan (simulating payment)
      upgradeUserPlan(user.email, planId);
      setError('');
      window.location.href = '/dashboard';
    }
  }

  const plans = [PLANS.free, PLANS.basic, PLANS.pro];

  return (
    <div className="page-container-wide">
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h1 className="page-title">Simple, Transparent Pricing</h1>
        <p className="page-subtitle">
          Start free. Upgrade when you need more power.
        </p>
      </div>

      {error && <div className="alert alert-error" style={{ maxWidth: '600px', margin: '0 auto 24px' }}>{error}</div>}

      <div className="pricing-grid">
        {plans.map(plan => (
          <PricingCard
            key={plan.id}
            plan={plan}
            featured={plan.id === 'basic'}
            currentPlan={user?.plan || 'free'}
            onSubscribe={handleSubscribe}
          />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: '48px', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
        <p>All plans include cost-ratio analysis, column auto-detection, and regulatory checks.</p>
        <p style={{ marginTop: '8px' }}>
          Need a custom plan?{' '}
          <a href="https://ikocfo.com" target="_blank" rel="noopener noreferrer">
            Contact IKO CFO
          </a>
        </p>
      </div>
    </div>
  );
}
