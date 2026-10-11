// Builds a CSV file that opens correctly in Excel (UTF-8 BOM, CRLF, quoted cells).

// Cells starting with these are run as formulas by Excel/Sheets ("CSV injection"),
// e.g. a user named "=HYPERLINK(...)". Prefixing with ' makes them plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns, rows) {
  const header = columns.map((c) => cell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(c.value(row))).join(','));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}

function sendCsv(res, filename, columns, rows) {
  const date = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}-${date}.csv"`);
  res.send(toCsv(columns, rows));
}

module.exports = { toCsv, sendCsv };
