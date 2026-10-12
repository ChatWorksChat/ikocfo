import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../lib/auth.js';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get('email') || '';
  const channel = searchParams.get('channel') || 'email';

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'email';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!code.trim()) {
      setError('Please enter the reset code.');
      return;
    }
    if (!newPassword) {
      setError('Please enter a new password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const result = await resetPassword(emailParam, code.trim(), newPassword);
    setLoading(false);

    if (result.success) {
      navigate('/login', {
        state: { message: 'Password reset successfully. Please log in with your new password.' },
      });
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Reset Password</h1>
        <p>
          A 6-digit code has been sent via <strong>{channelLabel}</strong> to the account
          associated with <strong>{emailParam}</strong>.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="code">Reset Code</label>
            <input
              className="form-input"
              id="code"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Enter 6-digit code"
              maxLength={6}
              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.3em' }}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="newPassword">New Password</label>
            <input
              className="form-input"
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirmPassword">Confirm Password</label>
            <input
              className="form-input"
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your new password"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <div className="auth-link">
          <Link to="/forgot-password">Resend code</Link> | <Link to="/login">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}
