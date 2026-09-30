// CSV/XLSX/PDF parsing orchestrator — entirely client-side

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

// Patterns that indicate a row is a column header (not preamble)
const HEADER_PATTERNS = [
  /^date$/i, /posting\s*date/i, /trans(action)?\s*date/i, /^txn\s*date$/i,
  /^value$/i, /value\s*date/i,
  /^desc/i, /narrative/i, /particulars/i, /details/i, /^narration$/i,
  /^debit/i, /^dr$/i, /withdrawal/i,
  /^credit$/i, /^cr$/i, /deposit/i,
  /balance/i, /running\s*bal/i, /^bal$/i,
  /interest/i, /^fee/i, /^charge/i, /reference/i, /^amount$/i,
];

/**
 * Score a row to determine how likely it is to be a column header row.
 * Returns the count of cells matching known header patterns.
 */
function scoreHeaderRow(cells) {
  let matches = 0;
  for (const cell of cells) {
    const text = String(cell || '').trim();
    if (!text) continue;
    for (const pattern of HEADER_PATTERNS) {
      if (pattern.test(text)) {
        matches++;
        break;
      }
    }
  }
  return matches;
}

/**
 * Auto-detect the header row index from raw rows.
 * Finds the row with the highest header-pattern match score (minimum 2 matches).
 */
export function detectHeaderRow(rawRows) {
  let bestIdx = 0;
  let bestScore = 0;

  // Only search the first 20 rows for header candidates
  const searchLimit = Math.min(rawRows.length, 20);

  for (let i = 0; i < searchLimit; i++) {
    const score = scoreHeaderRow(rawRows[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

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
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete(results) {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error('Failed to parse CSV: ' + results.errors[0].message));
          return;
        }

        const rawRows = results.data;
        if (rawRows.length < 2) {
          reject(new Error('The file has too few rows to analyze.'));
          return;
        }

        const headerRowIndex = detectHeaderRow(rawRows);
        const maxCols = Math.max(...rawRows.map(r => r.length));

        // Normalize all rows to the same column count
        const normalized = rawRows.map(r => {
          const row = [...r];
          while (row.length < maxCols) row.push('');
          return row;
        });

        resolve({
          rawRows: normalized,
          headerRowIndex,
          rowCount: normalized.length - headerRowIndex - 1,
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

        // Parse as raw arrays (header: 1 means "use row indices")
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rawRows.length < 2) {
          reject(new Error('The spreadsheet appears to be empty or has too few rows.'));
          return;
        }

        // Normalize column count
        const maxCols = Math.max(...rawRows.map(r => r.length));
        const normalized = rawRows.map(r => {
          const row = [...r];
          while (row.length < maxCols) row.push('');
          return row.map(cell => {
            // Convert Date objects to readable strings
            if (cell instanceof Date) {
              return cell.toLocaleDateString('en-GB');
            }
            return cell;
          });
        });

        // Filter out fully empty rows
        const nonEmpty = normalized.filter(row =>
          row.some(cell => String(cell || '').trim() !== '')
        );

        const headerRowIndex = detectHeaderRow(nonEmpty);

        resolve({
          rawRows: nonEmpty,
          headerRowIndex,
          rowCount: nonEmpty.length - headerRowIndex - 1,
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

  // --- Column detection: header-anchored (preferred) or global fallback ---
  const COL_THRESHOLD = 15;

  // Find the header row cluster by scoring each cluster against known patterns
  let headerClusterIdx = -1;
  let bestHeaderScore = 0;
  const clusterSearchLimit = Math.min(rowClusters.length, 30);

  for (let i = 0; i < clusterSearchLimit; i++) {
    const texts = rowClusters[i].map((item) => item.text);
    const score = scoreHeaderRow(texts);
    if (score > bestHeaderScore) {
      bestHeaderScore = score;
      headerClusterIdx = i;
    }
  }

  // Assign a text item to the nearest column anchor by absolute distance
  function getNearestCol(x, anchors) {
    let bestIdx = 0;
    let bestDist = Math.abs(x - anchors[0]);
    for (let i = 1; i < anchors.length; i++) {
      const dist = Math.abs(x - anchors[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  let tableRows;

  if (headerClusterIdx >= 0 && bestHeaderScore >= 2) {
    // Header-anchored column detection — use header x-positions as anchors
    const headerCluster = rowClusters[headerClusterIdx];
    const HEADER_MERGE_THRESHOLD = 30;

    // Extract x-positions from header items and merge nearby ones
    // (handles multi-word headers like "VALUE DATE" that are separate text items)
    const headerXs = headerCluster.map((item) => item.x).sort((a, b) => a - b);
    const colAnchors = [headerXs[0]];
    for (let i = 1; i < headerXs.length; i++) {
      if (headerXs[i] - colAnchors[colAnchors.length - 1] > HEADER_MERGE_THRESHOLD) {
        colAnchors.push(headerXs[i]);
      }
    }

    // Convert row clusters into arrays of cell values using nearest-anchor assignment
    tableRows = rowClusters.map((cluster) => {
      const cells = new Array(colAnchors.length).fill('');
      for (const item of cluster) {
        const colIdx = getNearestCol(item.x, colAnchors);
        cells[colIdx] = cells[colIdx] ? cells[colIdx] + ' ' + item.text : item.text;
      }
      return cells;
    });
  } else {
    // Fallback: global column boundary detection for headerless PDFs
    const allX = allItems.map((item) => item.x);
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

    tableRows = rowClusters.map((cluster) => {
      const cells = new Array(colBoundaries.length).fill('');
      for (const item of cluster) {
        const colIdx = getColIndex(item.x);
        cells[colIdx] = cells[colIdx] ? cells[colIdx] + ' ' + item.text : item.text;
      }
      return cells;
    });
  }

  // Filter out rows that are mostly empty (less than 2 non-empty cells)
  const substantialRows = tableRows.filter(
    (row) => row.filter((cell) => cell.trim() !== '').length >= 2
  );

  if (substantialRows.length < 2) {
    throw new Error(
      'Could not detect tabular data in this PDF. Please convert to CSV or XLSX and try again.'
    );
  }

  const headerRowIndex = detectHeaderRow(substantialRows);

  return {
    rawRows: substantialRows,
    headerRowIndex,
    rowCount: substantialRows.length - headerRowIndex - 1,
    fileName: file.name,
  };
}
