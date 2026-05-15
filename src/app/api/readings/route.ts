import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mapLuxpower } from '@/lib/mapper';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { deviceSn, dongleSn, registers } = payload;

    if (!deviceSn || !registers) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const mapped = mapLuxpower(registers);
    const now = new Date().toISOString();

    // Store latest in settings table for real-time view
    const latestJson = JSON.stringify({
      deviceSn,
      dongleSn,
      lastSeenAt: now,
      metrics: mapped,
      registers: registers
    });

    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(`latest_${deviceSn}`, latestJson);
    
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('activeDeviceSn', deviceSn);

    // Periodic history saving (1 minute interval)
    const lastHistory = db.prepare('SELECT createdAt FROM history WHERE deviceSn = ? ORDER BY createdAt DESC LIMIT 1')
      .get(deviceSn) as { createdAt: string } | undefined;

    const lastTime = lastHistory ? new Date(lastHistory.createdAt).getTime() : 0;
    const currentTime = Date.now();

    if (currentTime - lastTime >= 60000) {
      db.prepare('INSERT INTO history (deviceSn, createdAt, data) VALUES (?, ?, ?)')
        .run(deviceSn, now, JSON.stringify(mapped));
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
