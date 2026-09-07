// Authentication facade — localStorage-based for MVP
// Can be swapped to Lambda + DynamoDB later

import {
  findUserByEmail,
  addUser,
  updateUser,
  getSession,
  setSession,
  clearSession,
} from './storage.js';

export function register({ email, password, firstName, lastName, accountType, companyName, companyAddress, position }) {
  const existing = findUserByEmail(email);
  if (existing) {
    return { success: false, error: 'An account with this email already exists.' };
  }

  const user = {
    email: email.toLowerCase().trim(),
    password, // MVP only — would be hashed in production
    firstName: firstName || '',
    lastName: lastName || '',
    accountType: accountType || 'individual',
    companyName: companyName || '',
    companyAddress: companyAddress || '',
    position: position || '',
    plan: 'free',
    verified: true, // auto-verified for MVP
    createdAt: new Date().toISOString(),
  };

  addUser(user);
  setSession(user);

  return { success: true, user };
}

export function login(email, password) {
  const user = findUserByEmail(email);
  if (!user) {
    return { success: false, error: 'No account found with this email.' };
  }
  if (user.password !== password) {
    return { success: false, error: 'Incorrect password.' };
  }
  if (!user.verified) {
    return { success: false, error: 'Please verify your email first.' };
  }

  setSession(user);
  return { success: true, user };
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

export function verifyEmail(token) {
  // MVP: auto-verified on registration
  // Extension point: validate token, update user.verified = true
  return { success: true };
}

export function upgradeUserPlan(email, plan) {
  const updated = updateUser(email, { plan });
  if (updated) {
    // Update session too
    const session = getSession();
    if (session && session.email.toLowerCase() === email.toLowerCase()) {
      setSession({ ...session, plan });
    }
  }
  return updated;
}
