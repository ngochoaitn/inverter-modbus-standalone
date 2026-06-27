import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { normalizePricing } from '@/lib/pricing';

export async function GET() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('deviceConfig') as
    | { value: string }
    | undefined;

  if (!row) return NextResponse.json({ configured: false });

  try {
    const config = JSON.parse(row.value);
    return NextResponse.json({ configured: true, config });
  } catch {
    return NextResponse.json({ configured: false });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { deviceSn, dongleSn, inverterIp, inverterPort, pvRatedW, socFloorOnGrid, socFloorOffGrid, pricing, investmentCost, installDate, manualSolar, weatherLat, weatherLon, vatPercent } = body;

  if (!deviceSn?.trim() || !inverterIp?.trim()) {
    return NextResponse.json({ error: 'deviceSn and inverterIp are required' }, { status: 400 });
  }

  // Designed PV power per string (Wp). The inverter has no register for this, so it
  // is entered manually and used only to show a utilisation % on the dashboard.
  // Stored as a fixed 3-slot array (PV1–PV3); 0 means "not configured".
  const pvRated = Array.from({ length: 3 }, (_, i) => {
    const v = Number(Array.isArray(pvRatedW) ? pvRatedW[i] : 0);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  });

  // Manual discharge-floor overrides (%, 0 = use the inverter's hold register / default).
  const floor = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n) : 0;
  };

  // Electricity tariff used to value produced solar (one of two shapes). Stored
  // normalized so the savings calculator always sees a well-formed ladder/bands.
  // Omitted entirely until the user configures it, so the dashboard can prompt.
  const cost = Number(investmentCost);

  // Manual weather coordinates (override geolocation). Kept only when both are
  // valid and in range; otherwise left null so the dashboard falls back to geo/IP.
  const coord = (v: unknown, max: number): number | null => {
    const num = Number(v);
    return Number.isFinite(num) && Math.abs(num) <= max ? num : null;
  };
  const wLat = coord(weatherLat, 90);
  const wLon = coord(weatherLon, 180);

  // VAT % on the electricity bill (default 8). 0 is allowed; out-of-range → 8.
  const vatNum = Number(vatPercent);
  const vat = Number.isFinite(vatNum) && vatNum >= 0 && vatNum <= 100 ? vatNum : 8;

  // Manually-entered daily PV production (kWh) for days before monitoring started.
  // Stored as a deduped, date-sorted list; the savings API fills gaps with these.
  const manual = (Array.isArray(manualSolar) ? manualSolar : [])
    .map((e: any) => ({ date: String(e?.date ?? '').slice(0, 10), kwh: Number(e?.kwh) }))
    .filter((e: { date: string; kwh: number }) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(e.kwh) && e.kwh > 0);
  const manualMap = new Map<string, number>();
  for (const e of manual) manualMap.set(e.date, Math.round(e.kwh * 1000) / 1000);
  const manualClean = [...manualMap.entries()].map(([date, kwh]) => ({ date, kwh })).sort((a, b) => a.date.localeCompare(b.date));

  const config = {
    deviceSn: String(deviceSn).trim(),
    dongleSn: String(dongleSn ?? '').trim(),
    inverterIp: String(inverterIp).trim(),
    inverterPort: Number(inverterPort) || 8000,
    pvRatedW: pvRated,
    socFloorOnGrid: floor(socFloorOnGrid),
    socFloorOffGrid: floor(socFloorOffGrid),
    ...(pricing ? { pricing: normalizePricing(pricing) } : {}),
    investmentCost: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : 0,
    installDate: typeof installDate === 'string' && installDate.trim() ? installDate.trim() : '',
    manualSolar: manualClean,
    weatherLat: wLat,
    weatherLon: wLon,
    vatPercent: vat,
  };

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'deviceConfig',
    JSON.stringify(config),
  );
  // Point activeDeviceSn at the new device so the dashboard shows the right data
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'activeDeviceSn',
    config.deviceSn,
  );

  return NextResponse.json({ ok: true });
}
