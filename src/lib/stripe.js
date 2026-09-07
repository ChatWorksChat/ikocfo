// Stripe payment link redirect logic

import { loadStripe } from '@stripe/stripe-js';
import { STRIPE } from './constants.js';

let stripePromise = null;

function getStripe() {
  if (!stripePromise && STRIPE.publishableKey) {
    stripePromise = loadStripe(STRIPE.publishableKey);
  }
  return stripePromise;
}

/**
 * Redirect to Stripe Checkout for a given plan.
 *
 * @param {'basic'|'pro'} plan - The plan to subscribe to
 * @param {string} email - User's email for client_reference_id
 */
export async function redirectToCheckout(plan, email) {
  const priceId = STRIPE.prices[plan];

  if (!priceId) {
    throw new Error(
      `Stripe is not configured yet. Please set VITE_STRIPE_PRICE_${plan.toUpperCase()} in your environment.`
    );
  }

  const stripe = await getStripe();

  if (!stripe) {
    throw new Error('Stripe is not configured. Please set VITE_STRIPE_PK in your environment.');
  }

  const { error } = await stripe.redirectToCheckout({
    lineItems: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    successUrl: STRIPE.successUrl,
    cancelUrl: STRIPE.cancelUrl,
    clientReferenceId: email,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Check if Stripe is configured.
 */
export function isStripeConfigured() {
  return Boolean(STRIPE.publishableKey && STRIPE.prices.basic && STRIPE.prices.pro);
}
