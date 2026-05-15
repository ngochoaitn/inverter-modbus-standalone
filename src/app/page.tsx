'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import PowerFlow from '@/components/PowerFlow';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function Dashboard() {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [latestData, setLatestData] = useState<any>(null);
  const esRef = useRef<EventSource | null>(null);

  const { data: setupData, mutate: mutateSetup } = useSWR('/api/setup', fetcher, { revalidateOnFocus: false });

  useEffect(() => {
    if (setupData && !setupData.configured) router.replace('/setup');
  }, [setupData, router]);

  // Stream latest device data via SSE instead of polling /api/devices/latest
  useEffect(() => {
    const es = new EventSource('/api/stream');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        // Wrap in the same shape as /api/devices/latest so PowerFlow props are unchanged
        setLatestData({ devices: [payload] });
      } catch { /* ignore malformed frames */ }
    };

    es.onerror = () => {
      // EventSource reconnects automatically; nothing to do here
    };

    return () => { es.close(); esRef.current = null; };
  }, []);

  const device = latestData?.devices?.[0];

  const handleConfigSaved = () => {
    mutateSetup();
  };

  return (
    <div data-theme={theme} style={{ background: 'var(--sf-bg)', minHeight: '100vh' }}>
      <PowerFlow
        metrics={device?.metrics || {}}
        config={setupData?.config || {}}
        deviceSn={device?.deviceSn || setupData?.config?.deviceSn}
        lastSeenAt={device?.lastSeenAt || null}
        theme={theme}
        onThemeToggle={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
        onConfigSaved={handleConfigSaved}
      />
    </div>
  );
}
