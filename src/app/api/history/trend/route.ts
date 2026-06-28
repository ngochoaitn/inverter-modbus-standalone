import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getDailyEnergyRows } from '@/lib/energyTotals';

type Period = 'day' | 'week' | 'month' | 'year';

// Manually-entered daily PV (kWh) saved on deviceConfig by /api/setup. Already
// deduped/sorted there; we just validate defensively.
function getManualSolar(): { date: string; kwh: number }[] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('deviceConfig') as
    | { value: string } | undefined;
  if (!row) return [];
  try {
    const cfg = JSON.parse(row.value);
    if (!Array.isArray(cfg?.manualSolar)) return [];
    return cfg.manualSolar
      .map((e: any) => ({ date: String(e?.date ?? ''), kwh: Number(e?.kwh) }))
      .filter((e: { date: string; kwh: number }) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(e.kwh) && e.kwh > 0);
  } catch {
    return [];
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round2 = (v: number) => Math.round(v * 100) / 100;

// Monday-anchored start of the week containing d (local time). Week starts Monday.
function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (r.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat → days since Monday
  r.setDate(r.getDate() - back);
  return r;
}

// Inclusive day-string bounds for each period, in local calendar dates (matching
// the daily_energy day labels). 'day' → current month, 'week' → current week
// (Monday→today), 'month' → current year, 'year' → last 5 calendar years.
function dateRange(period: Period): { fromDay: string; toDay: string } {
  const now = new Date();
  let from: Date;
  if (period === 'year') {
    from = new Date(now.getFullYear() - 4, 0, 1);
  } else if (period === 'month') {
    from = new Date(now.getFullYear(), 0, 1);
  } else if (period === 'week') {
    from = mondayOf(now);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { fromDay: ymd(from), toDay: ymd(now) };
}

interface Row {
  period: string; solar: number; home: number;
  batCharge: number; batDischarge: number; gridImport: number;
}

const emptyAcc = (period: string): Row =>
  ({ period, solar: 0, home: 0, batCharge: 0, batDischarge: 0, gridImport: 0 });

// Sum daily rows into buckets keyed by `keyOf(row.period)`; the bucket's period is
// that key. Shared by week/month/year grouping.
function groupBy(rows: Row[], keyOf: (period: string) => string): Row[] {
  const map = new Map<string, Row>();
  for (const r of rows) {
    const key = keyOf(r.period);
    if (!map.has(key)) map.set(key, emptyAcc(key));
    const acc = map.get(key)!;
    acc.solar        += r.solar        ?? 0;
    acc.home         += r.home         ?? 0;
    acc.batCharge    += r.batCharge    ?? 0;
    acc.batDischarge += r.batDischarge ?? 0;
    acc.gridImport   += r.gridImport   ?? 0;
  }
  return [...map.values()].map(r => ({
    period:       r.period,
    solar:        round2(r.solar),
    home:         round2(r.home),
    batCharge:    round2(r.batCharge),
    batDischarge: round2(r.batDischarge),
    gridImport:   round2(r.gridImport),
  }));
}

const monthKeyOf = (period: string) => period.slice(0, 7) + '-01';
const yearKeyOf  = (period: string) => period.slice(0, 4) + '-01-01';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceSn = searchParams.get('deviceSn');
  const period   = (searchParams.get('period') ?? 'month') as Period;

  if (!deviceSn) return NextResponse.json({ error: 'Missing deviceSn' }, { status: 400 });

  try {
    const { fromDay, toDay } = dateRange(period);

    // Per-day figures come from the frozen daily_energy rollup (+ today live),
    // never a full history scan. Same 5 series the chart renders.
    const daily: Row[] = getDailyEnergyRows(deviceSn)
      .filter(r => r.day >= fromDay && r.day <= toDay)
      .map(r => ({
        period: r.day,
        solar: round2(r.pv), home: round2(r.home),
        batCharge: round2(r.batCharge), batDischarge: round2(r.batDischarge),
        gridImport: round2(r.gridImport),
      }));

    // Fold in manually-entered daily PV (kWh) for days not logged yet, so the
    // chart agrees with the savings card. Logged days win on conflict.
    const dailyByPeriod = new Map<string, Row>(daily.map(r => [r.period, r]));
    for (const m of getManualSolar()) {
      if (m.date < fromDay || m.date > toDay || dailyByPeriod.has(m.date)) continue;
      dailyByPeriod.set(m.date, { ...emptyAcc(m.date), solar: m.kwh });
    }
    const merged = [...dailyByPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));

    // 'day' and 'week' render one bar per day (no grouping); only month/year roll up.
    let rows: Row[];
    if (period === 'year')       rows = groupBy(merged, yearKeyOf);
    else if (period === 'month') rows = groupBy(merged, monthKeyOf);
    else                         rows = merged;

    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
