import { pickLocale, localeByCode } from '../core/locales.js';
import { setLang, t } from './i18n/index.js';
import { lsGet, lsSet, render } from './runtime.js';

const isDevHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** URL ?lang= (pseudo only on dev hosts) -> saved choice -> browser preference -> German. */
export function initialLanguage() {
  const wanted = new URLSearchParams(location.search).get('lang');
  if (wanted && localeByCode(wanted) && (localeByCode(wanted).status !== 'pseudo' || isDevHost())) return wanted;
  const saved = lsGet('smm:lang');
  if (saved && localeByCode(saved) && localeByCode(saved).status !== 'pseudo') return saved;
  return pickLocale(navigator.languages ?? [navigator.language]);
}

export async function changeLanguage(code) {
  await setLang(code);
  if (localeByCode(code).status !== 'pseudo') lsSet('smm:lang', code);
  document.title = t('app.title');
  render();
}
