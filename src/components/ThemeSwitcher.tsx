'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/I18nProvider';

// ── Theme skins ────────────────────────────────────────
// Ported from the official SolarIOT ThemeSwitcher. Each skin renders a small
// SVG thumbnail tinted with its accent colour. `solar` (Solar Flow) is the only
// skin currently implemented; the rest are placeholders to be wired up later.

export type ThemeSkin =
  | 'solar' | 'energy' | 'aurora' | 'helios' | 'sundial' | 'verdant' | 'solar3d';

export const IMPLEMENTED_SKINS: ThemeSkin[] = ['solar'];

interface SkinDef {
  id: ThemeSkin;
  name: string;
  color: string;
  thumb: (c: string) => ReactNode;
}

function Thumb({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 52 34" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: 'auto', display: 'block' }}>
      {children}
    </svg>
  );
}

const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export const THEME_SKINS: SkinDef[] = [
  {
    id: 'solar', name: 'Solar Flow', color: '#f5a623',
    thumb: (c) => (
      <Thumb>
        <circle cx="10" cy="17" r="5" fill={c + '25'} stroke={c} strokeWidth="1.3" />
        {RAY_ANGLES.map(deg => {
          const r = deg * Math.PI / 180;
          return <line key={deg}
            x1={10 + 6 * Math.cos(r)} y1={17 + 6 * Math.sin(r)}
            x2={10 + 9 * Math.cos(r)} y2={17 + 9 * Math.sin(r)}
            stroke={c} strokeWidth="1" strokeLinecap="round" />;
        })}
        <line x1="19" y1="17" x2="26" y2="17" stroke={c} strokeWidth="1.2" />
        <polygon points="24,15.5 27,17 24,18.5" fill={c} />
        <rect x="27" y="13" width="8" height="8" rx="2" fill={c + '20'} stroke={c} strokeWidth="1" />
        <line x1="35" y1="15" x2="41" y2="10" stroke={c} strokeWidth="1" />
        <line x1="35" y1="19" x2="41" y2="24" stroke={c} strokeWidth="1" />
        <circle cx="43" cy="9" r="3" fill={c + '25'} stroke={c} strokeWidth="1" />
        <rect x="40" y="22" width="6" height="5" rx="1" fill={c + '25'} stroke={c} strokeWidth="1" />
      </Thumb>
    ),
  },
  {
    id: 'energy', name: 'Energy', color: '#00d4aa',
    thumb: (c) => (
      <Thumb>
        <rect x="4" y="5" width="44" height="6" rx="3" fill={c + '20'} stroke={c + '30'} strokeWidth="0.8" />
        <rect x="4" y="5" width="36" height="6" rx="3" fill={c + '90'} />
        <rect x="4" y="14" width="44" height="6" rx="3" fill={c + '20'} stroke={c + '30'} strokeWidth="0.8" />
        <rect x="4" y="14" width="22" height="6" rx="3" fill={c + '70'} />
        <rect x="4" y="23" width="44" height="6" rx="3" fill={c + '20'} stroke={c + '30'} strokeWidth="0.8" />
        <rect x="4" y="23" width="30" height="6" rx="3" fill={c + '80'} />
      </Thumb>
    ),
  },
  {
    id: 'aurora', name: 'Aurora', color: '#a78bfa',
    thumb: (c) => (
      <Thumb>
        <ellipse cx="26" cy="38" rx="26" ry="18" fill={c + '08'} stroke={c + '20'} strokeWidth="8" />
        <ellipse cx="26" cy="38" rx="18" ry="12" fill={c + '12'} stroke={c + '35'} strokeWidth="5" />
        <ellipse cx="26" cy="38" rx="10" ry="7" fill={c + '28'} stroke={c} strokeWidth="1.5" />
        <circle cx="26" cy="6" r="4" fill={c + '55'} stroke={c} strokeWidth="1" />
      </Thumb>
    ),
  },
  {
    id: 'helios', name: 'Helios', color: '#fbbf24',
    thumb: (c) => (
      <Thumb>
        <circle cx="26" cy="17" r="16" fill={c + '08'} />
        <circle cx="26" cy="17" r="11" fill={c + '18'} stroke={c + '30'} strokeWidth="1" />
        <circle cx="26" cy="17" r="6" fill={c + '55'} stroke={c} strokeWidth="1.5" />
        {RAY_ANGLES.map(deg => {
          const r = deg * Math.PI / 180;
          return <line key={deg}
            x1={26 + 7 * Math.cos(r)} y1={17 + 7 * Math.sin(r)}
            x2={26 + 13 * Math.cos(r)} y2={17 + 13 * Math.sin(r)}
            stroke={c} strokeWidth="1.3" strokeLinecap="round" opacity="0.8" />;
        })}
      </Thumb>
    ),
  },
  {
    id: 'sundial', name: 'Sundial', color: '#06b6d4',
    thumb: (c) => (
      <Thumb>
        <path d="M6 30 A20 20 0 0 1 46 30" fill="none" stroke={c + '25'} strokeWidth="6" strokeLinecap="round" />
        <path d="M6 30 A20 20 0 0 1 36 12" fill="none" stroke={c} strokeWidth="6" strokeLinecap="round" />
        <circle cx="26" cy="30" r="3.5" fill="white" stroke={c} strokeWidth="1.5" />
        <line x1="26" y1="30" x2="35" y2="13" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
      </Thumb>
    ),
  },
  {
    id: 'verdant', name: 'Verdant', color: '#22c55e',
    thumb: (c) => (
      <Thumb>
        <rect x="4" y="25" width="7" height="7" rx="2" fill={c + '45'} />
        <rect x="13" y="19" width="7" height="13" rx="2" fill={c + '60'} />
        <rect x="22" y="12" width="7" height="20" rx="2" fill={c + '78'} />
        <rect x="31" y="7" width="7" height="25" rx="2" fill={c + '90'} />
        <rect x="40" y="3" width="8" height="29" rx="2" fill={c} />
        <line x1="2" y1="32" x2="50" y2="32" stroke={c + '55'} strokeWidth="1.2" />
      </Thumb>
    ),
  },
  {
    id: 'solar3d', name: 'Solar 3D Pro', color: '#4aa8ff',
    thumb: () => (
      <Thumb>
        <rect x="0" y="0" width="52" height="34" rx="4" fill="#0c1730" />
        <rect x="0" y="0" width="52" height="34" rx="4" fill="#1d3a6b" opacity="0.35" />
        <circle cx="12" cy="8" r="3" fill="#ffb53d" opacity="0.9" />
        <circle cx="12" cy="8" r="5" fill="#ffb53d" opacity="0.18" />
        <polygon points="26,31 49,22 26,15 3,22" fill="#1c2f54" opacity="0.5" stroke="#3a66b0" strokeWidth="0.5" />
        <polygon points="22,25 30,22 30,15 22,18" fill="#dfe6f2" stroke="#9fb0d8" strokeWidth="0.6" />
        <polygon points="30,22 36,20 36,13 30,15" fill="#aebbd2" stroke="#7e8ec0" strokeWidth="0.6" />
        <polygon points="22,18 30,15 36,13 28,16" fill="#2b3446" stroke="#3a455e" strokeWidth="0.6" />
        <polygon points="30,15 36,13 34.2,11.6 28.4,13.4" fill="#2b50c8" />
        <polygon points="30,15 36,13 34.2,11.6 28.4,13.4" fill="#4aa8ff" opacity="0.4" />
        <circle cx="40" cy="24.5" r="1.4" fill="#5cf2c6" />
        <circle cx="44" cy="22.5" r="1.4" fill="#5cf2c6" opacity="0.7" />
      </Thumb>
    ),
  },
];

interface ThemeSwitcherProps {
  themeSkin: ThemeSkin;
  onThemeSkinChange: (skin: ThemeSkin) => void;
}

export default function ThemeSwitcher({ themeSkin, onThemeSkinChange }: ThemeSwitcherProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const POPOVER_W = 328;
      const MARGIN = 8;
      // Anchor the popover's right edge to the button, but clamp so it never
      // overflows the left/right viewport edges (the button isn't always at the
      // far right of the header).
      const maxRight = window.innerWidth - POPOVER_W - MARGIN;
      const right = Math.max(MARGIN, Math.min(window.innerWidth - r.right, Math.max(MARGIN, maxRight)));
      setPos({ top: r.bottom + 8, right });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button ref={btnRef} type="button" className="tsw-btn" onClick={toggle} title={t('theme.switchSkin')}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="6" height="6" rx="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" />
        </svg>
        <span>{t('theme.skin')}</span>
      </button>

      {open && (
        <div ref={popRef} className="tsw-popover" style={{ top: pos.top, right: pos.right }}>
          <div className="tsw-label">{t('theme.chooseSkin')}</div>
          <div className="tsw-grid">
            {THEME_SKINS.map(skin => {
              const implemented = IMPLEMENTED_SKINS.includes(skin.id);
              return (
                <button
                  key={skin.id}
                  type="button"
                  className={`tsw-card${skin.id === themeSkin ? ' active' : ''}${implemented ? '' : ' soon'}`}
                  style={{ ['--tsw-color' as any]: skin.color }}
                  onClick={() => { onThemeSkinChange(skin.id); setOpen(false); }}
                >
                  <div className="tsw-thumb">{skin.thumb(skin.color)}</div>
                  <div className="tsw-card-name">{skin.name}</div>
                  {!implemented && <div className="tsw-soon-tag">{t('theme.soon')}</div>}
                  {skin.id === themeSkin && (
                    <div className="tsw-badge">
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="white"
                        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1.5,5 4,7.5 8.5,2" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
