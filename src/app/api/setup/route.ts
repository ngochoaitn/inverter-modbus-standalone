import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

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
  const { deviceSn, dongleSn, inverterIp, inverterPort, pvRatedW } = body;

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

  const config = {
    deviceSn: String(deviceSn).trim(),
    dongleSn: String(dongleSn ?? '').trim(),
    inverterIp: String(inverterIp).trim(),
    inverterPort: Number(inverterPort) || 8000,
    pvRatedW: pvRated,
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
