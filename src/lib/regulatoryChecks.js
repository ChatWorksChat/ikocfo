// Regulatory checks: in duplum, rate changes, excess OD

import { parseNumeric, parseDate } from './formatters.js';
import { daysBetween } from './dayCount.js';

/**
 * Run all regulatory checks on parsed transactions.
 * Returns an array of flag objects: { type, severity, title, message }
 */
export function runRegulatoryChecks(transactions, { overdraftLimit, nominalRate, currency }) {
  const flags = [];

  flags.push(...checkInDuplum(transactions));
  flags.push(...checkRateChanges(transactions, nominalRate, currency));
  flags.push(...checkExcessOverdraft(transactions, overdraftLimit));

  return flags;
}

/**
 * In duplum rule: total interest should not exceed the principal amount.
 */
function checkInDuplum(transactions) {
  const flags = [];
  let totalInterest = 0;
  let maxBalance = 0;

  for (const tx of transactions) {
    totalInterest += Math.abs(parseNumeric(tx.interest));
    const bal = Math.abs(parseNumeric(tx.balance));
    if (bal > maxBalance) maxBalance = bal;
  }

  if (maxBalance > 0 && totalInterest > maxBalance) {
    flags.push({
      type: 'in_duplum',
      severity: 'danger',
      title: 'In Duplum Violation',
      message: `Total interest charged (${totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds the peak outstanding balance (${maxBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}). Under the in duplum rule, interest should not exceed the principal.`,
    });
  } else if (maxBalance > 0 && totalInterest > maxBalance * 0.8) {
    flags.push({
      type: 'in_duplum_warning',
      severity: 'warning',
      title: 'Approaching In Duplum Limit',
      message: `Total interest (${totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}) is approaching the peak balance (${maxBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}). Monitor carefully.`,
    });
  }

  return flags;
}

/**
 * Detect implied rate shifts mid-period by comparing interest-to-balance ratios.
 */
function checkRateChanges(transactions, nominalRate, currency) {
  const flags = [];
  const sorted = transactions
    .map(t => ({
      date: parseDate(t.date),
      balance: parseNumeric(t.balance),
      interest: parseNumeric(t.interest),
    }))
    .filter(t => t.date && t.interest !== 0 && t.balance !== 0)
    .sort((a, b) => a.date - b.date);

  if (sorted.length < 2 || !nominalRate) return flags;

  const impliedRates = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const days = daysBetween(prev.date, curr.date);
    if (days <= 0) continue;

    const avgBal = (Math.abs(prev.balance) + Math.abs(curr.balance)) / 2;
    if (avgBal === 0) continue;

    const annualizedRate = (Math.abs(curr.interest) / avgBal) * (365 / days) * 100;
    impliedRates.push({ date: curr.date, rate: annualizedRate });
  }

  // Check for significant rate variations (>20% deviation from nominal)
  const threshold = nominalRate * 0.2;
  const deviations = impliedRates.filter(r => Math.abs(r.rate - nominalRate) > threshold);

  if (deviations.length > 0) {
    flags.push({
      type: 'rate_change',
      severity: 'warning',
      title: 'Implied Rate Variation Detected',
      message: `${deviations.length} period(s) show interest rates that deviate more than 20% from the stated nominal rate of ${nominalRate}%. This may indicate rate changes or additional charges during the period.`,
    });
  }

  return flags;
}

/**
 * Flag balances exceeding the stated overdraft limit.
 */
function checkExcessOverdraft(transactions, overdraftLimit) {
  const flags = [];
  if (!overdraftLimit || overdraftLimit <= 0) return flags;

  const excesses = [];

  for (const tx of transactions) {
    const balance = Math.abs(parseNumeric(tx.balance));
    if (balance > overdraftLimit) {
      const date = parseDate(tx.date);
      excesses.push({ date, balance });
    }
  }

  if (excesses.length > 0) {
    const maxExcess = Math.max(...excesses.map(e => e.balance));
    flags.push({
      type: 'excess_od',
      severity: 'warning',
      title: 'Overdraft Limit Exceeded',
      message: `${excesses.length} transaction(s) show a balance exceeding the stated overdraft limit of ${overdraftLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Peak balance: ${maxExcess.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    });
  }

  return flags;
}
