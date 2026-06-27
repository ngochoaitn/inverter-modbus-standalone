// ── Savings computation + monthly snapshot ("chốt sổ") ──
//
// The value of produced solar is billed monthly, so each fully-elapsed month is
// frozen into `monthly_savings` with the tariff/VAT then in effect. Closed months
// read from the snapshot; the current month is always recomputed live. This file
// is the single source of truth for the math, shared by the read API and the
// finalize step so the two can never drift.

import db from './db';
import { normalizePricing, tieredValue, touEffectiveRate, type PricingConfig } from './pricing';

const DAILY_SOLAR_SQL = `
  SELECT
    strftime('%Y-%m-%d', createdAt) AS day,
    ROUND(MAX(CAST(json_extract(data, '$.pvEnergyToday') AS REAL)), 3) AS solar
  FROM history
  WHERE deviceSn = ?
  GROUP BY strftime('%Y-%m-%d', createdAt)
  HAVING solar > 0
  ORDER BY day
`;

export interface DayPoint { day: string; solar: number; }
export interface MonthValue { kwh: number; savings: number; }
export interface Snapshot extends MonthValue { ym: string; vatPercent: number; closedAt: string; }

// Current 'YYYY-MM' in server-local time (consistent with the rest of the app).
export function currentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function manualToMap(manualSolar: any): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of Array.isArray(manualSolar) ? manualSolar : []) {
    const kwh = Number(m?.kwh);
    if (typeof m?.date === 'string' && Number.isFinite(kwh) && kwh > 0) map.set(m.date, kwh);
  }
  return map;
}

// DB daily production merged with manual gap-fill entries (real readings win),
// sorted ascending by day.
export function getMergedDays(deviceSn: string, manualSolar: any): DayPoint[] {
  const dbDays = db.prepare(DAILY_SOLAR_SQL).all(deviceSn) as DayPoint[];
  const map = manualToMap(manualSolar);
  for (const d of dbDays) map.set(d.day, Number(d.solar) || 0);
  return [...map.entries()].map(([day, solar]) => ({ day, solar })).sort((a, b) => a.day.localeCompare(b.day));
}

export function groupByMonth(days: DayPoint[]): Map<string, DayPoint[]> {
  const out = new Map<string, DayPoint[]>();
  for (const d of days) {
    const ym = d.day.slice(0, 7);
    (out.get(ym) ?? out.set(ym, []).get(ym)!).push(d);
  }
  return out;
}

// Value one month's days with the given tariff + VAT. Tiered accumulates within
// the month; TOU is per-day. `todayKey` optionally returns that day's marginal
// contribution (used for the live "today" figure). All amounts are VAT-inclusive.
export function computeMonthSavings(
  monthDays: DayPoint[], pricing: PricingConfig, vatPercent: number, todayKey?: string,
): MonthValue & { todayValue: number } {
  const vatMul = 1 + (Number.isFinite(vatPercent) ? vatPercent : 8) / 100;
  const touRate = pricing.type === 'tou' ? touEffectiveRate(pricing.tou) : 0;
  let before = 0, savings = 0, kwh = 0, todayValue = 0;
  for (const d of monthDays) {
    const solar = Number(d.solar) || 0;
    if (solar <= 0) continue;
    const v = (pricing.type === 'tou' ? solar * touRate : tieredValue(before, solar, pricing.tiers)) * vatMul;
    before += solar; kwh += solar; savings += v;
    if (todayKey && d.day === todayKey) todayValue = v;
  }
  return { kwh, savings, todayValue };
}

export function getSnapshots(deviceSn: string): Map<string, Snapshot> {
  const rows = db.prepare(
    'SELECT ym, kwh, savings, vatPercent, closedAt FROM monthly_savings WHERE deviceSn = ?',
  ).all(deviceSn) as Snapshot[];
  return new Map(rows.map(r => [r.ym, r]));
}

// Freeze every fully-elapsed month (ym < current) that has production and is not
// yet snapshotted, using the supplied tariff/VAT. INSERT OR IGNORE guarantees an
// existing snapshot is never overwritten — that is what makes closed months
// immune to later tariff changes. No-op when pricing is missing.
export function finalizeClosedMonths(
  deviceSn: string, manualSolar: any, pricing: PricingConfig | null, vatPercent: number,
): void {
  if (!pricing) return;
  const cur = currentYm();
  const byMonth = groupByMonth(getMergedDays(deviceSn, manualSolar));
  const existing = getSnapshots(deviceSn);
  const closedAt = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO monthly_savings (deviceSn, ym, kwh, savings, vatPercent, pricingJson, closedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [ym, mdays] of byMonth) {
    if (ym >= cur || existing.has(ym)) continue;
    const { kwh, savings } = computeMonthSavings(mdays, pricing, vatPercent);
    if (kwh <= 0) continue;
    ins.run(deviceSn, ym, kwh, Math.round(savings), vatPercent, JSON.stringify(pricing), closedAt);
  }
}

// Delete snapshots for elapsed months whose manual gap-fill data changed, so they
// recompute (and re-close) on the next finalize. Lets corrections to past days
// flow through even after a month was closed.
export function reopenMonthsWithChangedManual(deviceSn: string, oldManual: any, newManual: any): void {
  const a = manualToMap(oldManual), b = manualToMap(newManual);
  const cur = currentYm();
  const changed = new Set<string>();
  for (const date of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(date) !== b.get(date)) changed.add(date.slice(0, 7));
  }
  const del = db.prepare('DELETE FROM monthly_savings WHERE deviceSn = ? AND ym = ?');
  for (const ym of changed) if (ym < cur) del.run(deviceSn, ym);
}

// Convenience: normalize a stored config's pricing, or null when unset.
export function pricingOf(cfg: any): PricingConfig | null {
  return cfg?.pricing ? normalizePricing(cfg.pricing) : null;
}
export function vatOf(cfg: any): number {
  return Number.isFinite(Number(cfg?.vatPercent)) ? Number(cfg.vatPercent) : 8;
}
