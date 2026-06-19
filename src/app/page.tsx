'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import PowerFlow from '@/components/PowerFlow';
import ComingSoonDashboard from '@/components/ComingSoonDashboard';
import { IMPLEMENTED_SKINS, type ThemeSkin } from '@/components/ThemeSwitcher';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const SKIN_KEY = 'solariot.themeSkin';

export default function Dashboard() {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themeSkin, setThemeSkin] = useState<ThemeSkin>('solar');
  const [latestData, setLatestData] = useState<any>(null);
  const esRef = useRef<EventSource | null>(null);

  // Restore the saved skin on mount (client-only to avoid hydration mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(SKIN_KEY) as ThemeSkin | null;
    if (saved) setThemeSkin(saved);
  }, []);

  const handleSkinChange = (skin: ThemeSkin) => {
    setThemeSkin(skin);
    try { localStorage.setItem(SKIN_KEY, skin); } catch { /* ignore */ }
  };

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

  const skinImplemented = IMPLEMENTED_SKINS.includes(themeSkin);

  return (
    <div data-theme={theme} style={{ background: 'var(--sf-bg)', minHeight: '100vh' }}>
      {skinImplemented ? (
        <PowerFlow
          metrics={device?.metrics || {}}
          config={setupData?.config || {}}
          deviceSn={device?.deviceSn || setupData?.config?.deviceSn}
          lastSeenAt={device?.lastSeenAt || null}
          theme={theme}
          onThemeToggle={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          onConfigSaved={handleConfigSaved}
          themeSkin={themeSkin}
          onThemeSkinChange={handleSkinChange}
        />
      ) : (
        <ComingSoonDashboard themeSkin={themeSkin} onThemeSkinChange={handleSkinChange} />
      )}
    </div>
  );
}
