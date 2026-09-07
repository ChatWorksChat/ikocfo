// Newton-Raphson XIRR solver

import { parseNumeric, parseDate } from './formatters.js';

/**
 * Calculate XIRR (Extended Internal Rate of Return) using Newton-Raphson iteration.
 *
 * @param {Array} transactions - Array of { date, amount } where amount is
 *   negative for outflows (costs/interest/fees) and positive for inflows.
 * @param {number} guess - Initial guess (default 0.1 = 10%)
 * @returns {{ rate: number, converged: boolean }}
 */
export function calculateXIRR(transactions, guess = 0.1) {
  // Build cash flows
  const cashFlows = transactions
    .map(t => ({
      date: parseDate(t.date),
      amount: parseNumeric(t.amount),
    }))
    .filter(cf => cf.date !== null && cf.amount !== 0)
    .sort((a, b) => a.date - b.date);

  if (cashFlows.length < 2) {
    return { rate: null, converged: false, error: 'Need at least 2 cash flows.' };
  }

  const firstDate = cashFlows[0].date;

  // Year fractions from first date
  const yearFracs = cashFlows.map(cf => {
    const diffMs = cf.date.getTime() - firstDate.getTime();
    return diffMs / (365.25 * 24 * 60 * 60 * 1000);
  });

  let rate = guess;
  const maxIter = 100;
  const tolerance = 1e-7;

  for (let iter = 0; iter < maxIter; iter++) {
    let npv = 0;
    let dnpv = 0;

    for (let i = 0; i < cashFlows.length; i++) {
      const t = yearFracs[i];
      const amount = cashFlows[i].amount;
      const factor = Math.pow(1 + rate, t);

      if (!isFinite(factor) || factor === 0) {
        return { rate: null, converged: false, error: 'Numerical overflow.' };
      }

      npv += amount / factor;
      dnpv -= t * amount / (factor * (1 + rate));
    }

    if (Math.abs(dnpv) < 1e-14) {
      break; // avoid division by ~zero
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return { rate: newRate * 100, converged: true };
    }

    rate = newRate;

    // Guard against divergence
    if (!isFinite(rate) || rate < -1) {
      return { rate: null, converged: false, error: 'Rate diverged.' };
    }
  }

  // Did not converge but return best guess
  return { rate: rate * 100, converged: false };
}

/**
 * Build XIRR cash flows from parsed statement transactions.
 * Treats the overdraft balance as the investment, and interest/fees as costs.
 */
export function buildCashFlows(transactions) {
  const flows = [];
  const sorted = [...transactions]
    .map(t => ({
      date: parseDate(t.date),
      balance: parseNumeric(t.balance),
      interest: parseNumeric(t.interest),
      fees: parseNumeric(t.fees),
      debit: parseNumeric(t.debit),
      credit: parseNumeric(t.credit),
    }))
    .filter(t => t.date !== null)
    .sort((a, b) => a.date - b.date);

  if (sorted.length === 0) return flows;

  // Initial balance as positive inflow (bank lends money)
  const first = sorted[0];
  if (first.balance !== 0) {
    flows.push({
      date: first.date,
      amount: Math.abs(first.balance),
    });
  }

  // Interest and fees are negative outflows (cost to borrower)
  for (const tx of sorted) {
    if (tx.interest !== 0) {
      flows.push({ date: tx.date, amount: -Math.abs(tx.interest) });
    }
    if (tx.fees !== 0) {
      flows.push({ date: tx.date, amount: -Math.abs(tx.fees) });
    }
  }

  // Final balance repayment as negative outflow
  const last = sorted[sorted.length - 1];
  if (last.balance !== 0) {
    flows.push({
      date: last.date,
      amount: -Math.abs(last.balance),
    });
  }

  return flows;
}
