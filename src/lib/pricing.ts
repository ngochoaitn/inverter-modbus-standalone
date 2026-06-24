// ── Electricity pricing model ──────────────────────────
//
// Two mutually-exclusive tariff shapes, both used to value the solar energy the
// system *produces* (pvEnergyToday) — i.e. "how much money is this kWh worth at
// the grid price it displaces". No node-only deps here so the dashboard form can
// import the defaults/helpers too.

export type PricingType = 'tiered' | 'tou';

// Type 1 — bậc thang: cumulative monthly consumption tiers. `to` is the inclusive
// upper bound in kWh; the final tier uses `to: null` (∞). `from` is implicit
// (previous tier's `to`).
export interface Tier {
  to: number | null;
  price: number; // đ / kWh
}

// Type 2 — khung giờ: each band has a price and the hour ranges it covers.
// A range [start, end) may wrap past midnight (e.g. [17, 8] = 17:00→08:00).
export interface TouBand {
  key: 'low' | 'normal' | 'peak';
  price: number; // đ / kWh
  ranges: [number, number][];
}

export interface PricingConfig {
  type: PricingType;
  tiers: Tier[];
  tou: { bands: TouBand[] };
}

export const DEFAULT_PRICING: PricingConfig = {
  type: 'tiered',
  tiers: [
    { to: 50, price: 1984 },
    { to: 100, price: 2050 },
    { to: 200, price: 2380 },
    { to: 300, price: 2998 },
    { to: 400, price: 3350 },
    { to: null, price: 3460 },
  ],
  tou: {
    bands: [
      { key: 'low',    price: 1100, ranges: [[22, 4]] },
      { key: 'normal', price: 1800, ranges: [[4, 9], [11, 17], [20, 22]] },
      { key: 'peak',   price: 3200, ranges: [[9, 11], [17, 20]] },
    ],
  },
};

// Typical PV output share by hour of day (sums to ~1 across daylight hours). Used
// to blend the time-of-use rates into a single effective đ/kWh when we only have a
// daily production total (the "xấp xỉ theo ngày" approximation).
const SOLAR_HOUR_WEIGHTS: Record<number, number> = {
  6: 0.01, 7: 0.03, 8: 0.06, 9: 0.09, 10: 0.12, 11: 0.14,
  12: 0.15, 13: 0.14, 14: 0.11, 15: 0.08, 16: 0.04, 17: 0.02,
};

function hoursOfRange([start, end]: [number, number]): number[] {
  const out: number[] = [];
  let h = ((start % 24) + 24) % 24;
  const stop = ((end % 24) + 24) % 24;
  // Walk forward (wrapping) until we reach `stop`; a full-day range (start==end)
  // would loop 24 times which is the intended behaviour.
  for (let i = 0; i < 24; i++) {
    if (h === stop && i > 0) break;
    out.push(h);
    h = (h + 1) % 24;
    if (h === stop) break;
  }
  return out;
}

// Build an hour→price lookup (0..23) from the TOU bands; later bands override
// earlier ones on overlap. Hours with no band fall back to the cheapest rate.
function touHourRates(tou: { bands: TouBand[] }): Record<number, number> {
  const map: Record<number, number> = {};
  for (const band of tou.bands) {
    for (const range of band.ranges) {
      for (const h of hoursOfRange(range)) map[h] = band.price;
    }
  }
  const prices = tou.bands.map(b => b.price);
  const fallback = prices.length ? Math.min(...prices) : 0;
  for (let h = 0; h < 24; h++) if (map[h] == null) map[h] = fallback;
  return map;
}

// Blended đ/kWh: weight each daylight hour's TOU rate by the typical solar share.
export function touEffectiveRate(tou: { bands: TouBand[] }): number {
  const rates = touHourRates(tou);
  let num = 0;
  let den = 0;
  for (const [hStr, w] of Object.entries(SOLAR_HOUR_WEIGHTS)) {
    const h = Number(hStr);
    num += w * (rates[h] ?? 0);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

// Value `add` kWh given `before` kWh already counted this month, walking the
// cumulative tier ladder. Used so each day is valued at the marginal tier its
// production lands in within the calendar month.
export function tieredValue(before: number, add: number, tiers: Tier[]): number {
  if (add <= 0 || !tiers.length) return 0;
  let value = 0;
  let cursor = Math.max(0, before);
  let remaining = add;
  for (const tier of tiers) {
    const upper = tier.to == null ? Infinity : tier.to;
    if (cursor >= upper) continue;
    const take = Math.min(remaining, upper - cursor);
    value += take * tier.price;
    cursor += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  // Anything beyond the last finite tier (shouldn't happen if last is ∞) is
  // charged at the last tier's price.
  if (remaining > 0) value += remaining * tiers[tiers.length - 1].price;
  return value;
}

// Coerce arbitrary stored/posted JSON into a valid PricingConfig, filling gaps
// from the defaults so the calculator never sees a malformed shape.
export function normalizePricing(raw: any): PricingConfig {
  const type: PricingType = raw?.type === 'tou' ? 'tou' : 'tiered';
  const tiers: Tier[] = Array.isArray(raw?.tiers) && raw.tiers.length
    ? raw.tiers
        .map((t: any) => ({
          to: t?.to == null || t?.to === '' ? null : Number(t.to),
          price: Number(t?.price) || 0,
        }))
        .filter((t: Tier) => t.to == null || Number.isFinite(t.to))
    : DEFAULT_PRICING.tiers;
  // Ensure the ladder ends in an open-ended tier.
  if (tiers.length && tiers[tiers.length - 1].to != null) tiers.push({ to: null, price: tiers[tiers.length - 1].price });

  const rawBands = Array.isArray(raw?.tou?.bands) ? raw.tou.bands : DEFAULT_PRICING.tou.bands;
  const bands: TouBand[] = (['low', 'normal', 'peak'] as const).map((key) => {
    const found = rawBands.find((b: any) => b?.key === key);
    const def = DEFAULT_PRICING.tou.bands.find(b => b.key === key)!;
    const ranges: [number, number][] = Array.isArray(found?.ranges)
      ? found.ranges
          .map((r: any) => [Number(r?.[0]), Number(r?.[1])] as [number, number])
          .filter((r: [number, number]) => Number.isFinite(r[0]) && Number.isFinite(r[1]))
      : def.ranges;
    return { key, price: Number(found?.price) || def.price, ranges };
  });

  return { type, tiers, tou: { bands } };
}
