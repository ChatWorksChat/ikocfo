// PesaPal payment integration — config check, redirect, status polling

import { API_URL } from './constants.js';

let pesapalConfigured = false;
let configLoaded = false;

/**
 * Load PesaPal config from public payment endpoint. Caches result.
 */
export async function loadPesapalConfig() {
  if (configLoaded) return pesapalConfigured;
  try {
    const res = await fetch(`${API_URL}/config/payment`);
    const data = await res.json();
    if (data.pesapal && data.pesapal.configured) {
      pesapalConfigured = true;
    }
  } catch {
    // Fall through — not configured
  }
  configLoaded = true;
  return pesapalConfigured;
}

/**
 * Synchronous check (uses cached config from loadPesapalConfig).
 */
export function isPesapalConfigured() {
  return pesapalConfigured;
}

/**
 * Create a PesaPal order and redirect the user to PesaPal's hosted payment page.
 *
 * @param {string} plan - Plan ID (basic, pro)
 * @param {string} email - User email
 */
export async function redirectToPesapal(plan, email) {
  const res = await fetch(`${API_URL}/pesapal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      plan,
      returnUrl: window.location.origin + '/pricing',
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.redirect_url) {
    throw new Error(data.error || 'Failed to create PesaPal order');
  }

  // Store tracking ID so we can poll on return
  sessionStorage.setItem('pesapal_order_tracking_id', data.order_tracking_id);

  // Redirect to PesaPal hosted payment page
  window.location.href = data.redirect_url;
}

/**
 * Poll PesaPal for transaction status after user returns from payment.
 *
 * @param {string} orderTrackingId
 * @returns {Promise<{status: string, plan?: string}>}
 */
export async function checkPesapalStatus(orderTrackingId) {
  const res = await fetch(
    `${API_URL}/pesapal/status?orderTrackingId=${encodeURIComponent(orderTrackingId)}`
  );
  const data = await res.json();
  return data;
}
