// Regulatory checks: in duplum, rate changes, excess OD, interest variance

import { parseNumeric, parseDate } from './formatters.js';
import { daysBetween } from './dayCount.js';

/**
 * Run all regulatory checks on parsed transactions.
 * Returns an array of flag objects: { type, severity, title, message }
 */
export function runRegulatoryChecks(transactions, { overdraftLimit, nominalRate, currency, dailyInterestResult }) {
  const flags = [];

  flags.push(...checkInDuplum(transactions, dailyInterestResult));
  flags.push(...checkRateChanges(transactions, nominalRate, currency));
  flags.push(...checkExcessOverdraft(transactions, overdraftLimit, dailyInterestResult));
  if (dailyInterestResult) {
    flags.push(...checkInterestVariance(dailyInterestResult));
  }

  return flags;
}

/**
 * In duplum rule: total interest should not exceed the principal amount.
 * When daily interest data is available, use bankInterestCharged vs maxODBalance.
 */
function checkInDuplum(transactions, dailyInterestResult) {
  const flags = [];

  let totalInterest;
  let maxBalance;

  if (dailyInterestResult) {
    totalInterest = dailyInterestResult.bankInterestCharged;
    maxBalance = dailyInterestResult.maxODBalance;
  } else {
    totalInterest = 0;
    maxBalance = 0;
    for (const tx of transactions) {
      totalInterest += Math.abs(parseNumeric(tx.interest));
      const bal = Math.abs(parseNumeric(tx.balance));
      if (bal > maxBalance) maxBalance = bal;
    }
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
 * Optionally uses dailySchedule for more accurate max balance detection.
 */
function checkExcessOverdraft(transactions, overdraftLimit, dailyInterestResult) {
  const flags = [];
  if (!overdraftLimit || overdraftLimit <= 0) return flags;

  // Use daily schedule max if available for more accurate detection
  if (dailyInterestResult && dailyInterestResult.maxODBalance > overdraftLimit) {
    flags.push({
      type: 'excess_od',
      severity: 'warning',
      title: 'Overdraft Limit Exceeded',
      message: `Daily balance reconstruction shows the overdraft exposure exceeded the stated limit of ${overdraftLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Peak overdraft balance: ${dailyInterestResult.maxODBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    });
    return flags;
  }

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

/**
 * Check for interest variance between bank's charge and independently calculated interest.
 */
function checkInterestVariance(dailyInterestResult) {
  const flags = [];

  if (dailyInterestResult.status === 'discrepancy') {
    const direction = dailyInterestResult.variance > 0 ? 'overcharged' : 'undercharged';
    flags.push({
      type: 'interest_variance',
      severity: 'danger',
      title: 'Interest Overcharge Detected',
      message: `The bank's interest charge differs from the independently calculated amount by ${Math.abs(dailyInterestResult.variancePercent).toFixed(1)}%. The bank appears to have ${direction} by ${Math.abs(dailyInterestResult.variance).toLocaleString('en-US', { minimumFractionDigits: 2 })}. Review the daily audit schedule for details.`,
    });
  } else if (dailyInterestResult.status === 'review') {
    flags.push({
      type: 'interest_variance',
      severity: 'warning',
      title: 'Interest Variance Noted',
      message: `The bank's interest charge differs from the independently calculated amount by ${Math.abs(dailyInterestResult.variancePercent).toFixed(1)}%. This is within a moderate range but worth reviewing. Check the daily audit schedule.`,
    });
  }

  return flags;
}
