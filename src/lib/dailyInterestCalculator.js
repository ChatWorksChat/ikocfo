// Daily interest calculation engine — rebuilds daily cleared balances
// from value-dated transactions and calculates expected overdraft interest.

import { getDaysInYear } from './dayCount.js';
import { parseNumeric, parseDate } from './formatters.js';

/**
 * Format a Date as YYYY-MM-DD string (local time).
 */
function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Add days to a Date, returning a new Date.
 */
function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

/**
 * Auto-detect the total bank OD interest charged from classified transactions.
 * Looks for transactions classified as 'overdraft_interest' and sums their debit amounts.
 */
export function detectBankInterestCharged(classifiedTransactions) {
  let total = 0;
  for (const tx of classifiedTransactions) {
    if (tx.classification === 'overdraft_interest') {
      // Interest debits appear as debit amounts (positive values reduce the balance)
      const debit = parseNumeric(tx.debit);
      if (debit > 0) {
        total += debit;
      } else {
        // Fallback: if no separate debit column, look at the absolute amount
        const amount = parseNumeric(tx.amount);
        if (amount !== 0) total += Math.abs(amount);
      }
    }
  }
  return total;
}

/**
 * Main daily interest calculation.
 *
 * @param {Object} params
 * @param {Array}  params.transactions - Mapped transaction rows (with date, valueDate, debit, credit, balance, description, classification)
 * @param {string} params.currency - Currency code (KES, USD, EUR, GBP)
 * @param {number} params.nominalRate - Stated nominal interest rate (% per annum)
 * @param {number} params.openingBalance - Opening cleared balance (negative if overdrawn)
 * @param {Date|string} params.periodStart - Start date of the analysis period
 * @param {Date|string} params.periodEnd - End date of the analysis period
 * @param {number} params.bankInterestCharged - Bank's stated OD interest charge for the period
 * @param {number} [params.tolerancePercent=5] - Tolerance % for matching determination
 * @returns {Object} Daily interest calculation results
 */
export function calculateDailyInterest({
  transactions,
  currency,
  nominalRate,
  openingBalance,
  periodStart,
  periodEnd,
  bankInterestCharged,
  tolerancePercent = 5,
}) {
  const pStart = parseDate(periodStart);
  const pEnd = parseDate(periodEnd);

  if (!pStart || !pEnd || pStart >= pEnd) {
    return { error: 'Invalid period dates. Start must be before end.' };
  }

  const rate = parseNumeric(nominalRate);
  if (rate <= 0) {
    return { error: 'Nominal rate must be greater than zero.' };
  }

  const daysInYear = getDaysInYear(currency);
  const dayCountBasis = currency === 'KES' ? 'Actual/365' : 'Actual/360';

  // Step 1: Parse transactions and determine effective value dates
  let missingValueDateCount = 0;
  let excludedFutureCount = 0;
  let backValuedAdjustment = 0;
  let adjustedOpeningBalance = parseNumeric(openingBalance);

  const parsedTxns = [];

  for (const tx of transactions) {
    const postingDate = parseDate(tx.date);
    if (!postingDate) continue;

    const valueDate = parseDate(tx.valueDate);
    let effectiveValueDate;

    if (valueDate) {
      effectiveValueDate = valueDate;
    } else {
      effectiveValueDate = postingDate;
      missingValueDateCount++;
    }

    const debit = parseNumeric(tx.debit);
    const credit = parseNumeric(tx.credit);
    const isODInterest = tx.classification === 'overdraft_interest';

    // Handle future-dated transactions (after period end) — exclude
    if (effectiveValueDate > pEnd) {
      excludedFutureCount++;
      continue;
    }

    // Handle back-valued transactions (before period start) — adjust opening balance
    if (effectiveValueDate < pStart) {
      // Credits increase balance, debits decrease it
      backValuedAdjustment += credit - debit;
      continue;
    }

    parsedTxns.push({
      effectiveValueDate,
      postingDate,
      debit,
      credit,
      isODInterest,
      description: tx.description || '',
    });
  }

  // Apply back-valued adjustment to opening balance
  adjustedOpeningBalance += backValuedAdjustment;

  // Step 2: Build daily movement map: Map<YYYY-MM-DD, { credits, debits }>
  const dailyMovements = new Map();

  for (const tx of parsedTxns) {
    const key = toDateKey(tx.effectiveValueDate);
    if (!dailyMovements.has(key)) {
      dailyMovements.set(key, { credits: 0, debits: 0 });
    }
    const entry = dailyMovements.get(key);
    entry.credits += tx.credit;
    entry.debits += tx.debit;
  }

  // Step 3: Iterate every calendar day, building daily schedule
  const dailySchedule = [];
  let runningBalance = adjustedOpeningBalance;
  let totalExpectedInterest = 0;
  let maxODBalance = 0;
  let daysInOverdraft = 0;
  let sumODBalance = 0;

  let currentDate = new Date(pStart);
  const endDate = new Date(pEnd);
  let totalDays = 0;

  while (currentDate <= endDate) {
    const key = toDateKey(currentDate);
    const movements = dailyMovements.get(key) || { credits: 0, debits: 0 };

    const dayOpeningBal = runningBalance;
    // Credits increase balance (make it less negative), debits decrease it (make it more negative)
    const closingBal = dayOpeningBal + movements.credits - movements.debits;

    // Overdraft balance is the absolute value when balance is negative
    const odBalance = Math.max(0, -closingBal);

    // Daily interest on the OD exposure
    const dailyInterest = odBalance * (rate / 100) / daysInYear;

    totalExpectedInterest += dailyInterest;

    if (odBalance > 0) {
      daysInOverdraft++;
      sumODBalance += odBalance;
    }
    if (odBalance > maxODBalance) {
      maxODBalance = odBalance;
    }

    dailySchedule.push({
      date: key,
      openingBalance: dayOpeningBal,
      credits: movements.credits,
      debits: movements.debits,
      closingBalance: closingBal,
      odBalance,
      rate,
      denominator: daysInYear,
      dailyInterest,
    });

    // Carry forward
    runningBalance = closingBal;
    currentDate = addDays(currentDate, 1);
    totalDays++;
  }

  // Step 4: Calculate average daily OD balance
  const avgDailyODBalance = totalDays > 0 ? sumODBalance / totalDays : 0;

  // Step 5: Compare with bank's charge
  const bankCharged = parseNumeric(bankInterestCharged);
  const variance = bankCharged - totalExpectedInterest;
  const variancePercent = totalExpectedInterest > 0
    ? (variance / totalExpectedInterest) * 100
    : (bankCharged > 0 ? 100 : 0);

  // Step 6: Determine status
  let status;
  const absVariancePct = Math.abs(variancePercent);
  if (absVariancePct <= tolerancePercent) {
    status = 'matches';
  } else if (absVariancePct <= tolerancePercent * 3) {
    status = 'review';
  } else {
    status = 'discrepancy';
  }

  return {
    expectedInterest: totalExpectedInterest,
    bankInterestCharged: bankCharged,
    variance,
    variancePercent,
    avgDailyODBalance,
    maxODBalance,
    daysInOverdraft,
    totalDays,
    annualRate: rate,
    dayCountBasis,
    status,
    dailySchedule,
    adjustedOpeningBalance,
    missingValueDateCount,
    excludedFutureCount,
    backValuedAdjustment,
  };
}
