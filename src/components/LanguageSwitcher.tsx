'use client';

import { useI18n } from '@/lib/i18n/I18nProvider';
import { LANGUAGES } from '@/lib/i18n/translations';

// Compact VI/EN toggle. `variant` picks the styling so it can sit in both the
// desktop topbar (a regular sf-btn) and the mobile header (a circle button).
export default function LanguageSwitcher({ variant = 'btn' }: { variant?: 'btn' | 'circle' }) {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'vi' ? 'en' : 'vi';
  const current = LANGUAGES.find(l => l.id === lang) ?? LANGUAGES[0];

  return (
    <button
      type="button"
      className={variant === 'circle' ? 'sfm-circle-btn' : 'sf-btn'}
      onClick={() => setLang(next)}
      title={t('common.switchLanguage')}
    >
      {current.short}
    </button>
  );
}