'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// User preference for how power readouts are displayed:
//  - 'auto': small values in W, ≥1000 W in kW (the original mixed behaviour)
//  - 'W'   : always watts (integer)
//  - 'kW'  : always kilowatts (2 decimals)
export type PowerUnit = 'auto' | 'W' | 'kW';

const KEY = 'solariot.powerUnit';
const ORDER: PowerUnit[] = ['auto', 'W', 'kW'];

export interface FormattedPower { value: string; unit: string; }

export function formatPower(watts: unknown, unit: PowerUnit, decimals = 2): FormattedPower {
  const w = Number(watts);
  const safe = Number.isFinite(w) ? w : 0;
  const useKw = unit === 'kW' || (unit === 'auto' && Math.abs(safe) >= 1000);
  if (useKw) return { value: (safe / 1000).toFixed(decimals), unit: 'kW' };
  return { value: String(Math.round(safe)), unit: 'W' };
}

interface PowerUnitContextValue {
  unit: PowerUnit;
  setUnit: (unit: PowerUnit) => void;
  cycle: () => void;
  /** Format a wattage according to the current preference. */
  pw: (watts: unknown, decimals?: number) => FormattedPower;
}

const PowerUnitContext = createContext<PowerUnitContextValue | null>(null);

export function PowerUnitProvider({ children }: { children: ReactNode }) {
  // Start on 'auto' so SSR and the first client render match; the saved choice
  // is applied right after mount.
  const [unit, setUnitState] = useState<PowerUnit>('auto');

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved === 'auto' || saved === 'W' || saved === 'kW') setUnitState(saved);
  }, []);

  const persist = (u: PowerUnit) => { try { localStorage.setItem(KEY, u); } catch { /* ignore */ } };

  const setUnit = useCallback((u: PowerUnit) => { setUnitState(u); persist(u); }, []);

  const cycle = useCallback(() => {
    setUnitState(prev => {
      const next = ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length];
      persist(next);
      return next;
    });
  }, []);

  const pw = useCallback((watts: unknown, decimals = 2) => formatPower(watts, unit, decimals), [unit]);

  return (
    <PowerUnitContext.Provider value={{ unit, setUnit, cycle, pw }}>
      {children}
    </PowerUnitContext.Provider>
  );
}

export function usePowerUnit(): PowerUnitContextValue {
  const ctx = useContext(PowerUnitContext);
  if (!ctx) throw new Error('usePowerUnit must be used within a PowerUnitProvider');
  return ctx;
}
