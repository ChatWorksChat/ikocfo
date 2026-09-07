// Day-count conventions for different currencies

/**
 * Get the number of days in a year for the given currency.
 * KES: Actual/365 (Kenya standard)
 * USD, EUR, GBP: Actual/360
 */
export function getDaysInYear(currencyCode) {
  if (currencyCode === 'KES') return 365;
  return 360; // USD, EUR, GBP
}

/**
 * Calculate the number of actual days between two dates.
 */
export function daysBetween(startDate, endDate) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate the year fraction between two dates using the appropriate convention.
 */
export function yearFraction(startDate, endDate, currencyCode) {
  const days = daysBetween(startDate, endDate);
  const base = getDaysInYear(currencyCode);
  return days / base;
}
