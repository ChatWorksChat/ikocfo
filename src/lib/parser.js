// CSV/XLSX parsing orchestrator — entirely client-side

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      parseCSV(file).then(resolve).catch(reject);
    } else if (ext === 'xlsx' || ext === 'xls') {
      parseXLSX(file).then(resolve).catch(reject);
    } else {
      reject(new Error(`Unsupported file format: .${ext}. Please upload a CSV or XLSX file.`));
    }
  });
}

function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete(results) {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error('Failed to parse CSV: ' + results.errors[0].message));
          return;
        }
        resolve({
          headers: results.meta.fields || [],
          rows: results.data,
          rowCount: results.data.length,
          fileName: file.name,
        });
      },
      error(err) {
        reject(new Error('Failed to parse CSV: ' + err.message));
      },
    });
  });
}

function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (json.length === 0) {
          reject(new Error('The spreadsheet appears to be empty.'));
          return;
        }

        const headers = Object.keys(json[0]);
        resolve({
          headers,
          rows: json,
          rowCount: json.length,
          fileName: file.name,
        });
      } catch (err) {
        reject(new Error('Failed to parse XLSX: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsArrayBuffer(file);
  });
}
