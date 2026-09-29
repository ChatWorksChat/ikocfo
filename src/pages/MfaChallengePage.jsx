import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { verifyMfa, getWebAuthnAuthOptions, verifyWebAuthnAuth } from '../lib/auth.js';

export default function MfaChallengePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mfaToken, methods = [] } = location.state || {};

  const hasTotp = methods.includes('totp');
  const hasWebauthn = methods.includes('webauthn');

  const [activeMethod, setActiveMethod] = useState(hasWebauthn ? 'webauthn' : 'totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

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

  async function handleTotpSubmit(e) {
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

  async function handleWebAuthn() {
    setError('');
    setLoading(true);

    try {
      // Get authentication options from server
      const optResult = await getWebAuthnAuthOptions(mfaToken);
      if (!optResult.success) {
        setError(optResult.error);
        setLoading(false);
        return;
      }

      // Trigger browser fingerprint/security key prompt
      const authResponse = await startAuthentication({ optionsJSON: optResult.options });

      // Verify with server
      const verifyResult = await verifyWebAuthnAuth(mfaToken, authResponse);
      setLoading(false);

      if (verifyResult.success) {
        navigate('/dashboard', { replace: true });
      } else {
        setError(verifyResult.error);
      }
    } catch (err) {
      setLoading(false);
      if (err.name === 'NotAllowedError') {
        setError('Authentication was cancelled or timed out. Please try again.');
      } else {
        setError('Fingerprint verification failed. Please try again or use another method.');
      }
    }
  }

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Two-Factor Authentication</h1>
        <p>Verify your identity to continue</p>

        {error && <div className="alert alert-error">{error}</div>}

        {/* Method selector tabs — only show if user has both methods */}
        {hasTotp && hasWebauthn && !useRecovery && (
          <div style={{
            display: 'flex',
            gap: '0',
            marginBottom: '24px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => { setActiveMethod('webauthn'); setError(''); }}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                background: activeMethod === 'webauthn' ? 'var(--color-primary)' : 'transparent',
                color: activeMethod === 'webauthn' ? '#fff' : 'var(--color-text)',
                fontWeight: 700,
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
              }}
            >
              Fingerprint
            </button>
            <button
              type="button"
              onClick={() => { setActiveMethod('totp'); setError(''); }}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                borderLeft: '1px solid var(--color-border)',
                background: activeMethod === 'totp' ? 'var(--color-primary)' : 'transparent',
                color: activeMethod === 'totp' ? '#fff' : 'var(--color-text)',
                fontWeight: 700,
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
              }}
            >
              Authenticator
            </button>
          </div>
        )}

        {/* WebAuthn (fingerprint) view */}
        {activeMethod === 'webauthn' && !useRecovery && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 20px',
              borderRadius: '50%',
              background: 'rgba(132, 88, 163, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '36px',
            }}>
              &#128270;
            </div>
            <p style={{ color: 'var(--color-text-light)', marginBottom: '24px', fontSize: 'var(--font-size-sm)' }}>
              Use your fingerprint, face recognition, or security key to verify your identity.
            </p>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleWebAuthn}
              disabled={loading}
            >
              {loading ? 'Verifying...' : 'Verify with Fingerprint'}
            </button>
          </div>
        )}

        {/* TOTP / Recovery code view */}
        {(activeMethod === 'totp' || useRecovery || !hasWebauthn) && activeMethod !== 'webauthn' && (
          <form onSubmit={handleTotpSubmit}>
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
        )}

        {/* Recovery toggle — only for TOTP view */}
        {(activeMethod === 'totp' || useRecovery) && (
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
        )}

        <div className="auth-link">
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
