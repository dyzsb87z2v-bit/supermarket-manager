import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, PRODUCTION_LOCALES, pickLocale, localeByCode } from '../src/core/locales.js';
import { MOVEMENT_TYPES, UNITS } from '../src/core/model.js';
import { checkPacks } from './i18n-gate.js';
import { pseudoValue, pseudoize } from '../src/ui/i18n/pseudo.js';
import { formatEuro, formatQty, formatDate, setFormatLocale } from '../src/core/format.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (code) => (await import(`../src/ui/i18n/${code}.js`)).default;
const packs = Object.fromEntries(await Promise.all(PRODUCTION_LOCALES.map(async (l) => [l.code, await load(l.code)])));
const clone = (o) => JSON.parse(JSON.stringify(o));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const uiFiles = walk(path.join(root, 'src/ui')).filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}i18n${path.sep}`));
const uiSource = uiFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

/* ---------- the gate itself ---------- */

test('registry: German, Turkish and Persian are registered, pseudo is excluded from production', () => {
  assert.deepEqual(PRODUCTION_LOCALES.map((l) => l.code), ['de', 'tr', 'fa']);
  assert.ok(LOCALES.some((l) => l.status === 'pseudo'));
  assert.equal(localeByCode('fa').dir, 'rtl');
});

test('all language packs are complete and consistent (keys, placeholders, plurals, script, no untranslated copies)', () => {
  assert.deepEqual(checkPacks(packs), []);
});

test('the gate can fail: every defect class is detected on a deliberately broken pack', () => {
  const broken = (mutate) => { const p = clone(packs); mutate(p); return checkPacks(p).join('\n'); };
  assert.match(broken((p) => { delete p.tr['nav.home']; }), /tr: missing key nav\.home/);
  assert.match(broken((p) => { p.tr['nav.typo'] = 'x'; }), /tr: extra key nav\.typo/);
  assert.match(broken((p) => { p.tr['common.save'] = ' '; }), /empty value common\.save/);
  assert.match(broken((p) => { p.tr['stock.booked'] = '{type} kaydedildi'; }), /placeholder mismatch stock\.booked/);
  assert.match(broken((p) => { delete p.fa['common.days.other']; }), /lacks category "other"/);
  assert.match(broken((p) => { p.tr['common.save'] = p.de['common.save']; }), /untranslated copy common\.save/);
  assert.match(broken((p) => { p.fa['common.save'] = 'Speichern'; }), /wrong script common\.save/);
  assert.match(broken((p) => { delete p.fa; }), /fa: no pack/);
  assert.match(checkPacks({ de: packs.de }, { locales: [] })[0], /registry is empty/);
  assert.match(checkPacks(packs, { locales: [{ ...PRODUCTION_LOCALES[1], status: 'live' }] }).join(), /live without review record/);
});

test('enum coverage: every unit, movement type, alert level and core error code has a label in every language', () => {
  const need = [...UNITS.flatMap((u) => [`unit.${u}`, `unitOption.${u}`]), ...MOVEMENT_TYPES.map((m) => `move.${m}`),
    ...['out', 'low', 'expired', 'soon'].map((l) => `level.${l}`)];
  const coreSrc = ['inventory.js', 'io.js'].map((f) => fs.readFileSync(path.join(root, 'src/core', f), 'utf8')).join('\n');
  // codes appear as push('x'), errors: ['x'] or code: 'x'
  const codes = new Set([...coreSrc.matchAll(/(?:push\(|errors:\s*\[|code:\s*)'([a-z]+(?:_[a-z]+)+)'/g)].map((m) => m[1]));
  codes.add('missing_barcode_column'); codes.add('missing_qty_column'); // built from a template string in io.js
  assert.ok(codes.size >= 25, `expected many error codes, found ${codes.size}`);
  need.push(...[...codes].map((c) => `err.${c}`));
  for (const code of PRODUCTION_LOCALES.map((l) => l.code)) {
    const missing = need.filter((k) => !(k in packs[code]));
    assert.deepEqual(missing, [], `${code} lacks labels`);
  }
});

test('every key used by the UI exists, and no pack key is unused (static scan of t()/tn() calls)', () => {
  const used = new Set([...uiSource.matchAll(/\btn?\(\s*'([\w]+(?:\.[\w]+)+)'/g)].map((m) => m[1]));
  for (const m of uiSource.matchAll(/'((?:unit|unitOption|move|level)\.\w+)'/g)) used.add(m[1]);
  const pluralBase = (k) => k.replace(/\.(one|other|few|many|two|zero)$/, '');
  const keys = Object.keys(packs.de);
  const known = (k) => keys.includes(k) || keys.some((x) => pluralBase(x) === k);
  assert.deepEqual([...used].filter((k) => !known(k)), [], 'used but undefined');
  // keys may also be referenced from lookup tables (e.g. nav labels), so accept any quoted literal equal to a key
  const literals = new Set([...uiSource.matchAll(/'([\w]+(?:\.[\w]+)+)'/g)].map((m) => m[1]));
  const unused = keys.filter((k) => !k.startsWith('err.') && !used.has(k) && !used.has(pluralBase(k)) && !literals.has(k) && !literals.has(pluralBase(k)));
  assert.deepEqual(unused, [], 'defined but never used');
  assert.ok(used.size > 150, `scan looks too small (${used.size})`);
});

test('lint: no call-site literal fallbacks and no raw user-facing text in screens', () => {
  assert.doesNotMatch(uiSource, /\bt\('[\w.]+'(?:,[^)\n]*)?\)\s*(?:\|\||\?\?)\s*['"`]/, 't() with literal fallback');
  assert.doesNotMatch(uiSource, /defaultValue/);
  assert.doesNotMatch(uiSource, /\.innerHTML\s*=|insertAdjacentHTML|v-html/, 'translations must never be rendered as HTML');
  const offenders = [];
  for (const f of uiFiles) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('data-user') || line.includes('data-testid') && !/text:/.test(line)) return;
      for (const m of line.matchAll(/\btext:\s*'([^']*)'/g)) if (/\p{L}{2,}/u.test(m[1])) offenders.push(`${path.basename(f)}:${i + 1} text: '${m[1]}'`);
    });
  }
  assert.deepEqual(offenders, []);
});

/* ---------- supporting pieces ---------- */

test('locale negotiation: browser preference, regional variants, unsupported -> German', () => {
  assert.equal(pickLocale(['tr-TR', 'en']), 'tr');
  assert.equal(pickLocale(['en-US', 'de-AT']), 'de');
  assert.equal(pickLocale(['fa-IR']), 'fa');
  assert.equal(pickLocale(['fr', 'ja']), 'de');
  assert.equal(pickLocale([]), 'de');
  assert.equal(pickLocale(['en-XA']), 'de', 'pseudo is not selectable in production');
  assert.equal(pickLocale(['en-XA'], { allowPseudo: true }), 'en-XA');
});

test('pseudo-locale marks values, keeps placeholders intact and pads', () => {
  const v = pseudoValue('{n} Artikel im Lager');
  assert.match(v, /^⟦\{n\} .*⟧$/);
  assert.ok(v.length > '{n} Artikel im Lager'.length);
  assert.deepEqual(Object.keys(pseudoize(packs.de)), Object.keys(packs.de));
});

test('number and date formatting follow the active locale', () => {
  setFormatLocale('de-DE');
  assert.equal(formatQty(1234.5), '1.234,5');
  assert.match(formatEuro(129), /^1,29\s€$/);
  assert.equal(formatDate('2026-03-31'), '31.03.2026');
  assert.equal(formatEuro(null), '—');
  setFormatLocale('tr-TR');
  assert.match(formatEuro(129), /€\s?1,29|1,29\s?€/);
  assert.equal(formatDate('2026-03-31'), '31.03.2026');
  setFormatLocale('de-DE');
});

/* ---------- runtime lookup policy ---------- */

test('t(): translates, interpolates, plural categories; dev is loud, production falls back to German with a warning', async () => {
  const calls = { error: [], warn: [] };
  const orig = { error: console.error, warn: console.warn };
  console.error = (m) => calls.error.push(m); console.warn = (m) => calls.warn.push(m);
  globalThis.document = { documentElement: {} };
  try {
    globalThis.location = { hostname: 'localhost', search: '' };
    const i18n = await import('../src/ui/i18n/index.js');
    await i18n.setLang('tr');
    assert.equal(i18n.t('nav.home'), 'Ana sayfa');
    assert.equal(globalThis.document.documentElement.lang, 'tr');
    assert.equal(globalThis.document.documentElement.dir, 'ltr');
    assert.equal(i18n.t('stock.booked', { type: 'Satış', name: 'Ekmek' }), 'Satış kaydedildi: Ekmek');
    assert.equal(i18n.tn('common.days', 3), '3 gün');
    await i18n.setLang('de');
    assert.equal(i18n.tn('common.days', 1), '1 Tag');
    assert.equal(i18n.tn('common.days', 2), '2 Tage');
    await i18n.setLang('fa');
    assert.equal(globalThis.document.documentElement.dir, 'rtl');

    // dev: marker + console.error (so tests/CI see it)
    assert.equal(i18n.t('no.such.key'), '⟦missing:no.such.key⟧');
    assert.ok(calls.error.some((m) => m.includes('no.such.key')));
    i18n.t('stock.booked'); // missing variables are reported too
    assert.ok(calls.error.some((m) => m.includes('variable')));

    // production host: German fallback for a key absent in tr, reported once as a warning
    await i18n.setLang('tr');
    const tr = await load('tr');
    const saved = tr['nav.home'];
    delete tr['nav.home'];
    globalThis.location = { hostname: 'shop.example.com', search: '' };
    assert.equal(i18n.t('nav.home'), 'Start');
    assert.ok(calls.warn.some((m) => m.includes('nav.home')));
    assert.equal(i18n.t('unknown.key.here'), 'unknown.key.here', 'never blank in production');
    tr['nav.home'] = saved;

    await i18n.setLang('en-XA');
    assert.match(i18n.t('nav.home'), /^⟦.*⟧$/);
    assert.equal(globalThis.document.documentElement.lang, 'en');
  } finally {
    Object.assign(console, orig);
    delete globalThis.document; delete globalThis.location;
  }
});

test('percent values use the locale decimal separator', async () => {
  const { formatPct } = await import('../src/core/format.js');
  setFormatLocale('de-DE');
  assert.equal(formatPct(32.26), '32,3');
  assert.equal(formatPct(100, { sign: true }), '+100');
  assert.equal(formatPct(-12.5, { sign: true }), '-12,5');
  setFormatLocale('de-DE');
});
