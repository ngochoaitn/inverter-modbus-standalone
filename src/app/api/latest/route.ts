import { NextResponse } from 'next/server';
import db from '@/lib/db';

// Flat, Home-Assistant-friendly snapshot of the active device's latest reading.
// HA maps each field to one sensor; fields that aren't available are omitted
// (so HA simply won't create a sensor for them) rather than sent as null.
//
//   GET /api/latest
//   {
//     "deviceSn": "61504F2241",
//     "state": "Normal",  // inverter state text
//     "soc": 49,          // %
//     "soh": 100,         // % state-of-health
//     "pvW": 882,         // W, PV production
//     "loadW": 518,       // W, house load
//     "battW": -120,      // W, +discharging / -charging
//     "gridW": 0,         // W, +export / -import
//     "batTempC": 29,     // °C
//     "battV": 51.2,      // V
//     "gridV": 230.1,     // V
//     "gridHz": 50.0,     // Hz
//     // Cumulative energy today (kWh, resets at midnight → HA state_class:
//     // total_increasing). NOT rounded — these are decimals.
//     "pvKwhToday": 5.3,
//     "gridImportKwhToday": 1.2,
//     "gridExportKwhToday": 0.4,
//     "battChargeKwhToday": 2.1,
//     "battDischargeKwhToday": 1.8,
//     "loadKwhToday": 6.7,
//     "lastSeenAt": 1752000000  // unix seconds
//   }
export async function GET() {
  try {
    const activeSnRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('activeDeviceSn') as
      | { value: string }
      | undefined;
    const activeSn = activeSnRow?.value;
    if (!activeSn) {
      return NextResponse.json({ error: 'no active device' }, { status: 404 });
    }

    const latestRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`latest_${activeSn}`) as
      | { value: string }
      | undefined;
    if (!latestRow) {
      return NextResponse.json({ error: 'no reading yet' }, { status: 404 });
    }

    const data = JSON.parse(latestRow.value) as {
      deviceSn: string;
      lastSeenAt: string;
      metrics: Record<string, number | string | undefined>;
    };
    const m = data.metrics ?? {};

    // Only emit a field when it carries a real value. `digits` sets decimal
    // precision: 0 (default) for powers/SOC/temps — HA doesn't need sub-watt noise —
    // and 1–2 for voltage/frequency/energy so their decimals survive intact.
    // Rounding also strips ×0.1 float artefacts (e.g. 0.30000000000000004 → 0.3).
    const out: Record<string, number | string> = { deviceSn: data.deviceSn };
    const put = (key: string, value: number | undefined, digits = 0) => {
      if (value == null || Number.isNaN(value)) return;
      const f = 10 ** digits;
      out[key] = Math.round(value * f) / f;
    };

    // Inverter state text (e.g. "Normal", "Off-Grid", "Grid Charging").
    if (typeof m.inverterState === 'string') out.state = m.inverterState;

    // Instantaneous power / SOC / temperature — whole numbers are fine.
    put('soc', m.batterySoc as number | undefined);
    put('soh', m.batterySoh as number | undefined);
    put('pvW', m.pvPower as number | undefined);
    put('loadW', m.loadPower as number | undefined);
    put('battW', m.batteryFlow as number | undefined);   // + discharging, - charging
    put('gridW', m.gridFlow as number | undefined);      // + export,      - import
    put('batTempC', m.batteryTemperature as number | undefined);

    // Voltages / frequency — keep the decimal (1 dp; frequency 2 dp).
    put('battV', m.batteryVoltage as number | undefined, 1);
    put('gridV', m.gridVoltage as number | undefined, 1);
    put('gridHz', m.gridFrequency as number | undefined, 2);

    // Cumulative energy today (kWh, ×0.1 decimals → 1 dp). MUST keep the decimal,
    // otherwise 5.3 kWh collapses to 5 and the HA total_increasing sensor breaks.
    put('pvKwhToday', m.pvEnergyToday as number | undefined, 1);
    put('gridImportKwhToday', m.importEnergyToday as number | undefined, 1);
    put('gridExportKwhToday', m.exportEnergyToday as number | undefined, 1);
    put('battChargeKwhToday', m.batteryChargeEnergyToday as number | undefined, 1);
    put('battDischargeKwhToday', m.batteryDischargeEnergyToday as number | undefined, 1);
    put('loadKwhToday', m.loadEnergyToday as number | undefined, 1);

    if (data.lastSeenAt) {
      const ts = Math.floor(new Date(data.lastSeenAt).getTime() / 1000);
      if (!Number.isNaN(ts)) out.lastSeenAt = ts;
    }

    return NextResponse.json(out);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
