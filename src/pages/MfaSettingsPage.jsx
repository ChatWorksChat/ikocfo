import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, getMfaStatus, disableTotp, regenerateRecoveryCodes } from '../lib/auth.js';

export default function MfaSettingsPage() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Disable TOTP state
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Regenerate codes state
  const [showRegen, setShowRegen] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState(null);

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
    if (!disablePassword) {
      setError('Password is required.');
      return;
    }
    setDisabling(true);
    const result = await disableTotp(user.email, disablePassword);
    setDisabling(false);
    if (result.success) {
      setSuccess('Two-factor authentication has been disabled.');
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
    if (!regenPassword) {
      setError('Password is required.');
      return;
    }
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

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Security Settings</h1>
        <p>Manage your two-factor authentication settings.</p>

        {error && <div className="alert alert-error">{error}</div>}
        {success && (
          <div className="alert" style={{
            background: 'rgba(46, 204, 113, 0.08)',
            border: '1px solid rgba(46, 204, 113, 0.2)',
            color: '#27ae60',
          }}>{success}</div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
            Loading...
          </div>
        ) : status && (
          <div style={{ marginTop: '8px' }}>
            {/* TOTP Status */}
            <div style={{
              padding: '20px',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Authenticator App (TOTP)</strong>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    {status.totpEnabled ? 'Enabled' : 'Not configured'}
                  </div>
                </div>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 700,
                  background: status.totpEnabled ? 'rgba(46, 204, 113, 0.12)' : 'rgba(136, 136, 136, 0.12)',
                  color: status.totpEnabled ? 'var(--color-success)' : 'var(--color-text-muted)',
                }}>
                  {status.totpEnabled ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {status.totpEnabled && (
              <>
                {/* Recovery Codes */}
                <div style={{
                  padding: '20px',
                  background: 'var(--color-bg)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  marginBottom: '16px',
                }}>
                  <strong>Recovery Codes</strong>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    {status.recoveryCodesRemaining} codes remaining
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: '12px' }}
                    onClick={() => { setShowRegen(true); setError(''); setSuccess(''); }}
                  >
                    Regenerate Codes
                  </button>
                </div>

                {/* New codes display */}
                {newCodes && (
                  <div style={{
                    padding: '20px',
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    marginBottom: '16px',
                  }}>
                    <strong>New Recovery Codes</strong>
                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '4px 0 12px', textAlign: 'left' }}>
                      Save these codes now. Previous codes are no longer valid.
                    </p>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                      fontFamily: 'monospace',
                    }}>
                      {newCodes.map((code, i) => (
                        <div key={i} style={{
                          padding: '8px',
                          background: 'var(--color-bg-white)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          textAlign: 'center',
                        }}>
                          {code}
                        </div>
                      ))}
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ marginTop: '12px', width: '100%' }}
                      onClick={() => {
                        navigator.clipboard.writeText(newCodes.join('\n'));
                      }}
                    >
                      Copy All
                    </button>
                  </div>
                )}

                {/* Disable TOTP */}
                {!showDisable ? (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--color-danger)', color: '#fff', width: '100%' }}
                    onClick={() => { setShowDisable(true); setError(''); setSuccess(''); setNewCodes(null); }}
                  >
                    Disable Two-Factor Authentication
                  </button>
                ) : (
                  <form onSubmit={handleDisable} style={{
                    padding: '20px',
                    background: 'rgba(231, 76, 60, 0.04)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(231, 76, 60, 0.2)',
                  }}>
                    <strong style={{ color: 'var(--color-danger)' }}>Confirm Disable</strong>
                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '8px 0 16px', textAlign: 'left' }}>
                      Enter your password to disable two-factor authentication.
                    </p>
                    <div className="form-group">
                      <input
                        className="form-input"
                        type="password"
                        value={disablePassword}
                        onChange={e => setDisablePassword(e.target.value)}
                        placeholder="Enter your password"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button type="submit" className="btn btn-sm" style={{ background: 'var(--color-danger)', color: '#fff', flex: 1 }} disabled={disabling}>
                        {disabling ? 'Disabling...' : 'Confirm Disable'}
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Regenerate codes form */}
                {showRegen && (
                  <form onSubmit={handleRegenerate} style={{
                    marginTop: '16px',
                    padding: '20px',
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}>
                    <strong>Regenerate Recovery Codes</strong>
                    <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '8px 0 16px', textAlign: 'left' }}>
                      This will invalidate all existing recovery codes.
                    </p>
                    <div className="form-group">
                      <input
                        className="form-input"
                        type="password"
                        value={regenPassword}
                        onChange={e => setRegenPassword(e.target.value)}
                        placeholder="Enter your password"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={regenerating}>
                        {regenerating ? 'Generating...' : 'Regenerate'}
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => { setShowRegen(false); setRegenPassword(''); }}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            {!status.totpEnabled && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => navigate('/mfa/setup')}
              >
                Set Up Two-Factor Authentication
              </button>
            )}
          </div>
        )}

        <div className="auth-link">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
