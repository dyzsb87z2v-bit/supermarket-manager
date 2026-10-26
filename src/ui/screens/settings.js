import { h, download } from '../dom.js';
import { t } from '../i18n/index.js';
import { state, ctx, render, persist, toast, loadWorkspace } from '../runtime.js';
import { field, filePicker, importReport, errorText, branchLabel, formatDate } from '../components.js';
import { todayStr } from '../../core/dates.js';
import { addBranch } from '../../core/inventory.js';
import { generateDemoDb } from '../../core/demo.js';
import { exportBackup, exportMovementsCsv, exportProductsCsv, importMovementsCsv, importProductsCsv, parseBackup } from '../../core/io.js';
import { parseNumber } from '../../core/numbers.js';
import { supportedLanguages } from '../i18n/index.js';
import { changeLanguage } from '../app-lang.js';
import { getLang } from '../i18n/index.js';

export function doBackup() {
  download(`backup-${state.ws === 'demo' ? 'DEMO-' : ''}${todayStr()}.json`, exportBackup(state.db), 'application/json');
  state.db.meta.lastBackupAt = todayStr();
  persist();
  toast(t('settings.backupDone'));
}

export function screenSettings() {
  const db = state.db;
  const c = ctx();
  const result = h('div', { 'data-testid': 'import-result' });
  const run = async (fn, text) => {
    const res = fn(text);
    importReport(res, result);
    if (res.ok) { await persist(); toast(t('common.done')); }
  };
  const prefix = state.ws === 'demo' ? 'DEMO-' : '';

  const numSetting = (label, key, min, max, hint) => {
    const input = h('input', { value: String(db.settings[key]), inputMode: 'numeric', dir: 'ltr' });
    input.addEventListener('change', () => {
      const v = parseNumber(input.value);
      if (!Number.isInteger(v) || v < min || v > max) { input.value = String(db.settings[key]); toast(t('settings.rangeHint', { min, max })); return; }
      db.settings[key] = v; persist(); toast(t('common.saved'));
    });
    return field(label, input, hint);
  };
  const shop = h('input', { value: db.settings.shopName, dir: 'auto', onchange: (e) => { db.settings.shopName = e.target.value.trim(); persist(); } });
  const orderLang = h('select', { onchange: (e) => { db.settings.orderLang = e.target.value; persist(); toast(t('common.saved')); } },
    h('option', { value: 'de', text: t('settings.orderLangDe'), selected: db.settings.orderLang === 'de' }),
    h('option', { value: 'tr', text: t('settings.orderLangTr'), selected: db.settings.orderLang === 'tr' }));
  const branchName = h('input', { placeholder: t('settings.branchName'), dir: 'auto' });
  const lang = h('select', { 'aria-label': t('settings.language'), 'data-testid': 'lang-select', 'data-user': '', onchange: (e) => changeLanguage(e.target.value, 'lang-select') },
    supportedLanguages().map((l) => h('option', { value: l.code, text: l.endonym, selected: l.code === getLang() })));

  return h('main', {},
    h('section', { class: 'card form' }, h('h2', { text: t('settings.language') }), lang),

    h('section', { class: 'card form' }, h('h2', { text: t('settings.workspace') }),
      h('p', { class: 'muted', text: t('settings.workspaceHelp') }),
      h('div', { class: 'seg', role: 'group' },
        h('button', { 'data-testid': 'ws-real', 'aria-pressed': String(state.ws === 'real'), onclick: async () => { await loadWorkspace('real'); state.tab = 'home'; render(); }, text: t('settings.wsReal') }),
        h('button', { 'data-testid': 'ws-demo', 'aria-pressed': String(state.ws === 'demo'), onclick: async () => { await loadWorkspace('demo'); state.tab = 'home'; render(); }, text: t('settings.wsDemo') })),
      state.ws === 'demo' ? h('button', { onclick: async () => {
        if (!confirm(t('settings.demoResetConfirm'))) return;
        state.db = generateDemoDb(todayStr()); state.branchId = state.db.branches[0].id; await persist(); toast(t('settings.demoReset')); render();
      }, text: t('settings.demoResetBtn') }) : null),

    h('section', { class: 'card form' }, h('h2', { text: t('settings.importTitle') }),
      h('p', { class: 'muted', text: t('settings.importHelp') }),
      h('div', { class: 'btns' },
        filePicker(t('settings.importProducts'), (x) => run((txt) => importProductsCsv(db, txt, { branchId: state.branchId }), x), 'file-products'),
        filePicker(t('settings.importSales'), (x) => run((txt) => importMovementsCsv(db, txt, { defaultType: 'sale', branchId: state.branchId }), x), 'file-sales'),
        filePicker(t('settings.importReceipts'), (x) => run((txt) => importMovementsCsv(db, txt, { defaultType: 'receive', branchId: state.branchId }), x), 'file-receipts')),
      h('details', {}, h('summary', { text: t('settings.columnsTitle') }),
        h('p', { class: 'muted' }, `${t('settings.columnsProducts')} `, h('span', { class: 'ltr', 'data-user': '', text: 'barcode; name_de; name_tr; category; supplier; buy_price; sell_price; unit; min_stock; pack_size; active; stock; expiry' })),
        h('p', { class: 'muted' }, `${t('settings.columnsMovements')} `, h('span', { class: 'ltr', 'data-user': '', text: 'date; barcode; qty; (unit_price; unit_cost; expiry; type; branch; note)' })),
        h('p', { class: 'muted', text: t('settings.columnsHelp') })),
      result),

    h('section', { class: 'card form' }, h('h2', { text: t('settings.exportTitle') }),
      h('div', { class: 'btns' },
        h('button', { onclick: () => download(`products-${prefix}${todayStr()}.csv`, exportProductsCsv(db, c.stock)), text: t('settings.exportProducts') }),
        h('button', { onclick: () => download(`movements-${prefix}${todayStr()}.csv`, exportMovementsCsv(db)), text: t('settings.exportMovements') }))),

    h('section', { class: 'card form' }, h('h2', { text: t('settings.backupTitle') }),
      h('p', { class: 'muted', text: db.meta.lastBackupAt ? t('settings.lastBackup', { date: formatDate(db.meta.lastBackupAt) }) : t('settings.noBackup') }),
      h('div', { class: 'btns' }, h('button', { class: 'primary', 'data-testid': 'backup', onclick: doBackup, text: t('settings.backupDownload') }),
        filePicker(t('settings.restore'), async (text) => {
          const res = parseBackup(text, { expectDemo: state.ws === 'demo' });
          if (!res.ok) { importReport({ ok: false, errors: res.errors.map((code) => ({ line: '-', code })) }, result); return; }
          if (!confirm(t('settings.restoreConfirm'))) return;
          state.db = res.db; state.branchId = res.db.branches[0].id; await persist(); toast(t('settings.restored')); render();
        }, 'file-restore'))),

    h('section', { class: 'card form' }, h('h2', { text: t('settings.calcTitle') }),
      field(t('settings.shopName'), shop, t('settings.shopNameHint')),
      field(t('settings.orderLang'), orderLang, t('settings.orderLangHint')),
      numSetting(t('settings.windowDays'), 'salesWindowDays', 7, 180),
      numSetting(t('settings.coverDays'), 'coverDays', 1, 60, t('settings.coverDaysHint')),
      numSetting(t('settings.expiryDays'), 'expiryWarnDays', 1, 60),
      numSetting(t('settings.leadDefault'), 'defaultLeadTimeDays', 0, 60, t('settings.leadDefaultHint'))),

    h('section', { class: 'card form' }, h('h2', { text: t('settings.branches') }),
      db.branches.map((b) => h('div', { class: 'row' }, h('span', { class: 'grow', 'data-user': '', text: branchLabel(b) }), b.id === state.branchId ? h('span', { class: 'chip ok', text: t('settings.branchActive') }) : null)),
      h('div', { class: 'btns' }, branchName, h('button', { onclick: () => {
        const r = addBranch(db, branchName.value);
        if (!r.ok) { toast(errorText(r.errors[0])); return; }
        persist(); render();
      }, text: t('settings.addBranch') })),
      h('p', { class: 'muted', text: t('settings.branchesHelp') })),

    state.ws === 'real' ? h('section', { class: 'card form' }, h('h2', { text: t('settings.danger') }),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm(t('settings.wipeConfirm'))) return;
        if (prompt(t('settings.wipePrompt')) !== 'DELETE') return;
        await state.store.clear('real'); await loadWorkspace('real'); toast(t('settings.wiped')); render();
      }, text: t('settings.wipe') })) : null,

    h('p', { class: 'muted', text: `${state.storageKind === 'indexeddb' ? t('settings.storageIdb') : t('settings.storageMemory')} ${t('settings.noPos')}` }));
}
