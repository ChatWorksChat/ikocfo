import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { verifyEmail, resendCode } from '../lib/auth.js';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('pending'); // pending | verifying | success | error
  const [error, setError] = useState('');
  const [resendMsg, setResendMsg] = useState('');

  async function handleVerify(e) {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter the verification code.');
      return;
    }
    setStatus('verifying');
    setError('');
    const result = await verifyEmail(email, code.trim());
    if (result.success) {
      setStatus('success');
    } else {
      setStatus('error');
      setError(result.error);
    }
  }

  async function handleResend() {
    setResendMsg('');
    setError('');
    const result = await resendCode(email);
    if (result.success) {
      setResendMsg('A new verification code has been sent to your email.');
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="page-container-narrow" style={{ textAlign: 'center' }}>
      <div className="glass-card" style={{ padding: '48px' }}>
        {status === 'success' ? (
          <>
            <h2>Email Verified</h2>
            <p style={{ color: 'var(--color-text-light)', marginTop: '12px', marginBottom: '24px' }}>
              Your email has been verified. You can now log in.
            </p>
            <Link to="/login" className="btn btn-primary">Go to Login</Link>
          </>
        ) : (
          <>
            <h2>Verify Your Email</h2>
            <p style={{ color: 'var(--color-text-light)', marginTop: '12px', marginBottom: '24px' }}>
              We&apos;ve sent a 6-digit verification code to <strong>{email}</strong>.
              Enter it below to verify your account.
            </p>

            {error && <div className="alert alert-error">{error}</div>}
            {resendMsg && <div className="alert alert-success">{resendMsg}</div>}

            <form onSubmit={handleVerify}>
              <div className="form-group">
                <input
                  className="form-input"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.3em' }}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={status === 'verifying'}
                style={{ width: '100%' }}
              >
                {status === 'verifying' ? 'Verifying...' : 'Verify Email'}
              </button>
            </form>

            <div style={{ marginTop: '24px' }}>
              <button
                onClick={handleResend}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                Didn&apos;t receive the code? Resend
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
