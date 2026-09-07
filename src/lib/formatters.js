// Number, date, and currency formatting utilities

export function formatPercent(value, decimals = 2) {
  if (value == null || isNaN(value)) return '--';
  return `${value.toFixed(decimals)}%`;
}

export function formatCurrency(value, currencyCode = 'KES') {
  if (value == null || isNaN(value)) return '--';
  const symbols = { KES: 'KSh', USD: '$', EUR: '\u20AC', GBP: '\u00A3' };
  const symbol = symbols[currencyCode] || currencyCode;
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-${symbol} ${formatted}` : `${symbol} ${formatted}`;
}

export function formatNumber(value, decimals = 0) {
  if (value == null || isNaN(value)) return '--';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(date) {
  if (!date) return '--';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateRange(startDate, endDate) {
  return `${formatDate(startDate)} \u2014 ${formatDate(endDate)}`;
}

export function parseNumeric(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const str = String(value).trim();

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // Try YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymd) {
    const d = new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: native Date parsing
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
