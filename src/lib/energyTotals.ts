// ── All-time energy totals ──
//
// The inverter only exposes daily-reset "today" counters (pvEnergyToday, …); there
// is no lifetime register. To show an all-time column without re-scanning the whole
// `history` table on every request, we freeze each fully-elapsed day into
// `daily_energy` (the same "close the period once" pattern as monthly_savings, but
// for raw energy and independent of pricing). The all-time total is then:
//
//   SUM(frozen days)  +  today's live counters (from latest_<sn>)  +  manual PV
//
// Only the first day boundary advances each call, so the expensive GROUP BY only
// ever touches rows newer than the last frozen day (normally just today).

import db from './db';

export interface EnergyTotals {
  pv: number;
  home: number;
  batCharge: number;
  batDischarge: number;
  gridImport: number;
  gridExport: number;
  selfSufficiency: number;   // %, derived from real history only (excludes manual PV)
}

// Per-day end-of-day value of each counter. The `home` CASE mirrors the trend
// route exactly so the all-time column agrees with the trend chart: prefer the
// stored homeConsumptionEnergyToday, then loadEnergyToday, else the energy-balance
// fallback for old rows where neither was populated.
const DAY_AGG_SQL = `
  SELECT
    strftime('%Y-%m-%d', createdAt) AS day,
    ROUND(MAX(CAST(json_extract(data, '$.pvEnergyToday') AS REAL)), 3) AS pv,
    ROUND(MAX(
      CASE
        WHEN CAST(json_extract(data, '$.homeConsumptionEnergyToday') AS REAL) > 0
          THEN CAST(json_extract(data, '$.homeConsumptionEnergyToday') AS REAL)
        WHEN CAST(json_extract(data, '$.loadEnergyToday') AS REAL) > 0
          THEN CAST(json_extract(data, '$.loadEnergyToday') AS REAL)
        ELSE
          COALESCE(CAST(json_extract(data, '$.pvEnergyToday')              AS REAL), 0) +
          COALESCE(CAST(json_extract(data, '$.importEnergyToday')           AS REAL), 0) +
          COALESCE(CAST(json_extract(data, '$.batteryDischargeEnergyToday') AS REAL), 0) -
          COALESCE(CAST(json_extract(data, '$.exportEnergyToday')           AS REAL), 0) -
          COALESCE(CAST(json_extract(data, '$.batteryChargeEnergyToday')    AS REAL), 0)
      END
    ), 3) AS home,
    ROUND(MAX(CAST(json_extract(data, '$.batteryChargeEnergyToday')    AS REAL)), 3) AS batCharge,
    ROUND(MAX(CAST(json_extract(data, '$.batteryDischargeEnergyToday') AS REAL)), 3) AS batDischarge,
    ROUND(MAX(CAST(json_extract(data, '$.importEnergyToday')           AS REAL)), 3) AS gridImport,
    ROUND(MAX(CAST(json_extract(data, '$.exportEnergyToday')           AS REAL)), 3) AS gridExport
  FROM history
  WHERE deviceSn = ? AND createdAt >= ? AND createdAt < ?
  GROUP BY strftime('%Y-%m-%d', createdAt)
`;

// Start of *today in server-local time*, expressed as a UTC ISO string. The
// inverter's "today" counters reset at local midnight (the app assumes the server
// runs in the user's timezone), so the freeze cutoff must track local midnight —
// NOT UTC midnight, which lags by the tz offset (7h for GMT+7) and would leave
// yesterday unfrozen, hence missing from the total, for those hours each morning.
//
// The day labels stay UTC (plain strftime): because the counter resets at local
// midnight, each local day's peak falls inside the same-numbered UTC day, so the
// UTC-grouped MAX and label both already match the local day. Grouping by
// 'localtime' would instead double-shift and pick the wrong day's peak.
function localDayStartUTC(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

// Today's local calendar date 'YYYY-MM-DD' (matches the UTC-grouped day labels).
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Freeze every fully-elapsed day not yet in daily_energy. Incremental: only rows
// from the last frozen day onward are scanned (re-aggregating that one day is a
// no-op under INSERT OR IGNORE). First run on an existing DB freezes all history
// once; every later call touches just today's rows.
export function finalizeClosedDays(deviceSn: string): void {
  const lastRow = db.prepare(
    'SELECT MAX(day) AS day FROM daily_energy WHERE deviceSn = ?',
  ).get(deviceSn) as { day: string | null } | undefined;

  const lower = lastRow?.day ? `${lastRow.day}T00:00:00.000Z` : '0000-01-01T00:00:00.000Z';
  const upper = localDayStartUTC();

  const rows = db.prepare(DAY_AGG_SQL).all(deviceSn, lower, upper) as Array<{
    day: string; pv: number | null; home: number | null; batCharge: number | null;
    batDischarge: number | null; gridImport: number | null; gridExport: number | null;
  }>;

  const ins = db.prepare(
    `INSERT OR IGNORE INTO daily_energy
       (deviceSn, day, pv, home, batCharge, batDischarge, gridImport, gridExport)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((list: typeof rows) => {
    for (const r of list) {
      ins.run(
        deviceSn, r.day,
        r.pv ?? 0, r.home ?? 0, r.batCharge ?? 0,
        r.batDischarge ?? 0, r.gridImport ?? 0, r.gridExport ?? 0,
      );
    }
  });
  tx(rows);
}

// Today's live "today" counters from the latest poll snapshot.
function latestMetrics(deviceSn: string): any {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(`latest_${deviceSn}`) as { value: string } | undefined;
  if (!row) return {};
  try { return JSON.parse(row.value)?.metrics ?? {}; } catch { return {}; }
}

// Manually-entered daily PV (kWh), validated like the trend route does.
function manualSolar(): { date: string; kwh: number }[] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get('deviceConfig') as { value: string } | undefined;
  if (!row) return [];
  try {
    const cfg = JSON.parse(row.value);
    if (!Array.isArray(cfg?.manualSolar)) return [];
    return cfg.manualSolar
      .map((e: any) => ({ date: String(e?.date ?? ''), kwh: Number(e?.kwh) }))
      .filter((e: { date: string; kwh: number }) =>
        /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(e.kwh) && e.kwh > 0);
  } catch {
    return [];
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function getAllTimeTotals(deviceSn: string): EnergyTotals {
  finalizeClosedDays(deviceSn);

  const frozen = db.prepare(
    `SELECT day, pv, home, batCharge, batDischarge, gridImport, gridExport
     FROM daily_energy WHERE deviceSn = ?`,
  ).all(deviceSn) as Array<{
    day: string; pv: number; home: number; batCharge: number;
    batDischarge: number; gridImport: number; gridExport: number;
  }>;

  let pv = 0, home = 0, batCharge = 0, batDischarge = 0, gridImport = 0, gridExport = 0;
  const frozenDays = new Set<string>();
  for (const r of frozen) {
    pv += r.pv; home += r.home; batCharge += r.batCharge;
    batDischarge += r.batDischarge; gridImport += r.gridImport; gridExport += r.gridExport;
    frozenDays.add(r.day);
  }

  // Today's live contribution (not yet frozen). home uses the same preference
  // order as the daily aggregate.
  const m = latestMetrics(deviceSn);
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const todayPv = num(m.pvEnergyToday);
  const todayHome = num(m.homeConsumptionEnergyToday) > 0
    ? num(m.homeConsumptionEnergyToday)
    : num(m.loadEnergyToday) > 0
      ? num(m.loadEnergyToday)
      : Math.max(0, todayPv + num(m.importEnergyToday) + num(m.batteryDischargeEnergyToday)
          - num(m.exportEnergyToday) - num(m.batteryChargeEnergyToday));
  const todayImport = num(m.importEnergyToday);

  pv += todayPv;
  home += todayHome;
  batCharge += num(m.batteryChargeEnergyToday);
  batDischarge += num(m.batteryDischargeEnergyToday);
  gridImport += todayImport;
  gridExport += num(m.exportEnergyToday);

  // Self-sufficiency from real history only (frozen + today). Manual days carry PV
  // but no home reading, so folding them in would inflate the ratio — excluded.
  const realImport = gridImport;
  const selfSufficiency = home > 0
    ? Math.max(0, Math.min(100, (1 - realImport / home) * 100))
    : 0;

  // Fold manual PV into the PV column only, for days neither frozen nor today
  // (today is already counted live). Logged days always win.
  const todayLabel = localToday();
  for (const e of manualSolar()) {
    if (e.date === todayLabel || frozenDays.has(e.date)) continue;
    pv += e.kwh;
  }

  return {
    pv: round2(pv),
    home: round2(home),
    batCharge: round2(batCharge),
    batDischarge: round2(batDischarge),
    gridImport: round2(gridImport),
    gridExport: round2(gridExport),
    selfSufficiency: Math.round(selfSufficiency),
  };
}
