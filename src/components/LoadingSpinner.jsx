export default function LoadingSpinner({ text = 'Loading...' }) {
  return (
    <div className="spinner-overlay">
      <div className="spinner"></div>
      {text && <span className="spinner-text">{text}</span>}
    </div>
  );
}
