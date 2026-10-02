// Core calculation orchestrator — ties all calculation modules together

import { calculateCostRatio, nominalToEAR } from './earCalculator.js';
import { calculateXIRR, buildCashFlows } from './xirr.js';
import { runRegulatoryChecks } from './regulatoryChecks.js';
import { classifyTransactions } from './statementMapper.js';
import { calculateDailyInterest, detectBankInterestCharged } from './dailyInterestCalculator.js';

/**
 * Run the full overdraft audit calculation.
 *
 * @param {Object} params
 * @param {Array}  params.transactions - Mapped transaction rows (with date, balance, interest, fees, debit, credit)
 * @param {string} params.currency - Currency code (KES, USD, EUR, GBP)
 * @param {number} params.nominalRate - Stated nominal interest rate (%)
 * @param {number} params.overdraftLimit - Stated overdraft limit
 * @param {boolean} params.includeXIRR - Whether to calculate XIRR (plan-gated)
 * @param {string} params.fileName - Original file name for history
 * @param {number} params.openingBalance - Opening cleared balance (negative if overdrawn)
 * @param {Date|string} params.periodStart - Start date of the analysis period
 * @param {Date|string} params.periodEnd - End date of the analysis period
 * @param {number} params.bankInterestCharged - Bank's stated OD interest charge
 * @param {number} [params.tolerancePercent=5] - Variance tolerance %
 * @returns {Object} Full results object
 */
export function runCalculation({
  transactions, currency, nominalRate, overdraftLimit,
  includeXIRR, fileName,
  openingBalance, periodStart, periodEnd, bankInterestCharged, tolerancePercent,
}) {
  // Classify transactions to separate OD interest from other-facility interest
  const classified = classifyTransactions(transactions);

  const results = {
    fileName,
    currency,
    nominalRate,
    overdraftLimit,
    transactionCount: classified.length,
    dailyInterest: null,
    costRatio: null,
    xirr: null,
    nominalEAR: null,
    regulatoryFlags: [],
  };

  // 1. PRIMARY METHOD: Daily interest calculation
  if (openingBalance != null && periodStart && periodEnd) {
    const dailyResult = calculateDailyInterest({
      transactions: classified,
      currency,
      nominalRate,
      openingBalance,
      periodStart,
      periodEnd,
      bankInterestCharged: bankInterestCharged || 0,
      tolerancePercent: tolerancePercent || 5,
    });

    if (dailyResult.error) {
      results.error = dailyResult.error;
      return results;
    }

    results.dailyInterest = dailyResult;
  }

  // 2. SECONDARY: Cost-ratio method (reference only)
  const costRatioResult = calculateCostRatio(classified, currency);
  if (!costRatioResult.error) {
    results.costRatio = costRatioResult;
  }

  // 3. Nominal to EAR conversion
  if (nominalRate && nominalRate > 0) {
    results.nominalEAR = nominalToEAR(nominalRate);
  }

  // 4. XIRR method (if enabled, reference only)
  if (includeXIRR) {
    const cashFlows = buildCashFlows(classified);
    if (cashFlows.length >= 2) {
      const xirrResult = calculateXIRR(cashFlows);
      results.xirr = xirrResult;
    }
  }

  // 5. Regulatory checks (pass daily interest result when available)
  results.regulatoryFlags = runRegulatoryChecks(classified, {
    overdraftLimit,
    nominalRate,
    currency,
    dailyInterestResult: results.dailyInterest,
  });

  // 6. Date range (from cost-ratio or daily interest)
  if (results.dailyInterest) {
    results.startDate = periodStart;
    results.endDate = periodEnd;
  } else if (results.costRatio) {
    results.startDate = results.costRatio.startDate;
    results.endDate = results.costRatio.endDate;
  }

  return results;
}
