import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

type Period = 'day' | 'month' | 'year';

// home: prefer homeConsumptionEnergyToday (stored by mapper since recent fix),
// fall back to energy-balance formula for older history rows where reg 171 was 0
// and homeConsumptionEnergyToday was not yet computed by the mapper.
const DAILY_SQL = `
  SELECT
    strftime('%Y-%m-%d', createdAt) AS period,
    ROUND(MAX(CAST(json_extract(data, '$.pvEnergyToday') AS REAL)), 2) AS solar,
    ROUND(MAX(
      CASE
        WHEN CAST(json_extract(data, '$.homeConsumptionEnergyToday') AS REAL) > 0
          THEN CAST(json_extract(data, '$.homeConsumptionEnergyToday') AS REAL)
        WHEN CAST(json_extract(data, '$.loadEnergyToday') AS REAL) > 0
          THEN CAST(json_extract(data, '$.loadEnergyToday') AS REAL)
        ELSE
          COALESCE(CAST(json_extract(data, '$.pvEnergyToday')               AS REAL), 0) +
          COALESCE(CAST(json_extract(data, '$.importEnergyToday')            AS REAL), 0) +
          COALESCE(CAST(json_extract(data, '$.batteryDischargeEnergyToday')  AS REAL), 0) -
          COALESCE(CAST(json_extract(data, '$.exportEnergyToday')            AS REAL), 0) -
          COALESCE(CAST(json_extract(data, '$.batteryChargeEnergyToday')     AS REAL), 0)
      END
    ), 2) AS home,
    ROUND(MAX(CAST(json_extract(data, '$.batteryChargeEnergyToday')    AS REAL)), 2) AS batCharge,
    ROUND(MAX(CAST(json_extract(data, '$.batteryDischargeEnergyToday') AS REAL)), 2) AS batDischarge,
    ROUND(MAX(CAST(json_extract(data, '$.importEnergyToday')           AS REAL)), 2) AS gridImport
  FROM history
  WHERE deviceSn = ? AND createdAt >= ? AND createdAt <= ?
  GROUP BY strftime('%Y-%m-%d', createdAt)
  ORDER BY period
`;

function dateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  let from: Date;
  if (period === 'year') {
    from = new Date(now.getFullYear() - 4, 0, 1);
  } else if (period === 'month') {
    from = new Date(now.getFullYear(), 0, 1);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function groupByMonth(rows: any[]) {
  const map = new Map<string, any>();
  for (const r of rows) {
    const key = r.period.slice(0, 7) + '-01';
    if (!map.has(key)) {
      map.set(key, { period: key, solar: 0, home: 0, batCharge: 0, batDischarge: 0, gridImport: 0 });
    }
    const acc = map.get(key)!;
    acc.solar       += r.solar       ?? 0;
    acc.home        += r.home        ?? 0;
    acc.batCharge   += r.batCharge   ?? 0;
    acc.batDischarge+= r.batDischarge?? 0;
    acc.gridImport  += r.gridImport  ?? 0;
  }
  return [...map.values()].map(r => ({
    ...r,
    solar:        Math.round(r.solar        * 100) / 100,
    home:         Math.round(r.home         * 100) / 100,
    batCharge:    Math.round(r.batCharge    * 100) / 100,
    batDischarge: Math.round(r.batDischarge * 100) / 100,
    gridImport:   Math.round(r.gridImport   * 100) / 100,
  }));
}

function groupByYear(rows: any[]) {
  const map = new Map<string, any>();
  for (const r of rows) {
    const key = r.period.slice(0, 4) + '-01-01';
    if (!map.has(key)) {
      map.set(key, { period: key, solar: 0, home: 0, batCharge: 0, batDischarge: 0, gridImport: 0 });
    }
    const acc = map.get(key)!;
    acc.solar       += r.solar       ?? 0;
    acc.home        += r.home        ?? 0;
    acc.batCharge   += r.batCharge   ?? 0;
    acc.batDischarge+= r.batDischarge?? 0;
    acc.gridImport  += r.gridImport  ?? 0;
  }
  return [...map.values()].map(r => ({
    ...r,
    solar:        Math.round(r.solar        * 100) / 100,
    home:         Math.round(r.home         * 100) / 100,
    batCharge:    Math.round(r.batCharge    * 100) / 100,
    batDischarge: Math.round(r.batDischarge * 100) / 100,
    gridImport:   Math.round(r.gridImport   * 100) / 100,
  }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceSn = searchParams.get('deviceSn');
  const period   = (searchParams.get('period') ?? 'month') as Period;

  if (!deviceSn) return NextResponse.json({ error: 'Missing deviceSn' }, { status: 400 });

  try {
    const { from, to } = dateRange(period);
    const daily = db.prepare(DAILY_SQL).all(deviceSn, from, to) as any[];

    let rows: any[];
    if (period === 'year') {
      rows = groupByYear(daily);
    } else if (period === 'month') {
      rows = groupByMonth(daily);
    } else {
      rows = daily;
    }

    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
