import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { getCurrentUser, logout } from '../lib/auth.js';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const user = getCurrentUser();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    setMenuOpen(false);
    navigate('/');
  }

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo">
          <div className="header-logo-icon">IKO</div>
          CFO
        </Link>

        <button
          className="header-menu-toggle"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <nav className={`header-nav${menuOpen ? ' nav-open' : ''}`}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => isActive ? 'nav-active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            Home
          </NavLink>
          <NavLink
            to="/pricing"
            className={({ isActive }) => isActive ? 'nav-active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            Pricing
          </NavLink>

          {user ? (
            <>
              <NavLink
                to="/dashboard"
                className={({ isActive }) => isActive ? 'nav-active' : ''}
                onClick={() => setMenuOpen(false)}
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/calculator"
                className={({ isActive }) => isActive ? 'nav-active' : ''}
                onClick={() => setMenuOpen(false)}
              >
                Calculator
              </NavLink>
              <div className="header-auth">
                <span className="header-user">{user.firstName || user.email}</span>
                <button className="btn btn-sm btn-outline" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            </>
          ) : (
            <div className="header-auth">
              <Link
                to="/login"
                className="btn btn-sm btn-outline"
                onClick={() => setMenuOpen(false)}
              >
                Login
              </Link>
              <Link
                to="/register"
                className="btn btn-sm btn-primary"
                onClick={() => setMenuOpen(false)}
              >
                Sign Up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
