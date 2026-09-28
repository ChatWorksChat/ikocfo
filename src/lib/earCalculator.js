// EAR (Effective Annual Rate) conversion & cost-ratio method

import { daysBetween, getDaysInYear } from './dayCount.js';
import { parseNumeric, parseDate } from './formatters.js';

/**
 * Cost-ratio method for calculating effective APR:
 * 1. Classify transactions (overdraft interest, other-facility interest, fees)
 * 2. Calculate weighted average outstanding balance (balance x days held)
 *    — uses value dates when available for more accurate weighting
 * 3. Sum total cost (overdraft interest + fees only; other-facility interest excluded)
 * 4. Annualize: (totalCost / avgBalance) / yearFraction x 100
 */
export function calculateCostRatio(transactions, currency) {
  const daysInYear = getDaysInYear(currency);

  // Check if explicit interest/fees columns are mapped
  const hasInterestColumn = transactions.some(
    t => t.interest != null && String(t.interest).trim() !== '' && parseNumeric(t.interest) !== 0
  );
  const hasFeesColumn = transactions.some(
    t => t.fees != null && String(t.fees).trim() !== '' && parseNumeric(t.fees) !== 0
  );

  // Parse all values
  const sorted = [...transactions]
    .map(t => ({
      ...t,
      parsedDate: parseDate(t.date),
      parsedValueDate: parseDate(t.valueDate),
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

  // Determine if value dates are available for balance weighting
  const hasValueDates = sorted.filter(t => t.parsedValueDate !== null).length > sorted.length * 0.5;

  // For balance weighting, use value dates when available
  const balanceSorted = hasValueDates
    ? [...sorted]
        .map(t => ({
          ...t,
          effectiveDate: t.parsedValueDate || t.parsedDate,
        }))
        .sort((a, b) => a.effectiveDate - b.effectiveDate)
    : sorted.map(t => ({ ...t, effectiveDate: t.parsedDate }));

  // Calculate weighted average balance
  const balStart = balanceSorted[0].effectiveDate;
  const balEnd = balanceSorted[balanceSorted.length - 1].effectiveDate;
  const balTotalDays = daysBetween(balStart, balEnd);
  const effectiveTotalDays = balTotalDays > 0 ? balTotalDays : totalDays;

  let weightedBalanceSum = 0;
  for (let i = 0; i < balanceSorted.length; i++) {
    const tx = balanceSorted[i];
    const nextDate = i < balanceSorted.length - 1
      ? balanceSorted[i + 1].effectiveDate
      : balEnd;
    const holdDays = Math.max(0, daysBetween(tx.effectiveDate, nextDate));
    weightedBalanceSum += Math.abs(tx.parsedBalance) * holdDays;
  }

  // Calculate costs — separate overdraft interest from other-facility interest
  let overdraftInterest = 0;
  let otherFacilityInterest = 0;
  let totalFees = 0;

  for (const tx of sorted) {
    const cls = tx.classification || 'regular';

    // Interest
    if (hasInterestColumn && Math.abs(tx.parsedInterest) > 0) {
      if (cls === 'other_facility_interest') {
        otherFacilityInterest += Math.abs(tx.parsedInterest);
      } else {
        overdraftInterest += Math.abs(tx.parsedInterest);
      }
    } else if (!hasInterestColumn) {
      if (cls === 'overdraft_interest') {
        overdraftInterest += Math.abs(tx.parsedDebit);
      } else if (cls === 'other_facility_interest') {
        otherFacilityInterest += Math.abs(tx.parsedDebit);
      }
    }

    // Fees
    if (hasFeesColumn) {
      totalFees += Math.abs(tx.parsedFees);
    } else if (cls === 'fee') {
      totalFees += Math.abs(tx.parsedDebit);
    }
  }

  const totalInterest = overdraftInterest; // Only OD interest in cost
  const totalCost = totalInterest + totalFees;
  const avgBalance = effectiveTotalDays > 0 ? weightedBalanceSum / effectiveTotalDays : 0;
  const yearFraction = effectiveTotalDays / daysInYear;

  if (avgBalance === 0) {
    return {
      effectiveAPR: 0,
      totalInterest,
      overdraftInterest,
      otherFacilityInterest,
      totalFees,
      totalCost,
      avgBalance: 0,
      startDate,
      endDate,
      totalDays,
      yearFraction,
      usedValueDates: hasValueDates,
    };
  }

  const effectiveAPR = (totalCost / avgBalance) / yearFraction * 100;

  return {
    effectiveAPR,
    totalInterest,
    overdraftInterest,
    otherFacilityInterest,
    totalFees,
    totalCost,
    avgBalance,
    startDate,
    endDate,
    totalDays,
    yearFraction,
    usedValueDates: hasValueDates,
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
