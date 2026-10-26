import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentUser } from '../lib/auth.js';
import { canAnalyze, getMaxRows, hasXirrAccess, addHistoryEntry } from '../lib/storage.js';
import { parseFile } from '../lib/parser.js';
import { applyMapping } from '../lib/statementMapper.js';
import { runCalculation } from '../lib/calculator.js';
import FileUploader from '../components/FileUploader.jsx';
import StatementPreview from '../components/StatementPreview.jsx';
import ValidationScreen from '../components/ValidationScreen.jsx';
import CalculationResults, { STATUS_CONFIG } from '../components/CalculationResults.jsx';
import RegulatoryFlags from '../components/RegulatoryFlags.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

const STEPS = ['Upload', 'Preview', 'Confirm', 'Results'];
const MAX_SESSION_STATEMENTS = 5;

export default function CalculatorPage() {
  const user = getCurrentUser();
  const [step, setStep] = useState(0);
  const [parsedData, setParsedData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // PDF password state
  const [pdfPasswordRequired, setPdfPasswordRequired] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  // Multi-statement state
  const [completedResults, setCompletedResults] = useState([]);

  if (!user) return null;

  const usage = canAnalyze(user);
  const maxRows = getMaxRows(user);

  async function handleFileSelected(file, password) {
    setError('');
    const isPDF = file.name.toLowerCase().endsWith('.pdf');
    setLoading(isPDF ? 'pdf' : true);
    try {
      const data = await parseFile(file, password);
      // Clear password state on success
      setPdfPasswordRequired(false);
      setPdfPassword('');
      setPendingFile(null);
      if (data.rowCount > maxRows) {
        setError(
          `This file has ${data.rowCount.toLocaleString()} rows, but your plan allows up to ${maxRows.toLocaleString()}. Please upgrade or use a smaller file.`
        );
        setLoading(false);
        return;
      }
      setParsedData(data);
      setStep(1);
    } catch (err) {
      if (err.isPasswordRequired) {
        setPendingFile(file);
        setPdfPasswordRequired(true);
        setPdfPassword('');
        setError(err.message);
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  }

  function handlePasswordSubmit(e) {
    e.preventDefault();
    if (!pendingFile || !pdfPassword) return;
    handleFileSelected(pendingFile, pdfPassword);
  }

  function handlePasswordCancel() {
    setPdfPasswordRequired(false);
    setPdfPassword('');
    setPendingFile(null);
    setError('');
  }

  function handlePreviewConfirm(mappingSettings) {
    setSettings(mappingSettings);
    setStep(2);
  }

  function handleValidationConfirm() {
    setLoading(true);
    setError('');

    // Use setTimeout to allow the spinner to render
    setTimeout(() => {
      try {
        // Use the resolved rows from the preview step (excludes preamble)
        const dataRows = settings.resolvedRows || parsedData.rows || [];
        const transactions = applyMapping(dataRows, settings.columnMapping);
        const calcResults = runCalculation({
          transactions,
          currency: settings.currency,
          nominalRate: settings.nominalRate,
          overdraftLimit: settings.overdraftLimit,
          includeXIRR: hasXirrAccess(user),
          fileName: parsedData.fileName,
          openingBalance: settings.openingBalance,
          periodStart: settings.periodStart,
          periodEnd: settings.periodEnd,
          bankInterestCharged: settings.bankInterestCharged,
        });

        if (calcResults.error) {
          setError(calcResults.error);
          setLoading(false);
          return;
        }

        setResults(calcResults);

        // Save to history
        const historyEntry = {
          fileName: parsedData.fileName,
          currency: settings.currency,
          transactionCount: dataRows.length,
        };

        if (calcResults.dailyInterest) {
          historyEntry.expectedInterest = calcResults.dailyInterest.expectedInterest;
          historyEntry.bankInterestCharged = calcResults.dailyInterest.bankInterestCharged;
          historyEntry.variancePercent = calcResults.dailyInterest.variancePercent;
          historyEntry.status = calcResults.dailyInterest.status;
        }

        addHistoryEntry(user.email, historyEntry);

        setStep(3);
      } catch (err) {
        setError(err.message || 'An error occurred during calculation.');
      }
      setLoading(false);
    }, 100);
  }

  function handleAnalyzeAnother() {
    // Save current results and reset for next statement
    if (results && parsedData) {
      setCompletedResults(prev => [...prev, {
        id: Date.now(),
        fileName: parsedData.fileName,
        results,
        settings,
        showWorkings: !!user.showWorkings,
      }]);
    }
    setStep(0);
    setParsedData(null);
    setSettings(null);
    setResults(null);
    setError('');
    setPdfPasswordRequired(false);
    setPdfPassword('');
    setPendingFile(null);
  }

  function handleFullReset() {
    setStep(0);
    setParsedData(null);
    setSettings(null);
    setResults(null);
    setError('');
    setCompletedResults([]);
    setPdfPasswordRequired(false);
    setPdfPassword('');
    setPendingFile(null);
  }

  return (
    <div className="page-container">
      <h1 className="page-title">Overdraft Audit Calculator</h1>
      <p className="page-subtitle">
        Upload your bank statement to verify your overdraft interest charges.
      </p>

      {/* Step indicator */}
      <div className="step-indicator">
        {STEPS.map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`step${i === step ? ' active' : ''}${i < step ? ' completed' : ''}`}>
              <div className="step-number">
                {i < step ? '\u2713' : i + 1}
              </div>
              <span>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step-connector${i < step ? ' completed' : ''}`} />
            )}
          </div>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && (
        <LoadingSpinner
          text={loading === 'pdf' ? 'Converting PDF to spreadsheet...' : 'Processing your statement...'}
        />
      )}

      {!loading && (
        <>
          {/* Step 0: Upload */}
          {step === 0 && (
            <>
              {completedResults.length > 0 && (
                <div style={{ textAlign: 'center', marginBottom: '16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)' }}>
                  Statement {completedResults.length + 1} of {MAX_SESSION_STATEMENTS}
                </div>
              )}

              {pdfPasswordRequired ? (
                <div className="glass-card" style={{ padding: '32px', maxWidth: '420px', margin: '0 auto' }}>
                  <h3 style={{ marginBottom: '8px' }}>Password-Protected PDF</h3>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-light)', marginBottom: '16px' }}>
                    This PDF requires a password to open.
                  </p>
                  <form onSubmit={handlePasswordSubmit}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="pdfPassword">PDF Password</label>
                      <input
                        className="form-input"
                        id="pdfPassword"
                        type="password"
                        value={pdfPassword}
                        onChange={(e) => setPdfPassword(e.target.value)}
                        placeholder="Enter PDF password"
                        autoComplete="off"
                        autoFocus
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button type="submit" className="btn btn-primary" disabled={!pdfPassword}>
                        Unlock
                      </button>
                      <button type="button" className="btn btn-outline" onClick={handlePasswordCancel}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              ) : !usage.allowed ? (
                <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
                  <h3>Free Analysis Used</h3>
                  <p style={{ color: 'var(--color-text-light)', margin: '12px 0 24px' }}>
                    You&apos;ve used your free analysis. Upgrade to continue auditing statements.
                  </p>
                  <Link to="/pricing" className="btn btn-primary">View Plans</Link>
                </div>
              ) : (
                <FileUploader onFileSelected={handleFileSelected} disabled={!usage.allowed} />
              )}
            </>
          )}

          {/* Step 1: Preview & Map */}
          {step === 1 && parsedData && (
            <div className="glass-card" style={{ padding: '28px' }}>
              <StatementPreview parsedData={parsedData} onConfirm={handlePreviewConfirm} />
            </div>
          )}

          {/* Step 2: Confirm */}
          {step === 2 && parsedData && settings && (
            <div className="glass-card" style={{ padding: '28px' }}>
              <ValidationScreen
                parsedData={parsedData}
                settings={settings}
                onConfirm={handleValidationConfirm}
                onBack={() => setStep(1)}
              />
            </div>
          )}

          {/* Step 3: Results */}
          {step === 3 && results && (
            <div>
              <CalculationResults results={results} showWorkings={!!user.showWorkings} />
              <RegulatoryFlags flags={results.regulatoryFlags} />
              <div style={{ textAlign: 'center', marginTop: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                {completedResults.length + 1 < MAX_SESSION_STATEMENTS && usage.allowed ? (
                  <button className="btn btn-primary" onClick={handleAnalyzeAnother}>
                    Analyze Another Statement ({completedResults.length + 1}/{MAX_SESSION_STATEMENTS})
                  </button>
                ) : completedResults.length + 1 >= MAX_SESSION_STATEMENTS ? (
                  <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--color-text-light)', marginBottom: '12px', fontSize: 'var(--font-size-sm)' }}>
                      You&apos;ve reached the maximum of {MAX_SESSION_STATEMENTS} statements per session.
                      Upgrade your plan for higher limits.
                    </p>
                    <Link to="/pricing" className="btn btn-primary">Upgrade Plan</Link>
                  </div>
                ) : null}
                <button className="btn btn-outline" onClick={handleFullReset}>
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* Previous completed analyses */}
          {completedResults.length > 0 && (
            <details style={{ marginTop: '32px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '12px', fontSize: 'var(--font-size-sm)' }}>
                Previous Analyses ({completedResults.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {completedResults.map((entry, idx) => {
                  const di = entry.results?.dailyInterest;
                  const statusCfg = di ? (STATUS_CONFIG[di.status] || STATUS_CONFIG.review) : null;
                  return (
                    <div key={entry.id} className="glass-card" style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                          <strong style={{ fontSize: 'var(--font-size-sm)' }}>
                            Statement {idx + 1}: {entry.fileName}
                          </strong>
                        </div>
                        {statusCfg && (
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 12px',
                            borderRadius: '12px',
                            background: statusCfg.color,
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 'var(--font-size-xs)',
                          }}>
                            {statusCfg.label}
                          </span>
                        )}
                      </div>
                      {di && (
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-light)', marginTop: '6px' }}>
                          Variance: {di.variance >= 0 ? '+' : ''}{di.variance?.toFixed(2)} ({di.variancePercent >= 0 ? '+' : ''}{di.variancePercent?.toFixed(2)}%)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
