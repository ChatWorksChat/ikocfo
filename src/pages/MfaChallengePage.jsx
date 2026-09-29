import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { verifyMfa } from '../lib/auth.js';

export default function MfaChallengePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mfaToken, methods } = location.state || {};

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

  // If no MFA state, redirect to login
  if (!mfaToken) {
    return (
      <div className="page-container-narrow">
        <div className="auth-card glass-card">
          <h1>Session Expired</h1>
          <p>Your MFA session has expired. Please log in again.</p>
          <Link to="/login" className="btn btn-primary btn-lg">Back to Login</Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmed = code.trim();
    if (!trimmed) {
      setError('Please enter a verification code.');
      return;
    }

    setLoading(true);
    const method = useRecovery ? 'recovery' : 'totp';
    const result = await verifyMfa(mfaToken, trimmed, method);
    setLoading(false);

    if (result.success) {
      navigate('/dashboard', { replace: true });
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Two-Factor Authentication</h1>
        <p>
          {useRecovery
            ? 'Enter one of your recovery codes'
            : 'Enter the 6-digit code from your authenticator app'}
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="mfa-code">
              {useRecovery ? 'Recovery Code' : 'Verification Code'}
            </label>
            <input
              className="form-input"
              id="mfa-code"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={useRecovery ? 'XXXX-XXXX' : '000000'}
              autoComplete="one-time-code"
              autoFocus
              style={!useRecovery ? {
                textAlign: 'center',
                fontSize: '1.5rem',
                letterSpacing: '0.5rem',
                fontWeight: 700,
              } : undefined}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        <div className="auth-link" style={{ marginTop: '24px' }}>
          {useRecovery ? (
            <button
              type="button"
              onClick={() => { setUseRecovery(false); setCode(''); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
            >
              Use authenticator app instead
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setUseRecovery(true); setCode(''); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
            >
              Use a recovery code instead
            </button>
          )}
        </div>

        <div className="auth-link">
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
