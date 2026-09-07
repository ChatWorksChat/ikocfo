import { useState } from 'react';

export default function RegistrationForm({ onSubmit, error }) {
  const [accountType, setAccountType] = useState('individual');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '',
    companyAddress: '',
    position: '',
    authorized: false,
  });
  const [errors, setErrors] = useState({});

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setErrors(prev => ({ ...prev, [name]: '' }));
  }

  function validate() {
    const errs = {};

    if (accountType === 'individual') {
      if (!form.firstName.trim()) errs.firstName = 'First name is required.';
      if (!form.lastName.trim()) errs.lastName = 'Last name is required.';
    } else {
      if (!form.companyName.trim()) errs.companyName = 'Company name is required.';
      if (!form.companyAddress.trim()) errs.companyAddress = 'Company address is required.';
      if (!form.position.trim()) errs.position = 'Position is required.';
      if (!form.authorized) errs.authorized = 'Authorization is required.';
    }

    if (!form.email.trim()) {
      errs.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Please enter a valid email address.';
    }

    if (!form.password) {
      errs.password = 'Password is required.';
    } else if (form.password.length < 8) {
      errs.password = 'Password must be at least 8 characters.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({ ...form, accountType });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="toggle-group">
        <button
          type="button"
          className={`toggle-btn${accountType === 'individual' ? ' active' : ''}`}
          onClick={() => setAccountType('individual')}
        >
          Individual
        </button>
        <button
          type="button"
          className={`toggle-btn${accountType === 'corporate' ? ' active' : ''}`}
          onClick={() => setAccountType('corporate')}
        >
          Corporate
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {accountType === 'individual' ? (
        <>
          <div className="form-group">
            <label className="form-label" htmlFor="firstName">First Name</label>
            <input
              className="form-input"
              id="firstName"
              name="firstName"
              value={form.firstName}
              onChange={handleChange}
              placeholder="Enter your first name"
            />
            {errors.firstName && <div className="form-error">{errors.firstName}</div>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="lastName">Last Name</label>
            <input
              className="form-input"
              id="lastName"
              name="lastName"
              value={form.lastName}
              onChange={handleChange}
              placeholder="Enter your last name"
            />
            {errors.lastName && <div className="form-error">{errors.lastName}</div>}
          </div>
        </>
      ) : (
        <>
          <div className="form-group">
            <label className="form-label" htmlFor="companyName">Company Name</label>
            <input
              className="form-input"
              id="companyName"
              name="companyName"
              value={form.companyName}
              onChange={handleChange}
              placeholder="Enter company name"
            />
            {errors.companyName && <div className="form-error">{errors.companyName}</div>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="companyAddress">Company Address</label>
            <input
              className="form-input"
              id="companyAddress"
              name="companyAddress"
              value={form.companyAddress}
              onChange={handleChange}
              placeholder="Enter company address"
            />
            {errors.companyAddress && <div className="form-error">{errors.companyAddress}</div>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="position">Your Position</label>
            <input
              className="form-input"
              id="position"
              name="position"
              value={form.position}
              onChange={handleChange}
              placeholder="e.g. CFO, Finance Manager"
            />
            {errors.position && <div className="form-error">{errors.position}</div>}
          </div>
        </>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="email">
          {accountType === 'corporate' ? 'Company Email' : 'Email'}
        </label>
        <input
          className="form-input"
          id="email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          placeholder="Enter your email"
        />
        {errors.email && <div className="form-error">{errors.email}</div>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="password">Password</label>
        <input
          className="form-input"
          id="password"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          placeholder="Minimum 8 characters"
        />
        {errors.password && <div className="form-error">{errors.password}</div>}
      </div>

      {accountType === 'corporate' && (
        <div className="checkbox-group">
          <input
            type="checkbox"
            id="authorized"
            name="authorized"
            checked={form.authorized}
            onChange={handleChange}
          />
          <label htmlFor="authorized">
            I am authorized to act on behalf of this company for financial analysis purposes.
          </label>
          {errors.authorized && <div className="form-error">{errors.authorized}</div>}
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-lg">
        Create Account
      </button>
    </form>
  );
}
