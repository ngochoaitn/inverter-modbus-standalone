import { NextRequest, NextResponse } from 'next/server';
import { getAllTimeTotals } from '@/lib/energyTotals';

// All-time energy totals (kWh) for the "Total" column on the summary cards.
// Cheap: reads the frozen daily_energy rollup + today's live counters, never a
// full history scan. See energyTotals.ts.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceSn = searchParams.get('deviceSn');

  if (!deviceSn) return NextResponse.json({ error: 'Missing deviceSn' }, { status: 400 });

  try {
    return NextResponse.json(getAllTimeTotals(deviceSn));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
