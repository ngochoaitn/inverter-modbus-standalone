import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  computeMonthSavings, finalizeClosedMonths, getMergedDays, getSnapshots,
  groupByMonth, currentYm, pricingOf, vatOf, valueBreakdown, type MonthValue,
} from '@/lib/savings';

// Local "today" key, consistent with the rest of the app which assumes the server
// runs in the user's timezone (Lux Local).
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

  if (!cfg?.pricing) return NextResponse.json({ configured: false });

  const pricing = pricingOf(cfg)!;
  const vatPercent = vatOf(cfg);

  try {
    // Lazily freeze any fully-elapsed month at the current tariff before reading.
    finalizeClosedMonths(deviceSn, cfg.manualSolar, pricing, vatPercent);

    const days = getMergedDays(deviceSn, cfg.manualSolar);
    const byMonth = groupByMonth(days);
    const snapshots = getSnapshots(deviceSn);
    const cur = currentYm();
    const tKey = todayKey();

    // Resolve each month: closed → snapshot (frozen); otherwise compute live.
    const monthly = new Map<string, MonthValue>();
    let todayValue = 0;
    for (const [ym, mdays] of byMonth) {
      const snap = snapshots.get(ym);
      if (ym < cur && snap) {
        monthly.set(ym, { kwh: snap.kwh, savings: snap.savings });
      } else {
        const live = computeMonthSavings(mdays, pricing, vatPercent, ym === cur ? tKey : undefined);
        monthly.set(ym, { kwh: live.kwh, savings: live.savings });
        if (ym === cur) todayValue = live.todayValue;
      }
    }

    const savingsOf = (ym: string) => monthly.get(ym)?.savings ?? 0;
    const total = [...monthly.values()].reduce((s, m) => s + m.savings, 0);
    const firstDay = days[0]?.day ?? null;

    // Calculation breakdowns for the two live headline figures (today / month).
    const curDays = byMonth.get(cur) ?? [];
    let beforeToday = 0, todaySolar = 0, monthKwh = 0;
    for (const d of curDays) {
      const s = Number(d.solar) || 0;
      monthKwh += s;
      if (d.day < tKey) beforeToday += s;
      else if (d.day === tKey) todaySolar = s;
    }
    const todayBreakdown = valueBreakdown(pricing, vatPercent, beforeToday, todaySolar);
    const monthBreakdown = valueBreakdown(pricing, vatPercent, 0, monthKwh);

    // 12-month series for the requested year (T1..T12), flagged closed for the lock icon.
    const series = Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { month: i + 1, savings: Math.round(savingsOf(ym)), closed: snapshots.has(ym) };
    });

    // ROI from the manually-entered system cost + install date.
    const investmentCost = Number(cfg.investmentCost) || 0;
    const installDate: string | undefined = cfg.installDate || firstDay || undefined;
    let roi: any = null;
    if (investmentCost > 0) {
      const percent = Math.min(100, Math.round((total / investmentCost) * 100));
      const remaining = Math.max(0, investmentCost - total);

      // Project payback from the run-rate over *complete* months (drop the
      // in-progress month, and the install month if it came online mid-month).
      const installMonth = installDate ? installDate.slice(0, 7) : null;
      const installMidMonth = !!installDate && installDate.slice(8, 10) !== '01' && installDate.slice(8, 10) !== '';
      const completeMonths = [...monthly.entries()]
        .filter(([ym]) => ym < cur && !(installMidMonth && ym === installMonth))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, m]) => m.savings);

      let daysRemaining: number | null = null;
      let basis: 'trailing12' | 'monthlyAvg' | 'dailyAvg' = 'dailyAvg';
      let ratePerMonth: number | null = null;   // đ/month used for the projection
      let ratePerDay: number | null = null;     // đ/day (fallback basis)
      let monthsUsed = 0;                        // how many complete months averaged
      let elapsedDays = 0;
      if (completeMonths.length >= 12) {
        const last12 = completeMonths.slice(-12).reduce((s, v) => s + v, 0);
        const perMonth = last12 / 12;
        if (perMonth > 0) { daysRemaining = Math.round((remaining / perMonth) * 30.44); basis = 'trailing12'; ratePerMonth = perMonth; monthsUsed = 12; }
      } else if (completeMonths.length >= 1) {
        const perMonth = completeMonths.reduce((s, v) => s + v, 0) / completeMonths.length;
        if (perMonth > 0) { daysRemaining = Math.round((remaining / perMonth) * 30.44); basis = 'monthlyAvg'; ratePerMonth = perMonth; monthsUsed = completeMonths.length; }
      }
      if (daysRemaining == null) {
        elapsedDays = installDate
          ? Math.max(1, Math.round((Date.now() - new Date(installDate).getTime()) / 86_400_000))
          : Math.max(1, days.length);
        const avgPerDay = total / elapsedDays;
        ratePerDay = avgPerDay;
        daysRemaining = avgPerDay > 0 ? Math.round(remaining / avgPerDay) : null;
      }

      roi = {
        investmentCost, installDate: installDate ?? null, percent, daysRemaining, basis,
        total, remaining, ratePerMonth, ratePerDay, monthsUsed, elapsedDays,
      };
    }

    return NextResponse.json({
      configured: true,
      currency: 'đ',
      vatPercent,
      today: Math.round(todayValue),
      month: Math.round(savingsOf(cur)),
      total: Math.round(total),
      todayBreakdown,
      monthBreakdown,
      year,
      series,
      roi,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
