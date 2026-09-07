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
  { key: 'description', label: 'Description' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'balance', label: 'Balance' },
  { key: 'interest', label: 'Interest' },
  { key: 'fees', label: 'Fees' },
  { key: 'ignore', label: 'Ignore' },
];
