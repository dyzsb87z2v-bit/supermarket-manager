// Minimal RFC-4180 CSV parser/serializer. Auto-detects , ; or tab. Handles BOM, quotes, CRLF.

export function detectDelimiter(text) {
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\n') break;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

export function parseCsv(text, delimiter) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function escapeField(v, delimiter) {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection for text that starts with a formula character.
  if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s))) s = `'${s}`;
  return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Semicolon + BOM by default: opens correctly in Excel with German/Turkish regional settings. */
export function toCsv(rows, { delimiter = ';', bom = true } = {}) {
  const body = rows.map((r) => r.map((c) => escapeField(c, delimiter)).join(delimiter)).join('\r\n');
  return (bom ? '﻿' : '') + body + '\r\n';
}

const TRANSLIT = { 'ı': 'i', 'ş': 's', 'ç': 'c', 'ğ': 'g', 'ö': 'o', 'ü': 'u', 'ä': 'a', 'ß': 'ss', 'İ': 'i' };

export function normalizeHeader(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[ışçğöüäß]/g, (c) => TRANSLIT[c])
    .replace(/[\s_\-.]/g, '');
}

/**
 * Turns CSV text into { records, unknownHeaders, headers } using an alias table
 * { canonicalName: ['alias', ...] } (aliases must already be normalised).
 */
export function parseTable(text, aliasTable) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { records: [], headers: [], unknownHeaders: [] };
  const lookup = new Map();
  for (const [canon, aliases] of Object.entries(aliasTable)) {
    lookup.set(normalizeHeader(canon), canon);
    for (const a of aliases) lookup.set(normalizeHeader(a), canon);
  }
  const rawHeaders = rows[0];
  const headers = rawHeaders.map((h) => lookup.get(normalizeHeader(h)) ?? null);
  const unknownHeaders = rawHeaders.filter((_, i) => headers[i] === null && rawHeaders[i].trim() !== '');
  const records = rows.slice(1).map((r, idx) => {
    const rec = { _line: idx + 2 };
    headers.forEach((canon, i) => {
      if (canon && rec[canon] === undefined) rec[canon] = (r[i] ?? '').trim();
    });
    return rec;
  });
  return { records, headers: headers.filter(Boolean), unknownHeaders };
}
