// Stripe payment link redirect logic — dynamic config support

import { loadStripe } from '@stripe/stripe-js';
import { STRIPE, API_URL } from './constants.js';

let stripePromise = null;
let dynamicConfig = null;
let configLoaded = false;

/**
 * Fetch Stripe config from API. Falls back to env vars.
 */
export async function loadStripeConfig() {
  if (configLoaded) return dynamicConfig;
  try {
    const res = await fetch(`${API_URL}/config/payment`);
    const data = await res.json();
    if (data.stripe && data.stripe.configured) {
      dynamicConfig = {
        publishableKey: data.stripe.publishableKey,
        prices: {
          basic: data.stripe.basicPriceId,
          pro: data.stripe.proPriceId,
        },
      };
    }
  } catch {
    // Fall through to env var fallback
  }
  configLoaded = true;
  return dynamicConfig;
}

function getEffectiveConfig() {
  if (dynamicConfig) return dynamicConfig;
  return STRIPE;
}

function getStripe() {
  const config = getEffectiveConfig();
  if (!stripePromise && config.publishableKey) {
    stripePromise = loadStripe(config.publishableKey);
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
  await loadStripeConfig();
  const config = getEffectiveConfig();
  const priceId = config.prices[plan];

  if (!priceId) {
    throw new Error(
      'Stripe is not configured yet. Please ask an admin to configure Stripe in the Admin Dashboard.'
    );
  }

  const stripe = await getStripe();

  if (!stripe) {
    throw new Error('Stripe is not configured. Please ask an admin to configure Stripe in the Admin Dashboard.');
  }

  const { error } = await stripe.redirectToCheckout({
    lineItems: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    successUrl: `${window.location.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${window.location.origin}/pricing`,
    clientReferenceId: email,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Check if Stripe is configured (synchronous — uses cached config).
 */
export function isStripeConfigured() {
  const config = getEffectiveConfig();
  return Boolean(config.publishableKey && config.prices.basic && config.prices.pro);
}

/**
 * Check dynamic config (async version, for initial page loads).
 */
export async function checkStripeConfigured() {
  await loadStripeConfig();
  return isStripeConfigured();
}
