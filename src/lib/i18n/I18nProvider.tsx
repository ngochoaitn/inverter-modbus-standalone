'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, type Lang } from './translations';

const LANG_KEY = 'solariot.lang';
const DEFAULT_LANG: Lang = 'vi';

type Vars = Record<string, string | number>;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Vars, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolve(dict: any, key: string): unknown {
  return key.split('.').reduce<any>((obj, part) => (obj == null ? undefined : obj[part]), dict);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start on the default language so SSR and the first client render
  // match; the saved choice is applied right after mount (no hydration flash
  // for the default-language case).
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'vi' || saved === 'en') setLangState(saved);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* ignore */ }
    try { document.documentElement.lang = next; } catch { /* ignore */ }
  }, []);

  const t = useCallback((key: string, vars?: Vars, fallback?: string) => {
    let value = resolve(translations[lang], key);
    if (value == null) value = resolve(translations.vi, key); // fall back to vi
    if (typeof value !== 'string') return fallback ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        value = (value as string).split(`{${k}}`).join(String(v));
      }
    }
    return value as string;
  }, [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

export function useT() {
  return useI18n().t;
}