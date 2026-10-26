import { h } from './dom.js';
import { icon } from './icons.js';
import { t, tn } from './i18n/index.js';
import { formatDate } from '../core/format.js';

export const pname = (p) => p.nameDe || p.nameTr;
export const eurIn = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
export const qtyIn = (q) => String(q).replace('.', ',');
export { formatDate };

const UNIT_KEY = { Stk: 'unit.Stk', kg: 'unit.kg', l: 'unit.l', Pkg: 'unit.Pkg' };
export const unitLabel = (u) => t(UNIT_KEY[u] ?? 'unit.Stk');
export const unitOption = (u) => t({ Stk: 'unitOption.Stk', kg: 'unitOption.kg', l: 'unitOption.l', Pkg: 'unitOption.Pkg' }[u]);

const MOVE_KEY = { receive: 'move.receive', sale: 'move.sale', waste: 'move.waste', adjust: 'move.adjust' };
export const moveLabel = (type) => t(MOVE_KEY[type]);

const LEVEL_KEY = { out: 'level.out', low: 'level.low', expired: 'level.expired', soon: 'level.soon' };
export const levelLabel = (level) => t(LEVEL_KEY[level]);

export const errorText = (code) => t(`err.${code}`);
export const daysLabel = (n) => tn('common.days', n);

/** Default branch is stored with a German name; show it in the UI language. */
export const branchLabel = (b) => (b.id === 'main' && b.name === 'Hauptfiliale' ? t('branch.main') : b.name);

export function field(label, input, hint) {
  return h('label', { class: 'f' }, h('span', { class: 'f-label', text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
}

export const errList = (codes) => h('ul', { class: 'errors', role: 'alert' }, codes.map((c) => h('li', { text: errorText(c) })));

/** Names are user data: marked so the pseudo-locale sweep knows they are not UI strings. */
export function nameBlock(p) {
  return h('div', { class: 'grow' },
    h('div', { class: 'name ltr', 'data-user': '', text: p.nameDe || p.nameTr }),
    p.nameDe && p.nameTr ? h('div', { class: 'sub ltr', 'data-user': '', text: p.nameTr }) : null);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Modal dialog: focus moves into it, Tab is kept inside, Escape closes, focus returns to the opener. */
export function openSheet(title, body) {
  const opener = document.activeElement;
  const bg = h('div', { class: 'sheet-bg' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('h2', {}, h('span', { text: title }), h('button', { class: 'icon-btn', onclick: () => close(), 'aria-label': t('common.close') }, icon('x'))), body);
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  function close() {
    bg.remove();
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus?.();
  }
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.append(panel);
  document.body.append(bg);
  panel.focus(); // the dialog itself, so no on-screen keyboard pops up unasked
  return { close };
}

export function filePicker(label, onText, testId) {
  const input = h('input', { type: 'file', accept: '.csv,.txt,.json,text/csv,application/json', hidden: true, 'data-testid': testId });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (f) await onText(await f.text(), f.name);
    input.value = '';
  });
  return h('span', {}, input, h('button', { onclick: () => input.click(), text: label }));
}

export function importReport(res, container) {
  container.replaceChildren();
  if (res.ok) {
    const parts = [];
    if (res.created !== undefined) parts.push(t('import.products', { created: res.created, updated: res.updated }));
    if (res.stockSet) parts.push(t('import.stockSet', { n: res.stockSet }));
    if (res.imported !== undefined) parts.push(t('import.movements', { n: res.imported }));
    container.append(h('p', { class: 'banner ok', role: 'status', text: `${t('import.done')} ${parts.join(' · ')}` }));
  } else {
    container.append(
      h('p', { class: 'banner bad', role: 'alert', text: t('import.failed') }),
      h('ul', { class: 'errors' }, res.errors.slice(0, 25).map((e) =>
        h('li', { text: t('import.errorLine', { line: e.line, message: errorText(e.code) }) + (e.detail ? ` (${e.detail})` : '') }))),
      res.errors.length > 25 ? h('p', { class: 'muted', text: t('common.moreItems', { n: res.errors.length - 25 }) }) : null);
  }
  if (res.unknownHeaders?.length) {
    container.append(h('p', { class: 'muted', text: t('import.unknownColumns', { columns: res.unknownHeaders.join(', ') }) }));
  }
}

export function statTag(value, label, tone = '') {
  return h('div', { class: `tag ${tone}` }, h('b', { class: 'num', text: value }), h('span', { text: label }));
}

export const levelChip = (level) => h('span', { class: `chip ${level}`, text: levelLabel(level) });
