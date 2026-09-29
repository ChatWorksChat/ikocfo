// Authentication module — calls Lambda API backend

import { API_URL } from './constants.js';
import { getSession, setSession, clearSession } from './storage.js';

async function apiCall(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function register({ email, password, firstName, lastName, accountType, companyName, companyAddress, position }) {
  try {
    const data = await apiCall('/auth/register', {
      email, password, firstName, lastName, accountType,
      companyName, companyAddress, position,
    });
    if (data.error) {
      return { success: false, error: data.error };
    }
    return { success: true, email: data.email };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function verifyEmail(email, code) {
  try {
    const data = await apiCall('/auth/verify', { email, code });
    if (data.error) {
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function resendCode(email) {
  try {
    const data = await apiCall('/auth/resend', { email });
    if (data.error) {
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function login(email, password) {
  try {
    const data = await apiCall('/auth/login', { email, password });
    if (data.error) {
      return { success: false, error: data.error };
    }
    // MFA required — don't set session yet
    if (data.mfaRequired) {
      return { success: false, mfaRequired: true, mfaToken: data.mfaToken, methods: data.methods };
    }
    setSession(data.user);
    return { success: true, user: data.user, mfaSetupRequired: !!data.mfaSetupRequired };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function verifyMfa(mfaToken, code, method = 'totp') {
  try {
    const data = await apiCall('/auth/mfa/verify', { mfaToken, code, method });
    if (data.error) {
      return { success: false, error: data.error };
    }
    setSession(data.user);
    return { success: true, user: data.user };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function setupTotp(email) {
  try {
    const data = await apiCall('/auth/mfa/totp/setup', { email });
    if (data.error) return { success: false, error: data.error };
    return { success: true, secret: data.secret, otpauthUri: data.otpauthUri };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function verifyTotpSetup(email, code) {
  try {
    const data = await apiCall('/auth/mfa/totp/verify-setup', { email, code });
    if (data.error) return { success: false, error: data.error };
    // Update session with mfaEnabled
    const session = getSession();
    if (session) setSession({ ...session, mfaEnabled: true });
    return { success: true, recoveryCodes: data.recoveryCodes };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function disableTotp(email, password) {
  try {
    const data = await apiCall('/auth/mfa/totp/disable', { email, password });
    if (data.error) return { success: false, error: data.error };
    const session = getSession();
    if (session) setSession({ ...session, mfaEnabled: false });
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function getMfaStatus(email) {
  try {
    const data = await apiCall('/auth/mfa/status', { email });
    if (data.error) return { success: false, error: data.error };
    return { success: true, totpEnabled: data.totpEnabled, recoveryCodesRemaining: data.recoveryCodesRemaining };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export async function regenerateRecoveryCodes(email, password) {
  try {
    const data = await apiCall('/auth/mfa/recovery-codes/regenerate', { email, password });
    if (data.error) return { success: false, error: data.error };
    return { success: true, recoveryCodes: data.recoveryCodes };
  } catch {
    return { success: false, error: 'Unable to connect to server. Please try again.' };
  }
}

export function logout() {
  clearSession();
}

export function getCurrentUser() {
  return getSession();
}

export function isAuthenticated() {
  return getSession() !== null;
}

export function upgradeUserPlan(email, plan) {
  const session = getSession();
  if (session && session.email.toLowerCase() === email.toLowerCase()) {
    setSession({ ...session, plan });
  }
  return true;
}

// Admin API calls

export async function fetchAdminUsers() {
  try {
    const data = await apiGet('/admin/users');
    if (data.error) return { success: false, error: data.error };
    return { success: true, users: data.users };
  } catch {
    return { success: false, error: 'Unable to connect to server.' };
  }
}

export async function updateUserStatus(email, status) {
  try {
    const data = await apiPut(`/admin/users/${encodeURIComponent(email)}/status`, { status });
    if (data.error) return { success: false, error: data.error };
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to connect to server.' };
  }
}

export async function updateUserRole(email, role) {
  try {
    const data = await apiPut(`/admin/users/${encodeURIComponent(email)}/role`, { role });
    if (data.error) return { success: false, error: data.error };
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to connect to server.' };
  }
}

export async function fetchAdminStats() {
  try {
    const data = await apiGet('/admin/stats');
    if (data.error) return { success: false, error: data.error };
    return { success: true, stats: data.stats };
  } catch {
    return { success: false, error: 'Unable to connect to server.' };
  }
}

export async function sendCredentials(email) {
  try {
    const data = await apiCall('/admin/send-credentials', { email });
    if (data.error) return { success: false, error: data.error };
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to connect to server.' };
  }
}
