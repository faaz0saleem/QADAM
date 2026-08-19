/**
 * A CSV reader that handles the things a brand's spreadsheet actually contains:
 * quoted fields, embedded commas and newlines, doubled quotes, a UTF-8 BOM from
 * Excel, and CRLF line endings.
 *
 * No dependency, because this runs against files people email us and the
 * failure mode of a surprising parser is a wrong price in the catalogue.
 */
export function parseCsv(input) {
  const src = input.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip the blank rows spreadsheets leave at the end of a file.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Rows keyed by a normalised header, so `Price PKR` and `price_pkr` both work. */
export function parseCsvObjects(input) {
  const rows = parseCsv(input);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const records = rows.slice(1).map((cells, index) => {
    const record = { __line: index + 2 };
    headers.forEach((h, c) => {
      record[h] = (cells[c] ?? '').trim();
    });
    return record;
  });
  return { headers, records };
}
