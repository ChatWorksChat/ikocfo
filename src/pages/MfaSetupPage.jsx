import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { startRegistration } from '@simplewebauthn/browser';
import {
  getCurrentUser,
  setupTotp,
  verifyTotpSetup,
  getWebAuthnRegisterOptions,
  verifyWebAuthnRegistration,
} from '../lib/auth.js';

export default function MfaSetupPage() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  // Steps: 'choose' | 'totp-qr' | 'webauthn' | 'recovery' | 'done'
  const [step, setStep] = useState('choose');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  // --- TOTP Flow ---
  async function handleStartTotp() {
    setError('');
    setLoading(true);
    const result = await setupTotp(user.email);
    setLoading(false);

    if (result.success) {
      setSecret(result.secret);
      setOtpauthUri(result.otpauthUri);
      setStep('totp-qr');
    } else {
      setError(result.error);
    }
  }

  async function handleVerifyTotp(e) {
    e.preventDefault();
    setError('');

    const trimmed = code.trim();
    if (!trimmed || trimmed.length !== 6) {
      setError('Please enter a valid 6-digit code.');
      return;
    }

    setLoading(true);
    const result = await verifyTotpSetup(user.email, trimmed);
    setLoading(false);

    if (result.success) {
      setRecoveryCodes(result.recoveryCodes);
      setStep('recovery');
    } else {
      setError(result.error);
    }
  }

  // --- WebAuthn Flow ---
  async function handleStartWebAuthn() {
    setError('');
    setLoading(true);

    try {
      const optResult = await getWebAuthnRegisterOptions(user.email);
      if (!optResult.success) {
        setError(optResult.error);
        setLoading(false);
        return;
      }

      // Trigger the browser's fingerprint/security key registration prompt
      const regResponse = await startRegistration({ optionsJSON: optResult.options });

      // Verify with server
      const verifyResult = await verifyWebAuthnRegistration(
        user.email,
        regResponse,
        'Fingerprint',
      );
      setLoading(false);

      if (verifyResult.success) {
        if (verifyResult.recoveryCodes) {
          setRecoveryCodes(verifyResult.recoveryCodes);
          setStep('recovery');
        } else {
          setStep('done');
        }
      } else {
        setError(verifyResult.error);
      }
    } catch (err) {
      setLoading(false);
      if (err.name === 'NotAllowedError') {
        setError('Registration was cancelled. Please try again.');
      } else if (err.name === 'InvalidStateError') {
        setError('This device is already registered.');
      } else {
        setError(`Registration failed: ${err.message}`);
      }
    }
  }

  // --- Recovery codes ---
  function handleCopyCodes() {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
  }

  function handleDownloadCodes() {
    const text = `IKO CFO Recovery Codes\nGenerated: ${new Date().toLocaleDateString()}\nAccount: ${user.email}\n\n${recoveryCodes.join('\n')}\n\nEach code can only be used once.\nKeep these codes in a safe place.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ikocfo-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Step: Choose Method ---
  if (step === 'choose') {
    return (
      <div className="page-container-narrow">
        <div className="auth-card glass-card">
          <h1>Set Up Two-Factor Authentication</h1>
          <p>Choose a method to add an extra layer of security to your account.</p>

          {error && <div className="alert alert-error">{error}</div>}

          {/* Fingerprint / Windows Hello / Touch ID */}
          <button
            onClick={handleStartWebAuthn}
            disabled={loading}
            style={{
              width: '100%',
              padding: '20px',
              background: 'var(--color-bg)',
              border: '2px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: '12px',
              transition: 'border-color 0.2s',
            }}
            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '32px' }}>&#128270;</span>
              <div>
                <strong style={{ display: 'block', fontSize: 'var(--font-size-base)' }}>
                  {loading ? 'Waiting for device...' : 'Fingerprint / Windows Hello / Touch ID'}
                </strong>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                  Use your device's built-in biometric authentication
                </span>
              </div>
            </div>
          </button>

          {/* Google Authenticator / TOTP */}
          <button
            onClick={handleStartTotp}
            disabled={loading}
            style={{
              width: '100%',
              padding: '20px',
              background: 'var(--color-bg)',
              border: '2px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: '24px',
              transition: 'border-color 0.2s',
            }}
            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '32px' }}>&#128241;</span>
              <div>
                <strong style={{ display: 'block', fontSize: 'var(--font-size-base)' }}>
                  Google Authenticator / TOTP App
                </strong>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                  Use Google Authenticator, Authy, or similar app
                </span>
              </div>
            </div>
          </button>

          <div className="auth-link">
            <button
              type="button"
              onClick={() => navigate('/dashboard', { replace: true })}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Step: TOTP QR Code ---
  if (step === 'totp-qr') {
    return (
      <div className="page-container-narrow">
        <div className="auth-card glass-card">
          <h1>Scan QR Code</h1>
          <p>Scan this QR code with your authenticator app, then enter the 6-digit code.</p>

          {error && <div className="alert alert-error">{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <div style={{ background: '#fff', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
              <QRCodeSVG value={otpauthUri} size={200} />
            </div>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
            >
              {showSecret ? 'Hide manual entry key' : "Can't scan? Enter key manually"}
            </button>
            {showSecret && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'monospace',
                fontSize: 'var(--font-size-sm)',
                wordBreak: 'break-all',
                letterSpacing: '2px',
              }}>
                {secret}
              </div>
            )}
          </div>

          <form onSubmit={handleVerifyTotp}>
            <div className="form-group">
              <label className="form-label" htmlFor="totp-code">Verification Code</label>
              <input
                className="form-input"
                id="totp-code"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                style={{
                  textAlign: 'center',
                  fontSize: '1.5rem',
                  letterSpacing: '0.5rem',
                  fontWeight: 700,
                }}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify & Enable'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Step: Recovery Codes ---
  if (step === 'recovery') {
    return (
      <div className="page-container-narrow">
        <div className="auth-card glass-card">
          <h1>Save Recovery Codes</h1>
          <p>Save these codes in a safe place. You can use them to access your account if you lose your authenticator device.</p>

          <div style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-sm)',
            padding: '20px',
            marginBottom: '24px',
            border: '1px solid var(--color-border)',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              fontFamily: 'monospace',
              fontSize: 'var(--font-size-base)',
              textAlign: 'center',
            }}>
              {recoveryCodes.map((code, i) => (
                <div key={i} style={{
                  padding: '8px',
                  background: 'var(--color-bg-white)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                }}>
                  {code}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={handleCopyCodes}>
              Copy
            </button>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={handleDownloadCodes}>
              Download
            </button>
          </div>

          <div style={{
            padding: '14px 20px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-sm)',
            marginBottom: '20px',
            background: 'rgba(243, 156, 18, 0.08)',
            border: '1px solid rgba(243, 156, 18, 0.2)',
            color: '#b7791f',
          }}>
            Each code can only be used once. Store them securely.
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={() => setStep('done')}
          >
            I have saved my codes
          </button>
        </div>
      </div>
    );
  }

  // --- Step: Done ---
  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(46, 204, 113, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '28px',
            color: 'var(--color-success)',
          }}>
            &#10003;
          </div>
          <h1>Two-Factor Authentication Enabled</h1>
          <p>Your account is now protected with an additional layer of security.</p>
        </div>

        <button
          className="btn btn-primary btn-lg"
          onClick={() => navigate('/dashboard', { replace: true })}
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
