import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { normalizePricing, tieredValue, touEffectiveRate } from '@/lib/pricing';

// Daily solar production (kWh) — pvEnergyToday is a per-day accumulator, so MAX
// over the day's rows is that day's total. Mirrors the trend route's approach.
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

// Local "today" / "this month" keys, consistent with the rest of the app which
// assumes the server runs in the user's timezone (Lux Local).
function localKeys() {
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { today: ymd, month: ymd.slice(0, 7) };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceSn = searchParams.get('deviceSn');
  const year = Number(searchParams.get('year')) || new Date().getFullYear();

  if (!deviceSn) return NextResponse.json({ error: 'Missing deviceSn' }, { status: 400 });

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('deviceConfig') as
    | { value: string } | undefined;
  let cfg: any = {};
  try { cfg = row ? JSON.parse(row.value) : {}; } catch { cfg = {}; }

  if (!cfg?.pricing) {
    return NextResponse.json({ configured: false });
  }

  const pricing = normalizePricing(cfg.pricing);
  const touRate = pricing.type === 'tou' ? touEffectiveRate(pricing.tou) : 0;

  // Value one day's production given how much the system already produced earlier
  // in the same calendar month (only matters for the tiered ladder).
  const valueDay = (solar: number, monthBefore: number): number =>
    pricing.type === 'tou' ? solar * touRate : tieredValue(monthBefore, solar, pricing.tiers);

  try {
    const days = db.prepare(DAILY_SOLAR_SQL).all(deviceSn) as { day: string; solar: number }[];

    const { today, month } = localKeys();
    const monthAccum = new Map<string, number>(); // 'YYYY-MM' → kWh so far this month
    const monthly = new Map<string, number>();     // 'YYYY-MM' → savings (đ)
    let total = 0;
    let todayValue = 0;
    let firstDay: string | null = null;

    for (const d of days) {
      const solar = Number(d.solar) || 0;
      if (solar <= 0) continue;
      if (!firstDay) firstDay = d.day;
      const mk = d.day.slice(0, 7);
      const before = monthAccum.get(mk) ?? 0;
      const v = valueDay(solar, before);
      monthAccum.set(mk, before + solar);
      monthly.set(mk, (monthly.get(mk) ?? 0) + v);
      total += v;
      if (d.day === today) todayValue = v;
    }

    // 12-month series for the requested year (T1..T12).
    const series = Array.from({ length: 12 }, (_, i) => {
      const mk = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { month: i + 1, savings: Math.round(monthly.get(mk) ?? 0) };
    });

    // ROI from the manually-entered system cost + install date.
    const investmentCost = Number(cfg.investmentCost) || 0;
    const installDate: string | undefined = cfg.installDate || firstDay || undefined;
    let roi: any = null;
    if (investmentCost > 0) {
      const elapsedDays = installDate
        ? Math.max(1, Math.round((Date.now() - new Date(installDate).getTime()) / 86_400_000))
        : Math.max(1, days.length);
      const avgPerDay = total / elapsedDays;
      const percent = Math.min(100, Math.round((total / investmentCost) * 100));
      const remaining = Math.max(0, investmentCost - total);
      const daysRemaining = avgPerDay > 0 ? Math.round(remaining / avgPerDay) : null;
      roi = { investmentCost, installDate: installDate ?? null, percent, daysRemaining };
    }

    return NextResponse.json({
      configured: true,
      currency: 'đ',
      today: Math.round(todayValue),
      month: Math.round(monthly.get(month) ?? 0),
      total: Math.round(total),
      year,
      series,
      roi,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
