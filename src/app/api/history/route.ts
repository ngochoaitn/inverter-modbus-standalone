import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { METRIC_CATALOG } from '@/lib/historyMetrics';

// Whitelist of valid metric keys to prevent SQL injection. The metric value is
// also bound as a parameter, but this keeps the surface explicit. Derived from
// the history-metric catalogue (the "Thêm chỉ số" picker) plus a few legacy keys.
const ALLOWED_METRICS = new Set<string>([
  ...METRIC_CATALOG.flatMap(g => g.items.map(it => it.key)),
  // Legacy keys kept for backward compatibility with older callers.
  'batteryChargeToday', 'batteryDischargeToday', 'loadEnergyToday',
]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceSn = searchParams.get('deviceSn');
  const metric = searchParams.get('metric');
  const from = searchParams.get('from') || new Date(Date.now() - 86_400_000).toISOString();
  const to = searchParams.get('to') || new Date().toISOString();

  if (!deviceSn || !metric) {
    return NextResponse.json({ error: 'Missing deviceSn or metric' }, { status: 400 });
  }

  if (!ALLOWED_METRICS.has(metric)) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  }

  try {
    // History rows store metrics as JSON in the `data` column.
    // Use SQLite json_extract to pull the specific metric value.
    const rows = db.prepare(`
      SELECT
        createdAt AS timestamp,
        json_extract(data, '$.' || ?) AS value
      FROM history
      WHERE deviceSn = ?
        AND createdAt >= ?
        AND createdAt <= ?
      ORDER BY createdAt ASC
    `).all(metric, deviceSn, from, to) as { timestamp: string; value: number | null }[];

    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('History API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
