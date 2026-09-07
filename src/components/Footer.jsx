import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <img src="/logo.png" alt="IKO CFO" className="footer-logo-img" />
            <h3>IKO CFO</h3>
            <p>
              Expert financial advisory with 20+ years of experience.
              Helping businesses and individuals understand their true
              cost of borrowing.
            </p>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            <Link to="/calculator">Overdraft Audit</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/register">Get Started</Link>
          </div>

          <div className="footer-col">
            <h4>Company</h4>
            <a href="https://ikocfo.com" target="_blank" rel="noopener noreferrer">
              ikocfo.com
            </a>
            <a href="https://ikocfo.com" target="_blank" rel="noopener noreferrer">
              Book a Consultation
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <span>&copy; {new Date().getFullYear()} IKO CFO. All rights reserved.</span>
          <span>Built by IKO CFO &mdash; Financial Advisory You Can Trust</span>
        </div>
      </div>
    </footer>
  );
}
