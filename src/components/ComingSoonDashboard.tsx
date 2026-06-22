'use client';

import ThemeSwitcher, { THEME_SKINS, type ThemeSkin } from './ThemeSwitcher';
import LanguageSwitcher from './LanguageSwitcher';
import { useT } from '@/lib/i18n/I18nProvider';

interface ComingSoonDashboardProps {
  themeSkin: ThemeSkin;
  onThemeSkinChange: (skin: ThemeSkin) => void;
}

// Placeholder shown for theme skins that are picked but not yet implemented.
// Keeps the ThemeSwitcher reachable so the user can switch back to Solar Flow.
export default function ComingSoonDashboard({ themeSkin, onThemeSkinChange }: ComingSoonDashboardProps) {
  const t = useT();
  const skin = THEME_SKINS.find(s => s.id === themeSkin) ?? THEME_SKINS[0];
  const solarName = THEME_SKINS[0].name;

  return (
    <div className="sf-layout">
      <div className="sf-topbar">
        <div className="sf-topbar-row1">
          <div>
            <div className="sf-crumbs">
              <div className="sf-status-dot" />
              <span>{t('theme.ui')}</span>
            </div>
            <h1 className="sf-stage-title">{skin.name.toUpperCase()}</h1>
          </div>
          <div className="sf-topbar-actions">
            <LanguageSwitcher />
            <ThemeSwitcher themeSkin={themeSkin} onThemeSkinChange={onThemeSkinChange} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ width: 104, height: 68, padding: 10, borderRadius: 12, border: `1.5px solid ${skin.color}`, background: `color-mix(in srgb, ${skin.color} 8%, var(--sf-panel))` }}>
          {skin.thumb(skin.color)}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sf-ink)' }}>{skin.name}</div>
          <div style={{ fontSize: 13, color: 'var(--sf-ink-3)', marginTop: 6 }}>
            {t('theme.comingSoon', { skin: solarName })}
          </div>
        </div>
        <button
          type="button"
          className="sf-btn sf-btn-primary"
          onClick={() => onThemeSkinChange('solar')}
        >
          {t('theme.backTo', { skin: solarName })}
        </button>
      </div>
    </div>
  );
}
