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
import CalculationResults from '../components/CalculationResults.jsx';
import RegulatoryFlags from '../components/RegulatoryFlags.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

const STEPS = ['Upload', 'Preview', 'Confirm', 'Results'];

export default function CalculatorPage() {
  const user = getCurrentUser();
  const [step, setStep] = useState(0);
  const [parsedData, setParsedData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const usage = canAnalyze(user);
  const maxRows = getMaxRows(user);

  async function handleFileSelected(file) {
    setError('');
    setLoading(true);
    try {
      const data = await parseFile(file);
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
      setError(err.message);
    }
    setLoading(false);
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
        const transactions = applyMapping(parsedData.rows, settings.columnMapping);
        const calcResults = runCalculation({
          transactions,
          currency: settings.currency,
          nominalRate: settings.nominalRate,
          overdraftLimit: settings.overdraftLimit,
          includeXIRR: hasXirrAccess(user),
          fileName: parsedData.fileName,
        });

        if (calcResults.error) {
          setError(calcResults.error);
          setLoading(false);
          return;
        }

        setResults(calcResults);

        // Save to history
        addHistoryEntry(user.email, {
          fileName: parsedData.fileName,
          effectiveAPR: calcResults.effectiveAPR,
          currency: settings.currency,
          transactionCount: parsedData.rowCount,
        });

        setStep(3);
      } catch (err) {
        setError(err.message || 'An error occurred during calculation.');
      }
      setLoading(false);
    }, 100);
  }

  function handleReset() {
    setStep(0);
    setParsedData(null);
    setSettings(null);
    setResults(null);
    setError('');
  }

  return (
    <div className="page-container">
      <h1 className="page-title">Overdraft Audit Calculator</h1>
      <p className="page-subtitle">
        Upload your bank statement to discover your true overdraft cost.
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

      {loading && <LoadingSpinner text="Processing your statement..." />}

      {!loading && (
        <>
          {/* Step 0: Upload */}
          {step === 0 && (
            <>
              {!usage.allowed ? (
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
              <CalculationResults results={results} />
              <RegulatoryFlags flags={results.regulatoryFlags} />
              <div style={{ textAlign: 'center', marginTop: '24px' }}>
                <button className="btn btn-outline" onClick={handleReset}>
                  Analyze Another Statement
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
