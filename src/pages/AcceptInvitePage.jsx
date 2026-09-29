import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { acceptInvite } from '../lib/auth.js';

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Password strength indicators
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const isStrong = hasMinLength && hasUpper && hasLower && hasDigit;

  if (!token) {
    return (
      <div className="page-container-narrow">
        <div className="auth-card glass-card">
          <h1>Invalid Invitation</h1>
          <p>This invitation link is invalid or has expired. Please contact your administrator for a new invitation.</p>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/login')}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!isStrong) {
      setError('Please meet all password requirements.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const result = await acceptInvite(token, password);
    setLoading(false);

    if (result.success) {
      if (result.mfaSetupRequired) {
        navigate('/mfa/setup', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Welcome to IKO CFO</h1>
        <p>You've been invited! Create a password to set up your account.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              className="form-input"
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Create a strong password"
              autoFocus
            />
          </div>

          <div style={{
            padding: '12px 16px',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '16px',
            fontSize: 'var(--font-size-sm)',
          }}>
            <div style={{ marginBottom: '4px', fontWeight: 600 }}>Password requirements:</div>
            <div style={{ color: hasMinLength ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {hasMinLength ? '\u2713' : '\u2717'} At least 8 characters
            </div>
            <div style={{ color: hasUpper ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {hasUpper ? '\u2713' : '\u2717'} One uppercase letter
            </div>
            <div style={{ color: hasLower ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {hasLower ? '\u2713' : '\u2717'} One lowercase letter
            </div>
            <div style={{ color: hasDigit ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {hasDigit ? '\u2713' : '\u2717'} One number
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password">Confirm Password</label>
            <input
              className="form-input"
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading || !isStrong}>
            {loading ? 'Setting up...' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
