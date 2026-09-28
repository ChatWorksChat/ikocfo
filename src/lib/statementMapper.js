// Column auto-detection heuristics for bank statements

const PATTERNS = {
  date: [/^date$/i, /posting\s*date/i, /trans(action)?\s*date/i, /^dt$/i, /^txn\s*date$/i],
  valueDate: [/^value$/i, /value\s*date/i, /^val\s*date$/i, /^val\.?\s*dt$/i],
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

// --- Transaction Classification ---

const INTEREST_PATTERN = /(\d+):Int\.Coll:/i;
const FEE_PATTERNS = [
  /ledger\s*fee/i,
  /excise\s*duty/i,
  /commitment\s*fee/i,
  /standing\s*instruction/i,
  /swift\s*charges?/i,
  /service\s*charge/i,
  /commission/i,
  /arrangement\s*fee/i,
  /facility\s*fee/i,
];
const LOAN_RECOVERY_PATTERN = /\d+:Loan\s*Recovery:/i;

/**
 * Classify transactions by analyzing descriptions to identify:
 * - overdraft_interest: interest charged on the primary OD account
 * - other_facility_interest: interest for other credit facilities
 * - fee: bank fees (ledger fee, commitment fee, excise duty, etc.)
 * - loan_recovery: loan repayment entries
 * - regular: normal debits/credits
 *
 * The primary OD account is auto-detected as the shortest account number
 * found in Int.Coll entries (typically the main current account).
 */
export function classifyTransactions(transactions) {
  // First pass: collect account numbers from Int.Coll entries
  const interestAccounts = {};
  for (const tx of transactions) {
    const desc = (tx.description || '').trim();
    const match = desc.match(INTEREST_PATTERN);
    if (match) {
      const acctNum = match[1];
      interestAccounts[acctNum] = (interestAccounts[acctNum] || 0) + 1;
    }
  }

  // Determine primary OD account: shortest account number
  let primaryAccount = null;
  const acctNums = Object.keys(interestAccounts);
  if (acctNums.length === 1) {
    primaryAccount = acctNums[0];
  } else if (acctNums.length > 1) {
    primaryAccount = acctNums.sort((a, b) => a.length - b.length)[0];
  }

  // Second pass: classify each transaction
  return transactions.map(tx => {
    const desc = (tx.description || '').trim();
    let classification = 'regular';

    const intMatch = desc.match(INTEREST_PATTERN);
    if (intMatch) {
      classification = intMatch[1] === primaryAccount
        ? 'overdraft_interest'
        : 'other_facility_interest';
    } else if (LOAN_RECOVERY_PATTERN.test(desc)) {
      classification = 'loan_recovery';
    } else {
      for (const pattern of FEE_PATTERNS) {
        if (pattern.test(desc)) {
          classification = 'fee';
          break;
        }
      }
    }

    return { ...tx, classification, primaryAccount };
  });
}

/**
 * Detect bank name from statement content by checking descriptions
 * against known bank aliases.
 */
export function detectBank(rows, headers, bankRates) {
  // Check all text content (headers + first 50 rows of descriptions)
  const textPool = [...headers];
  const descKey = Object.keys(rows[0] || {}).find(k =>
    /desc|narrative|particulars|details/i.test(k)
  );
  if (descKey) {
    for (const row of rows.slice(0, 50)) {
      if (row[descKey]) textPool.push(String(row[descKey]));
    }
  }
  // Also check all header-row values
  for (const row of rows.slice(0, 5)) {
    for (const val of Object.values(row)) {
      if (val) textPool.push(String(val));
    }
  }

  const combined = textPool.join(' ').toUpperCase();

  for (const bank of bankRates) {
    for (const alias of bank.aliases) {
      if (combined.includes(alias.toUpperCase())) {
        return bank;
      }
    }
  }
  return null;
}
