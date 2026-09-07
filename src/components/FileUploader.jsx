import { useState, useRef } from 'react';

export default function FileUploader({ onFileSelected, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function handleDragOver(e) {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
  }

  function handleClick() {
    if (!disabled) inputRef.current?.click();
  }

  function handleChange(e) {
    const file = e.target.files[0];
    if (file) onFileSelected(file);
  }

  return (
    <div
      className={`file-uploader${dragOver ? ' drag-over' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
    >
      <div className="file-uploader-icon">&#128196;</div>
      <h3>Upload Bank Statement</h3>
      <p>Drag and drop your CSV or XLSX file here, or click to browse</p>
      <p style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        Your data stays in your browser &mdash; nothing is uploaded to any server.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.tsv,.txt"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
