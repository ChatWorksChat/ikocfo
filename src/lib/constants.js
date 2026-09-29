// IKO CFO Constants & Configuration

export const BRAND = {
  name: 'IKO CFO',
  tagline: 'Know Your True Overdraft Cost',
  siteUrl: 'https://ikocfo.com',
  colors: {
    primary: '#8458a3',
    secondary: '#e86060',
    text: '#161616',
    bg: '#f9f9ff',
    footer: '#38454E',
  },
};

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    statements: 1,
    maxRows: 1000,
    xirr: false,
    pdfExport: false,
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 9,
    statements: 10,
    maxRows: 5000,
    xirr: true,
    pdfExport: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 29,
    statements: Infinity,
    maxRows: Infinity,
    xirr: true,
    pdfExport: true,
  },
};

// API URL for backend (Lambda + API Gateway)
export const API_URL = import.meta.env.VITE_API_URL || '';

// Stripe configuration
// Replace these with actual Stripe keys after running the setup script
export const STRIPE = {
  publishableKey: import.meta.env.VITE_STRIPE_PK || '',
  prices: {
    basic: import.meta.env.VITE_STRIPE_PRICE_BASIC || '',
    pro: import.meta.env.VITE_STRIPE_PRICE_PRO || '',
  },
  successUrl: `${window.location.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${window.location.origin}/pricing`,
};

export const CURRENCIES = {
  KES: { code: 'KES', name: 'Kenyan Shilling', dayCount: 365, symbol: 'KSh' },
  USD: { code: 'USD', name: 'US Dollar', dayCount: 360, symbol: '$' },
  EUR: { code: 'EUR', name: 'Euro', dayCount: 360, symbol: '\u20AC' },
  GBP: { code: 'GBP', name: 'British Pound', dayCount: 360, symbol: '\u00A3' },
};

export const STORAGE_KEYS = {
  users: 'ikocfo_users',
  session: 'ikocfo_session',
  history: 'ikocfo_history',
};

export const COLUMN_TYPES = [
  { key: 'date', label: 'Date' },
  { key: 'valueDate', label: 'Value Date' },
  { key: 'description', label: 'Description' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'balance', label: 'Balance' },
  { key: 'interest', label: 'Interest' },
  { key: 'fees', label: 'Fees' },
  { key: 'ignore', label: 'Ignore' },
];

// Fallback static bank rates (overridden by API data when available)
export const BANK_RATES = [];

// CBK-licensed banks for dropdown population
export const KENYA_BANKS = [
  // Commercial Banks (39)
  { name: 'Absa Bank Kenya PLC', type: 'commercial' },
  { name: 'Access Bank (Kenya) PLC', type: 'commercial' },
  { name: 'African Banking Corporation Ltd', type: 'commercial' },
  { name: 'Bank of Africa Ltd', type: 'commercial' },
  { name: 'Bank of Baroda (Kenya) Limited', type: 'commercial' },
  { name: 'Bank of India', type: 'commercial' },
  { name: 'Citibank N.A. Kenya', type: 'commercial' },
  { name: 'Co-operative Bank of Kenya Ltd', type: 'commercial' },
  { name: 'Commercial International Bank (CIB) Kenya Ltd', type: 'commercial' },
  { name: 'Consolidated Bank of Kenya Limited', type: 'commercial' },
  { name: 'Credit Bank Ltd', type: 'commercial' },
  { name: 'Development Bank of Kenya Ltd', type: 'commercial' },
  { name: 'Diamond Trust Bank Kenya Limited', type: 'commercial' },
  { name: 'DIB Bank Kenya Ltd', type: 'commercial' },
  { name: 'Ecobank Kenya Ltd', type: 'commercial' },
  { name: 'Equity Bank Kenya Ltd', type: 'commercial' },
  { name: 'Family Bank Ltd', type: 'commercial' },
  { name: 'Guaranty Trust Bank (Kenya) Ltd', type: 'commercial' },
  { name: 'Guardian Bank Limited', type: 'commercial' },
  { name: 'Gulf African Bank Limited', type: 'commercial' },
  { name: 'Habib Bank AG Zurich', type: 'commercial' },
  { name: 'HFC Ltd', type: 'commercial' },
  { name: 'I & M Bank Limited', type: 'commercial' },
  { name: 'KCB Bank Kenya Limited', type: 'commercial' },
  { name: 'Kingdom Bank Limited', type: 'commercial' },
  { name: 'M-Oriental Commercial Bank Limited', type: 'commercial' },
  { name: 'Middle East Bank (K) Ltd', type: 'commercial' },
  { name: 'National Bank of Kenya Ltd', type: 'commercial' },
  { name: 'NCBA Bank Kenya PLC', type: 'commercial' },
  { name: 'Paramount Bank Ltd', type: 'commercial' },
  { name: 'Premier Bank Limited', type: 'commercial' },
  { name: 'Prime Bank Ltd', type: 'commercial' },
  { name: 'SBM Bank Kenya Ltd', type: 'commercial' },
  { name: 'Sidian Bank Ltd', type: 'commercial' },
  { name: 'Spire Bank Ltd', type: 'commercial' },
  { name: 'Stanbic Bank Kenya Ltd', type: 'commercial' },
  { name: 'Standard Chartered Bank Kenya Ltd', type: 'commercial' },
  { name: 'UBA Kenya Bank Ltd', type: 'commercial' },
  { name: 'Victoria Commercial Bank Limited', type: 'commercial' },
  // Microfinance Banks (14)
  { name: 'Branch Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Caritas Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Choice Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Faulu Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Kenya Women Microfinance Bank PLC', type: 'microfinance' },
  { name: 'LOLC Microfinance Bank PLC', type: 'microfinance' },
  { name: 'Muungano Microfinance Bank Limited', type: 'microfinance' },
  { name: 'On It Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Rafiki Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Salaam Microfinance Bank Limited', type: 'microfinance' },
  { name: 'SMEP Microfinance Bank PLC', type: 'microfinance' },
  { name: 'Sumac Microfinance Bank Limited', type: 'microfinance' },
  { name: 'U & I Microfinance Bank Limited', type: 'microfinance' },
  { name: 'Umba Microfinance Bank Limited', type: 'microfinance' },
];
