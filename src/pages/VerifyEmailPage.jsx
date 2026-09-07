import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { verifyEmail } from '../lib/auth.js';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('verifying');

  useEffect(() => {
    const token = searchParams.get('token');
    const result = verifyEmail(token);
    setStatus(result.success ? 'success' : 'error');
  }, [searchParams]);

  return (
    <div className="page-container-narrow" style={{ textAlign: 'center' }}>
      <div className="glass-card" style={{ padding: '48px' }}>
        {status === 'verifying' && (
          <>
            <h2>Verifying your email...</h2>
            <p style={{ color: 'var(--color-text-light)', marginTop: '12px' }}>Please wait.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h2>Email Verified</h2>
            <p style={{ color: 'var(--color-text-light)', marginTop: '12px', marginBottom: '24px' }}>
              Your email has been verified. You can now log in.
            </p>
            <Link to="/login" className="btn btn-primary">Go to Login</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <h2>Verification Failed</h2>
            <p style={{ color: 'var(--color-text-light)', marginTop: '12px', marginBottom: '24px' }}>
              The verification link is invalid or has expired.
            </p>
            <Link to="/register" className="btn btn-primary">Register Again</Link>
          </>
        )}
      </div>
    </div>
  );
}
