import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceSn = searchParams.get('deviceSn');
  const from = searchParams.get('from') || new Date(Date.now() - 86_400_000).toISOString();
  const to = searchParams.get('to') || new Date().toISOString();

  if (!deviceSn) {
    return NextResponse.json({ error: 'Missing deviceSn' }, { status: 400 });
  }

  try {
    const rows = db.prepare(`
      SELECT
        createdAt AS timestamp,
        json_extract(data, '$.pvPower')     AS pvPower,
        json_extract(data, '$.loadPower')   AS loadPower,
        json_extract(data, '$.gridFlow')    AS gridFlow,
        json_extract(data, '$.batteryFlow') AS batteryFlow,
        json_extract(data, '$.batterySoc')  AS batterySoc
      FROM history
      WHERE deviceSn = ?
        AND createdAt >= ?
        AND createdAt <= ?
      ORDER BY createdAt ASC
    `).all(deviceSn, from, to);

    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
