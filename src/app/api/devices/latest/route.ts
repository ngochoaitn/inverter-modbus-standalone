import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const activeSnRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('activeDeviceSn') as { value: string } | undefined;
    const activeSn = activeSnRow?.value;

    if (!activeSn) {
      return NextResponse.json({ devices: [] });
    }

    const latestRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`latest_${activeSn}`) as { value: string } | undefined;
    
    if (!latestRow) {
      return NextResponse.json({ devices: [] });
    }

    const deviceData = JSON.parse(latestRow.value);
    
    return NextResponse.json({
      devices: [deviceData]
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
