import { h } from './dom.js';
import { icon } from './icons.js';
import { t, setLang } from './i18n/index.js';
import { state, bus, persist, loadWorkspace, lsGet, render } from './runtime.js';
import { branchLabel } from './components.js';
import { initialLanguage, changeLanguage } from './app-lang.js';
import { createEmptyDb } from '../core/model.js';
import { createStore, indexedDbBackend, memoryBackend } from '../core/store.js';
import { supportedLanguages, getLang } from './i18n/index.js';
import { screenHome } from './screens/home.js';
import { screenProducts } from './screens/products.js';
import { screenStock } from './screens/stock.js';
import { screenOrders } from './screens/orders.js';
import { screenReports } from './screens/reports.js';
import { screenSettings } from './screens/settings.js';

const root = document.getElementById('app');

const SCREENS = { home: screenHome, products: screenProducts, stock: screenStock, orders: screenOrders, reports: screenReports, settings: screenSettings };
const TABS = [
  ['home', 'nav.home', 'home'], ['products', 'nav.products', 'box'], ['stock', 'nav.stock', 'swap'],
  ['orders', 'nav.orders', 'clipboard'], ['reports', 'nav.reports', 'chart'],
];

function renderBanners() {
  document.querySelectorAll('.banner.persist').forEach((n) => n.remove());
  const host = root.querySelector('header.top');
  if (!host) return;
  const add = (cls, text) => host.after(h('div', { class: `banner persist ${cls}`, role: 'alert', text }));
  if (state.saveError) add('bad', t('banner.saveFailed', { error: state.saveError }));
  if (state.ws === 'demo') add('demo', t('banner.demo'));
  if (state.storageKind !== 'indexeddb') add('warn', t('banner.noStorage'));
}

function renderApp() {
  const inSettings = state.tab === 'settings';
  const header = h('header', { class: 'top' },
    h('h1', { text: inSettings ? t('settings.title') : t('app.title') }),
    state.ws === 'demo' ? h('span', { class: 'badge', text: t('app.demoBadge') }) : null,
    state.db.branches.length > 1 ? h('select', { class: 'hsel', 'data-user': '', 'aria-label': t('app.branch'), onchange: (e) => { state.branchId = e.target.value; render(); } },
      state.db.branches.map((b) => h('option', { value: b.id, text: branchLabel(b), selected: b.id === state.branchId }))) : null,
    h('select', { class: 'hsel lang', 'aria-label': t('settings.language'), 'data-testid': 'header-lang', 'data-user': '', onchange: (e) => changeLanguage(e.target.value, 'header-lang') },
      supportedLanguages().map((l) => h('option', { value: l.code, text: l.code.toUpperCase(), selected: l.code === getLang() }))),
    h('button', { class: 'icon-btn on-dark', 'data-testid': 'open-settings', 'aria-label': inSettings ? t('common.close') : t('settings.title'),
      onclick: () => { state.tab = inSettings ? 'home' : 'settings'; render(); } }, icon(inSettings ? 'x' : 'sliders')));
  const nav = h('nav', { class: 'tabs', 'aria-label': t('nav.label') }, TABS.map(([key, labelKey, ic]) =>
    h('button', { 'data-testid': `tab-${key}`, 'aria-current': state.tab === key ? 'page' : false,
      onclick: () => { state.tab = key; render(); window.scrollTo(0, 0); } }, icon(ic), h('span', { text: t(labelKey) }))));
  root.replaceChildren(header, SCREENS[state.tab](), nav);
  renderBanners();
}

bus.render = renderApp;
bus.banners = renderBanners;

async function boot() {
  try {
    await setLang(initialLanguage());
  } catch {
    try { await setLang('de'); } catch {
      root.textContent = 'Laden fehlgeschlagen — bitte Seite neu laden. / Yüklenemedi — lütfen sayfayı yenileyin.'; // no language pack available at all
      return;
    }
  }
  document.title = t('app.title');
  let backend;
  try {
    if (!('indexedDB' in window)) throw new Error('no idb');
    backend = indexedDbBackend();
    await backend.get('probe');
  } catch {
    backend = memoryBackend();
  }
  state.storageKind = backend.kind;
  state.store = createStore(backend);
  if (backend.kind === 'indexeddb') navigator.storage?.persist?.().catch(() => {});
  try {
    await loadWorkspace(lsGet('smm:ws') === 'demo' ? 'demo' : 'real');
  } catch (e) {
    state.store = createStore(memoryBackend());
    state.db = createEmptyDb();
    state.branchId = state.db.branches[0].id;
    state.saveError = t('banner.loadFailed', { error: e.message });
  }
  renderApp();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
}

boot();
