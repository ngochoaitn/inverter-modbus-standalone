import { NextRequest } from 'next/server';
import { subscribe } from '@/lib/push';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

function getLatestJson(): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('activeDeviceSn') as
    | { value: string } | undefined;
  if (!row) return null;
  const snRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`latest_${row.value}`) as
    | { value: string } | undefined;
  return snRow?.value ?? null;
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (json: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${json}\n\n`));
        } catch {
          // Client disconnected
        }
      };

      // Send current state immediately on connect
      const initial = getLatestJson();
      if (initial) send(initial);

      // Subscribe to future updates from the poller
      const unsubscribe = subscribe(send);

      req.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
    },
  });
}
