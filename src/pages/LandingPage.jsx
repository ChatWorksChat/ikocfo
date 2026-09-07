import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <h1>
            Know Your <span>True Overdraft Cost</span>
          </h1>
          <p>
            Upload your bank statement and discover the effective interest rate you&apos;re
            actually paying. Separate hidden fees from stated rates in seconds.
          </p>
          <div className="hero-actions">
            <Link to="/register" className="btn btn-primary btn-lg">
              Audit Your Statement Free
            </Link>
            <Link to="/pricing" className="btn btn-outline btn-lg">
              View Pricing
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works">
        <div className="container">
          <h2 className="section-title">How It Works</h2>
          <div className="steps-grid">
            <div className="step-card glass-card">
              <div className="step-card-number">1</div>
              <h3>Upload Statement</h3>
              <p>
                Upload your bank statement as CSV or XLSX. Your data stays in your browser
                &mdash; nothing is sent to any server.
              </p>
            </div>
            <div className="step-card glass-card">
              <div className="step-card-number">2</div>
              <h3>Automatic Analysis</h3>
              <p>
                Our engine detects columns, separates interest from fees, and calculates your
                effective annual rate using proven financial methods.
              </p>
            </div>
            <div className="step-card glass-card">
              <div className="step-card-number">3</div>
              <h3>See Your Results</h3>
              <p>
                Get a clear breakdown of your true borrowing cost, comparison to stated rates,
                and regulatory compliance flags.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="container">
          <h2 className="section-title">What You Get</h2>
          <div className="features-grid">
            <div className="feature-card glass-card">
              <div className="feature-icon">&#128200;</div>
              <h3>Effective APR Calculation</h3>
              <p>See the real annual rate after accounting for all fees, charges, and compounding effects.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">&#128176;</div>
              <h3>Fee Separation</h3>
              <p>Automatically identify and separate interest charges, service fees, and commissions.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">&#9888;&#65039;</div>
              <h3>Regulatory Flags</h3>
              <p>Get alerts for in duplum violations, rate changes, and overdraft limit breaches.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">&#128274;</div>
              <h3>100% Private</h3>
              <p>All processing happens in your browser. Your bank data never leaves your device.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Banner */}
      <section className="trust-banner">
        <div className="container">
          <h2>Built by IKO CFO</h2>
          <p>
            With over 20 years of financial advisory experience, IKO CFO helps businesses and
            individuals make informed financial decisions. This tool brings institutional-grade
            analysis to everyone.
          </p>
          <a
            href="https://ikocfo.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Learn More About IKO CFO
          </a>
        </div>
      </section>
    </div>
  );
}
