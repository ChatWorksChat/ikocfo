// Column auto-detection heuristics for bank statements

const PATTERNS = {
  date: [/^date$/i, /posting\s*date/i, /trans(action)?\s*date/i, /^dt$/i, /^txn\s*date$/i, /^op\.?\s*date$/i],
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

// --- Template-aware classification ---

/**
 * Classify transactions using a bank template's interest/fee patterns
 * instead of (or in addition to) the default regex-based classification.
 *
 * Falls back to the default classifyTransactions() if no template is provided.
 */
export function classifyWithTemplate(transactions, template) {
  if (!template) return classifyTransactions(transactions);

  const interestPatterns = template.interestPatterns || [];
  const feePatterns = template.feePatterns || [];

  // If the template uses the default account-prefixed regex, fall back to default
  const usesDefaultRegex = interestPatterns.length > 0 &&
    interestPatterns.every(p => p.regex && p.classification === 'account_prefixed');
  if (usesDefaultRegex) {
    // Use default classification but add template fee patterns
    const classified = classifyTransactions(transactions);
    if (feePatterns.length > 0) {
      return classified.map(tx => {
        if (tx.classification === 'regular') {
          const desc = (tx.description || '').toUpperCase();
          for (const feeKey of feePatterns) {
            if (desc.includes(feeKey.toUpperCase())) {
              return { ...tx, classification: 'fee' };
            }
          }
        }
        return tx;
      });
    }
    return classified;
  }

  // Template uses keyword-based matching (e.g., BOA)
  return transactions.map(tx => {
    const desc = (tx.description || '').toUpperCase();
    let classification = 'regular';

    // Check interest patterns (keyword-based)
    for (const pattern of interestPatterns) {
      if (pattern.keyword && desc.includes(pattern.keyword.toUpperCase())) {
        classification = pattern.classification || 'overdraft_interest';
        break;
      }
      if (pattern.regex) {
        const re = new RegExp(pattern.regex, 'i');
        if (re.test(desc)) {
          classification = pattern.classification || 'overdraft_interest';
          break;
        }
      }
    }

    // Check fee patterns
    if (classification === 'regular') {
      for (const feeKey of feePatterns) {
        if (desc.includes(feeKey.toUpperCase())) {
          classification = 'fee';
          break;
        }
      }
    }

    // Check loan recovery (always use default pattern)
    if (classification === 'regular' && LOAN_RECOVERY_PATTERN.test(tx.description || '')) {
      classification = 'loan_recovery';
    }

    return { ...tx, classification, primaryAccount: null };
  });
}

/**
 * Detect which bank template matches the uploaded statement.
 * Checks preamble rows and headers against template aliases and column headers.
 *
 * @param {Array} rawRows - All raw rows from the parsed file
 * @param {number} headerRowIdx - Index of the detected header row
 * @param {Array} templates - Array of bank template objects
 * @returns {Object|null} Matching template or null
 */
export function detectBankFromTemplate(rawRows, headerRowIdx, templates) {
  if (!templates || templates.length === 0) return null;

  // Build a text pool from preamble + headers + first few data rows
  const preambleRows = rawRows.slice(0, headerRowIdx);
  const headerRow = rawRows[headerRowIdx] || [];
  const firstDataRows = rawRows.slice(headerRowIdx + 1, headerRowIdx + 6);

  const preambleText = preambleRows
    .map(row => row.map(cell => String(cell || '')).join(' '))
    .join(' ')
    .toUpperCase();

  const headerTexts = headerRow.map(cell => String(cell || '').trim());
  const headerTextUpper = headerTexts.join(' ').toUpperCase();

  const dataText = firstDataRows
    .map(row => row.map(cell => String(cell || '')).join(' '))
    .join(' ')
    .toUpperCase();

  const combinedText = preambleText + ' ' + headerTextUpper + ' ' + dataText;

  let bestMatch = null;
  let bestScore = 0;

  for (const template of templates) {
    let score = 0;

    // Check alias matches in combined text
    const aliases = template.aliases || [];
    for (const alias of aliases) {
      if (combinedText.includes(alias.toUpperCase())) {
        score += 10;
        break;
      }
    }

    // Check column header overlap
    const templateHeaders = template.columnHeaders || [];
    if (templateHeaders.length > 0) {
      let headerMatches = 0;
      for (const tplHeader of templateHeaders) {
        const tplUpper = tplHeader.toUpperCase().trim();
        for (const hdr of headerTexts) {
          if (hdr.toUpperCase().trim() === tplUpper) {
            headerMatches++;
            break;
          }
        }
      }
      // Score based on fraction of template headers matched
      if (headerMatches >= 3) {
        score += headerMatches * 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }

  // Require a minimum confidence score (at least alias match or 3+ header matches)
  return bestScore >= 9 ? bestMatch : null;
}
