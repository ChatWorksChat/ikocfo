// localStorage wrappers for session, history, and usage tracking
// User CRUD now handled by backend API

import { STORAGE_KEYS } from './constants.js';

function getJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Session ---

export function getSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.session);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(user) {
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(user));
}

export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
}

// --- Analysis History ---

export function getHistory(email) {
  const all = getJSON(STORAGE_KEYS.history) || {};
  return all[email] || [];
}

export function addHistoryEntry(email, entry) {
  const all = getJSON(STORAGE_KEYS.history) || {};
  if (!all[email]) all[email] = [];
  all[email].unshift({
    ...entry,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
  });
  setJSON(STORAGE_KEYS.history, all);
}

// --- Usage Tracking ---

export function getUsageCount(email) {
  const history = getHistory(email);
  return history.length;
}

export function canAnalyze(user) {
  const plan = user.plan || 'free';
  const count = getUsageCount(user.email);

  if (plan === 'pro') return { allowed: true, remaining: Infinity };
  if (plan === 'basic') {
    const remaining = 10 - count;
    return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
  }
  // free
  const remaining = 1 - count;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

export function getMaxRows(user) {
  const plan = user.plan || 'free';
  if (plan === 'pro') return Infinity;
  if (plan === 'basic') return 5000;
  return 1000;
}

export function hasXirrAccess(user) {
  const plan = user.plan || 'free';
  return plan === 'basic' || plan === 'pro';
}
