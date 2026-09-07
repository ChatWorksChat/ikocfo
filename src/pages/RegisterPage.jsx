import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import RegistrationForm from '../components/RegistrationForm.jsx';
import { register } from '../lib/auth.js';

export default function RegisterPage() {
  const [error, setError] = useState('');
  const navigate = useNavigate();

  function handleSubmit(formData) {
    const result = register(formData);
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="page-container-narrow">
      <div className="auth-card glass-card">
        <h1>Create Account</h1>
        <p>Start your free overdraft audit today</p>
        <RegistrationForm onSubmit={handleSubmit} error={error} />
        <div className="auth-link">
          Already have an account? <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  );
}
