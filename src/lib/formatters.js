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

  // Handle Excel serial date numbers (e.g., 46235 = Aug 1, 2026)
  // Excel serial 1 = Jan 1, 1900. Serial 60 = phantom Feb 29, 1900 (Excel bug).
  // For serial > 59, subtract 1 to correct for the phantom leap day.
  if (typeof value === 'number' && value >= 1 && value <= 100000 && Number.isInteger(value)) {
    const d = new Date(1900, 0, value > 59 ? value - 1 : value);
    if (!isNaN(d.getTime())) return d;
  }

  const str = String(value).trim();

  // Check for Excel serial dates as strings (pure integers like "46235")
  if (/^\d+$/.test(str)) {
    const serial = parseInt(str);
    if (serial >= 1 && serial <= 100000) {
      const d = new Date(1900, 0, serial > 59 ? serial - 1 : serial);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // Try DD/MM/YY or DD-MM-YY (2-digit year)
  const dmy2 = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (dmy2) {
    const yy = parseInt(dmy2[3]);
    const fullYear = yy < 50 ? 2000 + yy : 1900 + yy;
    const d = new Date(fullYear, parseInt(dmy2[2]) - 1, parseInt(dmy2[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // Try YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymd) {
    const d = new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // Handle dates with trailing text from PDF column misalignment
  // (e.g., "30/09/26 DEBITOR" where text was merged with the date)
  const leading = str.match(/^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\s/);
  if (leading) {
    const part = leading[1];
    const ldmy = part.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ldmy) {
      const d = new Date(parseInt(ldmy[3]), parseInt(ldmy[2]) - 1, parseInt(ldmy[1]));
      if (!isNaN(d.getTime())) return d;
    }
    const ldmy2 = part.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
    if (ldmy2) {
      const yy = parseInt(ldmy2[3]);
      const fy = yy < 50 ? 2000 + yy : 1900 + yy;
      const d = new Date(fy, parseInt(ldmy2[2]) - 1, parseInt(ldmy2[1]));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback: native Date parsing
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
