// Column auto-detection heuristics for bank statements

const PATTERNS = {
  date: [/^date$/i, /value\s*date/i, /posting\s*date/i, /trans(action)?\s*date/i, /^dt$/i],
  description: [/^desc/i, /narrative/i, /particulars/i, /details/i, /reference/i, /^narration$/i],
  debit: [/^debit/i, /^dr$/i, /withdrawal/i, /^debit\s*amount/i, /^amount\s*debit/i],
  credit: [/^credit$/i, /^cr$/i, /deposit/i, /^credit\s*amount/i, /^amount\s*credit/i],
  balance: [/balance/i, /running\s*bal/i, /^bal$/i, /closing\s*bal/i],
  interest: [/interest/i, /^int\s*charged/i, /int\.\s*charged/i],
  fees: [/^fee/i, /^charge/i, /commission/i, /ledger\s*fee/i, /service\s*charge/i],
};

export function autoDetectColumns(headers) {
  const mapping = {};
  const used = new Set();

  // For each column type, try to match a header
  for (const [type, patterns] of Object.entries(PATTERNS)) {
    for (const header of headers) {
      if (used.has(header)) continue;
      const normalized = header.trim();
      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          mapping[header] = type;
          used.add(header);
          break;
        }
      }
      if (mapping[header]) break;
    }
  }

  // Mark remaining as 'ignore'
  for (const header of headers) {
    if (!mapping[header]) {
      mapping[header] = 'ignore';
    }
  }

  return mapping;
}

export function applyMapping(rows, columnMapping) {
  return rows.map(row => {
    const mapped = {};
    for (const [originalCol, type] of Object.entries(columnMapping)) {
      if (type === 'ignore') continue;
      mapped[type] = row[originalCol];
    }
    return mapped;
  });
}

export function validateMapping(columnMapping) {
  const types = Object.values(columnMapping);
  const errors = [];

  if (!types.includes('date')) {
    errors.push('A Date column must be mapped.');
  }
  if (!types.includes('balance') && !types.includes('debit') && !types.includes('credit')) {
    errors.push('At least a Balance, Debit, or Credit column must be mapped.');
  }

  return { valid: errors.length === 0, errors };
}
