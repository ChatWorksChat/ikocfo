import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import {
  getCurrentUser,
  getMfaStatus,
  disableTotp,
  regenerateRecoveryCodes,
  getWebAuthnRegisterOptions,
  verifyWebAuthnRegistration,
  removeWebAuthnCredential,
} from '../lib/auth.js';

export default function MfaSettingsPage() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Disable TOTP
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Regenerate codes
  const [showRegen, setShowRegen] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState(null);

  // Remove WebAuthn
  const [removeId, setRemoveId] = useState(null);
  const [removePassword, setRemovePassword] = useState('');
  const [removing, setRemoving] = useState(false);

  // Add WebAuthn
  const [addingWebauthn, setAddingWebauthn] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    const result = await getMfaStatus(user.email);
    setLoading(false);
    if (result.success) {
      setStatus(result);
    } else {
      setError(result.error);
    }
  }

  async function handleDisable(e) {
    e.preventDefault();
    setError('');
    if (!disablePassword) { setError('Password is required.'); return; }
    setDisabling(true);
    const result = await disableTotp(user.email, disablePassword);
    setDisabling(false);
    if (result.success) {
      setSuccess('Authenticator app has been disabled.');
      setShowDisable(false);
      setDisablePassword('');
      loadStatus();
    } else {
      setError(result.error);
    }
  }

  async function handleRegenerate(e) {
    e.preventDefault();
    setError('');
    if (!regenPassword) { setError('Password is required.'); return; }
    setRegenerating(true);
    const result = await regenerateRecoveryCodes(user.email, regenPassword);
    setRegenerating(false);
    if (result.success) {
      setNewCodes(result.recoveryCodes);
      setShowRegen(false);
      setRegenPassword('');
      loadStatus();
    } else {
      setError(result.error);
    }
  }

  async function handleAddWebAuthn() {
    setError('');
    setSuccess('');
    setAddingWebauthn(true);

    try {
      const optResult = await getWebAuthnRegisterOptions(user.email);
      if (!optResult.success) {
        setError(optResult.error);
        setAddingWebauthn(false);
        return;
      }

      const regResponse = await startRegistration({ optionsJSON: optResult.options });
      const verifyResult = await verifyWebAuthnRegistration(user.email, regResponse, 'Fingerprint');
      setAddingWebauthn(false);

      if (verifyResult.success) {
        setSuccess('Fingerprint registered successfully.');
        if (verifyResult.recoveryCodes) {
          setNewCodes(verifyResult.recoveryCodes);
        }
        loadStatus();
      } else {
        setError(verifyResult.error);
      }
    } catch (err) {
      setAddingWebauthn(false);
      if (err.name === 'NotAllowedError') {
        setError('Registration was cancelled.');
      } else if (err.name === 'InvalidStateError') {
        setError('This device is already registered.');
      } else {
        setError(`Registration failed: ${err.message}`);
      }
    }
  }

  async function handleRemoveWebAuthn(e) {
    e.preventDefault();
    setError('');
    if (!removePassword) { setError('Password is required.'); return; }
    setRemoving(true);
    const result = await removeWebAuthnCredential(user.email, removeId, removePassword);
    setRemoving(false);
    if (result.success) {
      setSuccess('Fingerprint removed.');
      setRemoveId(null);
      setRemovePassword('');
      loadStatus();
    } else {
      setError(result.error);
    }
  }

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  const hasMfa = status && (status.totpEnabled || status.webauthnEnabled);

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Security Settings</h1>
        <p>Manage your two-factor authentication methods.</p>

        {error && <div className="alert alert-error">{error}</div>}
        {success && (
          <div className="alert" style={{ background: 'rgba(46, 204, 113, 0.08)', border: '1px solid rgba(46, 204, 113, 0.2)', color: '#27ae60' }}>
            {success}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>Loading...</div>
        ) : status && (
          <div style={{ marginTop: '8px' }}>

            {/* --- Fingerprint / WebAuthn Section --- */}
            <div style={{ padding: '20px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: status.webauthnCredentials?.length ? '16px' : '0' }}>
                <div>
                  <strong>Fingerprint / Windows Hello</strong>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    {status.webauthnEnabled ? `${status.webauthnCredentials.length} device(s) registered` : 'Not configured'}
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: status.webauthnEnabled ? 'rgba(46, 204, 113, 0.12)' : 'rgba(136, 136, 136, 0.12)',
                  color: status.webauthnEnabled ? 'var(--color-success)' : 'var(--color-text-muted)',
                }}>
                  {status.webauthnEnabled ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* List existing credentials */}
              {status.webauthnCredentials?.map((cred) => (
                <div key={cred.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: 'var(--color-bg-white)', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)', marginBottom: '8px',
                }}>
                  <div>
                    <strong style={{ fontSize: 'var(--font-size-sm)' }}>{cred.name}</strong>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      Added {cred.createdAt ? new Date(cred.createdAt).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                  {removeId === cred.id ? (
                    <form onSubmit={handleRemoveWebAuthn} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="password" className="form-input" placeholder="Password"
                        value={removePassword} onChange={e => setRemovePassword(e.target.value)}
                        style={{ width: '140px', padding: '6px 10px', fontSize: 'var(--font-size-xs)' }}
                      />
                      <button type="submit" className="btn btn-sm" disabled={removing}
                        style={{ background: 'var(--color-danger)', color: '#fff', padding: '6px 12px', fontSize: 'var(--font-size-xs)' }}>
                        {removing ? '...' : 'Remove'}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => { setRemoveId(null); setRemovePassword(''); }}
                        style={{ padding: '6px 12px', fontSize: 'var(--font-size-xs)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={() => { setRemoveId(cred.id); setError(''); setSuccess(''); }}
                      style={{ padding: '6px 12px', fontSize: 'var(--font-size-xs)', background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              <button className="btn btn-outline btn-sm" style={{ marginTop: '8px' }} onClick={handleAddWebAuthn} disabled={addingWebauthn}>
                {addingWebauthn ? 'Waiting for device...' : 'Add Fingerprint'}
              </button>
            </div>

            {/* --- TOTP Section --- */}
            <div style={{ padding: '20px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Authenticator App (TOTP)</strong>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    {status.totpEnabled ? 'Enabled' : 'Not configured'}
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: status.totpEnabled ? 'rgba(46, 204, 113, 0.12)' : 'rgba(136, 136, 136, 0.12)',
                  color: status.totpEnabled ? 'var(--color-success)' : 'var(--color-text-muted)',
                }}>
                  {status.totpEnabled ? 'Active' : 'Inactive'}
                </span>
              </div>

              {!status.totpEnabled && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: '12px' }} onClick={() => navigate('/mfa/setup')}>
                  Set Up Authenticator
                </button>
              )}

              {status.totpEnabled && !showDisable && (
                <button className="btn btn-sm" style={{ marginTop: '12px', background: 'var(--color-danger)', color: '#fff' }}
                  onClick={() => { setShowDisable(true); setError(''); setSuccess(''); }}>
                  Disable Authenticator
                </button>
              )}

              {showDisable && (
                <form onSubmit={handleDisable} style={{ marginTop: '12px', padding: '16px', background: 'rgba(231, 76, 60, 0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(231, 76, 60, 0.2)' }}>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '0 0 12px', textAlign: 'left' }}>Enter your password to disable.</p>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <input className="form-input" type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} placeholder="Password" />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" className="btn btn-sm" style={{ background: 'var(--color-danger)', color: '#fff', flex: 1 }} disabled={disabling}>
                      {disabling ? 'Disabling...' : 'Confirm'}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => { setShowDisable(false); setDisablePassword(''); }}>Cancel</button>
                  </div>
                </form>
              )}
            </div>

            {/* --- Recovery Codes --- */}
            {hasMfa && (
              <div style={{ padding: '20px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: '16px' }}>
                <strong>Recovery Codes</strong>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  {status.recoveryCodesRemaining} codes remaining
                </div>
                <button className="btn btn-outline btn-sm" style={{ marginTop: '12px' }}
                  onClick={() => { setShowRegen(true); setError(''); setSuccess(''); setNewCodes(null); }}>
                  Regenerate Codes
                </button>
              </div>
            )}

            {/* New codes display */}
            {newCodes && (
              <div style={{ padding: '20px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: '16px' }}>
                <strong>New Recovery Codes</strong>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '4px 0 12px', textAlign: 'left' }}>
                  Save these codes now. Previous codes are no longer valid.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontFamily: 'monospace' }}>
                  {newCodes.map((code, i) => (
                    <div key={i} style={{ padding: '8px', background: 'var(--color-bg-white)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                      {code}
                    </div>
                  ))}
                </div>
                <button className="btn btn-outline btn-sm" style={{ marginTop: '12px', width: '100%' }}
                  onClick={() => navigator.clipboard.writeText(newCodes.join('\n'))}>
                  Copy All
                </button>
              </div>
            )}

            {/* Regenerate form */}
            {showRegen && (
              <form onSubmit={handleRegenerate} style={{ padding: '20px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: '16px' }}>
                <strong>Regenerate Recovery Codes</strong>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '8px 0 12px', textAlign: 'left' }}>This will invalidate all existing codes.</p>
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <input className="form-input" type="password" value={regenPassword} onChange={e => setRegenPassword(e.target.value)} placeholder="Password" />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={regenerating}>
                    {regenerating ? 'Generating...' : 'Regenerate'}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => { setShowRegen(false); setRegenPassword(''); }}>Cancel</button>
                </div>
              </form>
            )}

            {/* Setup prompt if no MFA at all */}
            {!hasMfa && (
              <button className="btn btn-primary btn-lg" onClick={() => navigate('/mfa/setup')}>
                Set Up Two-Factor Authentication
              </button>
            )}
          </div>
        )}

        <div className="auth-link">
          <button type="button" onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
