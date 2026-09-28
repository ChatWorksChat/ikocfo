// Core calculation orchestrator — ties all calculation modules together

import { calculateCostRatio, nominalToEAR } from './earCalculator.js';
import { calculateXIRR, buildCashFlows } from './xirr.js';
import { runRegulatoryChecks } from './regulatoryChecks.js';
import { classifyTransactions } from './statementMapper.js';

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
 * @returns {Object} Full results object
 */
export function runCalculation({ transactions, currency, nominalRate, overdraftLimit, includeXIRR, fileName }) {
  // Classify transactions to separate OD interest from other-facility interest
  const classified = classifyTransactions(transactions);

  const results = {
    fileName,
    currency,
    nominalRate,
    overdraftLimit,
    transactionCount: classified.length,
    costRatio: null,
    xirr: null,
    nominalEAR: null,
    regulatoryFlags: [],
    effectiveAPR: null,
  };

  // 1. Cost-ratio method (with classification-aware interest separation)
  const costRatioResult = calculateCostRatio(classified, currency);
  if (costRatioResult.error) {
    results.error = costRatioResult.error;
    return results;
  }
  results.costRatio = costRatioResult;
  results.effectiveAPR = costRatioResult.effectiveAPR;

  // 2. Nominal to EAR conversion
  if (nominalRate && nominalRate > 0) {
    results.nominalEAR = nominalToEAR(nominalRate);
  }

  // 3. XIRR method (if enabled)
  if (includeXIRR) {
    const cashFlows = buildCashFlows(classified);
    if (cashFlows.length >= 2) {
      const xirrResult = calculateXIRR(cashFlows);
      results.xirr = xirrResult;
      // If XIRR converged, use it as the primary APR
      if (xirrResult.converged && xirrResult.rate !== null) {
        results.effectiveAPR = xirrResult.rate;
      }
    }
  }

  // 4. Regulatory checks
  results.regulatoryFlags = runRegulatoryChecks(classified, {
    overdraftLimit,
    nominalRate,
    currency,
  });

  // 5. Date range
  results.startDate = costRatioResult.startDate;
  results.endDate = costRatioResult.endDate;

  return results;
}
