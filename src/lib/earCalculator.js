// EAR (Effective Annual Rate) conversion & cost-ratio method

import { daysBetween, getDaysInYear } from './dayCount.js';
import { parseNumeric, parseDate } from './formatters.js';

/**
 * Cost-ratio method for calculating effective APR:
 * 1. Classify transactions (interest charges, fees, regular transactions)
 * 2. Calculate weighted average outstanding balance (balance x days held)
 * 3. Sum total cost (interest + fees)
 * 4. Annualize: (totalCost / avgBalance) / yearFraction x 100
 */
export function calculateCostRatio(transactions, currency) {
  const daysInYear = getDaysInYear(currency);

  // Sort by date
  const sorted = [...transactions]
    .map(t => ({
      ...t,
      parsedDate: parseDate(t.date),
      parsedBalance: parseNumeric(t.balance),
      parsedInterest: parseNumeric(t.interest),
      parsedFees: parseNumeric(t.fees),
      parsedDebit: parseNumeric(t.debit),
      parsedCredit: parseNumeric(t.credit),
    }))
    .filter(t => t.parsedDate !== null)
    .sort((a, b) => a.parsedDate - b.parsedDate);

  if (sorted.length < 2) {
    return { error: 'Need at least 2 transactions with valid dates.' };
  }

  const startDate = sorted[0].parsedDate;
  const endDate = sorted[sorted.length - 1].parsedDate;
  const totalDays = daysBetween(startDate, endDate);

  if (totalDays <= 0) {
    return { error: 'Date range must be positive.' };
  }

  // Calculate weighted average balance and total costs
  let weightedBalanceSum = 0;
  let totalInterest = 0;
  let totalFees = 0;

  for (let i = 0; i < sorted.length; i++) {
    const tx = sorted[i];

    // Accumulate interest and fees
    totalInterest += Math.abs(tx.parsedInterest);
    totalFees += Math.abs(tx.parsedFees);

    // Weighted balance: balance * days until next transaction
    const nextDate = i < sorted.length - 1
      ? sorted[i + 1].parsedDate
      : endDate;
    const holdDays = daysBetween(tx.parsedDate, nextDate);
    weightedBalanceSum += Math.abs(tx.parsedBalance) * holdDays;
  }

  const avgBalance = totalDays > 0 ? weightedBalanceSum / totalDays : 0;
  const totalCost = totalInterest + totalFees;
  const yearFraction = totalDays / daysInYear;

  if (avgBalance === 0) {
    return {
      effectiveAPR: 0,
      totalInterest,
      totalFees,
      totalCost,
      avgBalance: 0,
      startDate,
      endDate,
      totalDays,
      yearFraction,
    };
  }

  const effectiveAPR = (totalCost / avgBalance) / yearFraction * 100;

  return {
    effectiveAPR,
    totalInterest,
    totalFees,
    totalCost,
    avgBalance,
    startDate,
    endDate,
    totalDays,
    yearFraction,
  };
}

/**
 * Convert nominal rate to EAR.
 * EAR = (1 + r/n)^n - 1
 * Where r = nominal rate, n = compounding periods per year
 */
export function nominalToEAR(nominalRate, compoundingPeriods = 12) {
  const r = nominalRate / 100;
  return ((1 + r / compoundingPeriods) ** compoundingPeriods - 1) * 100;
}
