import { useState, useEffect, useRef } from 'react';
import { getCurrentUser, fetchPlans, upgradeUserPlan } from '../lib/auth.js';
import { PLANS } from '../lib/constants.js';
import { redirectToCheckout, loadStripeConfig, isStripeConfigured } from '../lib/stripe.js';
import { loadPesapalConfig, isPesapalConfigured, redirectToPesapal, checkPesapalStatus } from '../lib/pesapal.js';
import PricingCard from '../components/PricingCard.jsx';

const DEFAULT_PLANS = [PLANS.free, PLANS.basic, PLANS.pro];

export default function PricingPage() {
  const user = getCurrentUser();
  const [error, setError] = useState('');
  const [plans, setPlans] = useState(DEFAULT_PLANS);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(false);

  useEffect(() => {
    Promise.all([loadPesapalConfig(), loadStripeConfig(), fetchPlans()]).then(([,, plansRes]) => {
      if (plansRes.success && plansRes.plans.length > 0) {
        setPlans(plansRes.plans);
      }
      setLoading(false);
    });
  }, []);

  // Handle return from PesaPal
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pesapal_return') !== 'true') return;

    const orderTrackingId = sessionStorage.getItem('pesapal_order_tracking_id');
    if (!orderTrackingId) return;

    // Clean URL
    window.history.replaceState({}, '', '/pricing');

    pollRef.current = true;
    setPolling(true);

    let attempts = 0;
    const maxAttempts = 5;

    async function poll() {
      if (!pollRef.current || attempts >= maxAttempts) {
        setPolling(false);
        if (attempts >= maxAttempts) {
          setError('Payment verification is taking longer than expected. Your plan will be updated once payment is confirmed.');
        }
        return;
      }
      attempts++;
      try {
        const result = await checkPesapalStatus(orderTrackingId);
        if (result.status === 'Completed') {
          sessionStorage.removeItem('pesapal_order_tracking_id');
          pollRef.current = false;
          setPolling(false);
          // Update local user data and redirect
          if (user && result.plan) {
            upgradeUserPlan(user.email, result.plan);
          }
          window.location.href = '/dashboard';
          return;
        }
        if (result.status === 'Failed' || result.status === 'Reversed') {
          sessionStorage.removeItem('pesapal_order_tracking_id');
          pollRef.current = false;
          setPolling(false);
          setError('Payment was not completed. Please try again.');
          return;
        }
      } catch {
        // continue polling
      }
      setTimeout(poll, 3000);
    }

    poll();
    return () => { pollRef.current = false; };
  }, [user]);

  async function handleSubscribe(planId) {
    if (!user) {
      window.location.href = '/register';
      return;
    }
    setError('');

    // Try PesaPal first
    if (isPesapalConfigured()) {
      try {
        await redirectToPesapal(planId, user.email);
        return;
      } catch (err) {
        console.warn('PesaPal failed, trying Stripe fallback:', err.message);
      }
    }

    // Stripe failover
    if (isStripeConfigured()) {
      try {
        await redirectToCheckout(planId, user.email);
        return;
      } catch (err) {
        setError(err.message);
        return;
      }
    }

    // MVP fallback: directly upgrade plan (simulating payment)
    upgradeUserPlan(user.email, planId);
    window.location.href = '/dashboard';
  }

  return (
    <div className="page-container-wide">
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h1 className="page-title">Simple, Transparent Pricing</h1>
        <p className="page-subtitle">
          Start free. Upgrade when you need more power.
        </p>
      </div>

      {error && <div className="alert alert-error" style={{ maxWidth: '600px', margin: '0 auto 24px' }}>{error}</div>}

      {polling && (
        <div className="alert" style={{ maxWidth: '600px', margin: '0 auto 24px', textAlign: 'center', background: 'rgba(132, 88, 163, 0.08)', border: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}>
          Verifying your payment... Please wait.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>Loading plans...</div>
      ) : (
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
      )}

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
