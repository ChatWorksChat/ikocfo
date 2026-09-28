// CSV/XLSX/PDF parsing orchestrator — entirely client-side

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      parseCSV(file).then(resolve).catch(reject);
    } else if (ext === 'xlsx' || ext === 'xls') {
      parseXLSX(file).then(resolve).catch(reject);
    } else if (ext === 'pdf') {
      parsePDF(file).then(resolve).catch(reject);
    } else {
      reject(new Error(`Unsupported file format: .${ext}. Please upload a CSV, XLSX, or PDF file.`));
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

async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allItems = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    for (const item of textContent.items) {
      if (item.str.trim() === '') continue;
      allItems.push({
        text: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
        page: pageNum,
      });
    }
  }

  if (allItems.length === 0) {
    throw new Error(
      'Could not extract text from this PDF. It may be scanned or image-based. Please convert to CSV or XLSX first.'
    );
  }

  // Cluster items into rows by y-position (within a threshold)
  const ROW_THRESHOLD = 5;
  const rowClusters = [];

  // Sort by page then by y descending (PDF coords are bottom-up)
  const sorted = allItems.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > ROW_THRESHOLD) return b.y - a.y;
    return a.x - b.x;
  });

  let currentCluster = [sorted[0]];
  let currentY = sorted[0].y;
  let currentPage = sorted[0].page;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.page === currentPage && Math.abs(item.y - currentY) <= ROW_THRESHOLD) {
      currentCluster.push(item);
    } else {
      rowClusters.push(currentCluster.sort((a, b) => a.x - b.x));
      currentCluster = [item];
      currentY = item.y;
      currentPage = item.page;
    }
  }
  rowClusters.push(currentCluster.sort((a, b) => a.x - b.x));

  // Determine column boundaries from x-positions across all rows
  const allX = allItems.map((item) => item.x);
  const COL_THRESHOLD = 15;
  const uniqueX = [...new Set(allX)].sort((a, b) => a - b);

  const colBoundaries = [uniqueX[0]];
  for (let i = 1; i < uniqueX.length; i++) {
    if (uniqueX[i] - colBoundaries[colBoundaries.length - 1] > COL_THRESHOLD) {
      colBoundaries.push(uniqueX[i]);
    }
  }

  function getColIndex(x) {
    for (let i = colBoundaries.length - 1; i >= 0; i--) {
      if (x >= colBoundaries[i] - COL_THRESHOLD) return i;
    }
    return 0;
  }

  // Convert row clusters into arrays of cell values
  const tableRows = rowClusters.map((cluster) => {
    const cells = new Array(colBoundaries.length).fill('');
    for (const item of cluster) {
      const colIdx = getColIndex(item.x);
      cells[colIdx] = cells[colIdx] ? cells[colIdx] + ' ' + item.text : item.text;
    }
    return cells;
  });

  // Filter out rows that are mostly empty (less than 2 non-empty cells)
  const substantialRows = tableRows.filter(
    (row) => row.filter((cell) => cell.trim() !== '').length >= 2
  );

  if (substantialRows.length < 2) {
    throw new Error(
      'Could not detect tabular data in this PDF. Please convert to CSV or XLSX and try again.'
    );
  }

  // First substantial row is treated as headers
  const headerRow = substantialRows[0];
  const dataRows = substantialRows.slice(1);

  // Build headers — use column letters for empty headers
  const headers = headerRow.map((h, i) => h.trim() || `Column ${String.fromCharCode(65 + i)}`);

  // Convert data rows to objects keyed by headers
  const rows = dataRows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = (row[i] || '').trim();
    });
    return obj;
  });

  // Filter out rows where all values are empty
  const nonEmptyRows = rows.filter((row) =>
    Object.values(row).some((v) => v !== '')
  );

  if (nonEmptyRows.length === 0) {
    throw new Error(
      'The PDF contains headers but no data rows. Please check the file and try again.'
    );
  }

  return {
    headers,
    rows: nonEmptyRows,
    rowCount: nonEmptyRows.length,
    fileName: file.name,
  };
}
