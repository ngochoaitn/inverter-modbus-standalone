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
// the daily_energy day labels). `offset` (≤ 0) steps back whole windows:
// 'day' → a calendar month, 'week' → a Monday-anchored week, 'month' → a calendar
// year, 'year' → a block of 5 calendar years. offset 0 is the current window,
// capped at today.
function dateRange(period: Period, offset: number): { fromDay: string; toDay: string } {
  const now = new Date();
  let from: Date, to: Date;
  if (period === 'year') {
    const endYear = now.getFullYear() + offset * 5;
    from = new Date(endYear - 4, 0, 1);
    to   = new Date(endYear, 11, 31);
  } else if (period === 'month') {
    const y = now.getFullYear() + offset;
    from = new Date(y, 0, 1);
    to   = new Date(y, 11, 31);
  } else if (period === 'week') {
    from = mondayOf(now);
    from.setDate(from.getDate() + offset * 7);
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  } else {
    from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    to   = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  }
  if (to > now) to = now;
  return { fromDay: ymd(from), toDay: ymd(to) };
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
  const offset   = Math.min(0, Math.trunc(Number(searchParams.get('offset')) || 0));

  if (!deviceSn) return NextResponse.json({ error: 'Missing deviceSn' }, { status: 400 });

  try {
    const { fromDay, toDay } = dateRange(period, offset);

    // Per-day figures come from the frozen daily_energy rollup (+ today live),
    // never a full history scan. Same 5 series the chart renders.
    const allDaily = getDailyEnergyRows(deviceSn);
    const manual   = getManualSolar();
    const daily: Row[] = allDaily
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
    for (const m of manual) {
      if (m.date < fromDay || m.date > toDay || dailyByPeriod.has(m.date)) continue;
      dailyByPeriod.set(m.date, { ...emptyAcc(m.date), solar: m.kwh });
    }
    const merged = [...dailyByPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));

    // 'day' and 'week' render one bar per day (no grouping); only month/year roll up.
    let rows: Row[];
    if (period === 'year')       rows = groupBy(merged, yearKeyOf);
    else if (period === 'month') rows = groupBy(merged, monthKeyOf);
    else                         rows = merged;

    // Window bounds + whether any data exists before it, for the chart's < > nav.
    // Sent as headers so the body stays the plain row array other clients expect.
    const hasPrev = allDaily.some(r => r.day < fromDay) || manual.some(m => m.date < fromDay);
    return NextResponse.json(rows, {
      headers: { 'X-Range-From': fromDay, 'X-Range-To': toDay, 'X-Has-Prev': hasPrev ? '1' : '0' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
