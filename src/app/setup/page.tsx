'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/I18nProvider';
import LanguageSwitcher from '@/components/LanguageSwitcher';

export default function SetupPage() {
  const router = useRouter();
  const t = useT();
  const [form, setForm] = useState({ deviceSn: '', dongleSn: '', inverterIp: '', inverterPort: '8000' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(d => { if (d.configured) router.replace('/'); })
      .catch(() => {});
  }, [router]);

  const set = (key: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.deviceSn.trim()) { setError(t('config.errDeviceSn')); return; }
    if (!form.inverterIp.trim()) { setError(t('config.errInverterIp')); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSn: form.deviceSn,
          dongleSn: form.dongleSn,
          inverterIp: form.inverterIp,
          inverterPort: Number(form.inverterPort) || 8000,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('config.errSave')); return; }
      router.replace('/');
    } catch {
      setError(t('config.errConnect'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-login">

      {/* ── LEFT: Hero ── */}
      <div className="admin-login-hero">
        <p>{t('setup.localMode')}</p>
        <h1>Solar<br />Monitor</h1>

        <p style={{ marginTop: 24, fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
          {t('setup.intro')}<br />
          {t('setup.intro2')}
        </p>

        {/* Data flow */}
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { dot: '#5cbf6a', label: t('setup.flowInverter'), sub: t('setup.flowInverterSub') },
            { dot: '#c99318', label: t('setup.flowServer'), sub: t('setup.flowServerSub') },
            { dot: '#5b9cf0', label: t('setup.flowDashboard'), sub: t('setup.flowDashboardSub') },
          ].map((item, i) => (
            <div key={item.label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: item.dot, flexShrink: 0, boxShadow: `0 0 8px ${item.dot}` }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: 0, textTransform: 'none' }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: '"JetBrains Mono", monospace', marginTop: 1 }}>{item.sub}</div>
                </div>
              </div>
              {i < 2 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', paddingLeft: 2 }}>↓</div>}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="login-metrics" style={{ marginTop: 28 }}>
          <span><strong>{t('setup.pollValue')}</strong><small>{t('setup.pollLabel')}</small></span>
          <span><strong>{t('setup.historyValue')}</strong><small>{t('setup.historyLabel')}</small></span>
          <span><strong>{t('setup.storageValue')}</strong><small>{t('setup.storageLabel')}</small></span>
        </div>
      </div>

      {/* ── RIGHT: Form card ── */}
      <div className="admin-login-panel">
        <div className="login-panel-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="admin-brand">
            <div style={{ width: 28, height: 28, background: '#38a34b', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚡</div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Lux Local</span>
          </div>
          <LanguageSwitcher />
        </div>

        <h2>{t('setup.heading')}</h2>
        <p className="admin-muted">{t('setup.sub')}</p>

        <form className="admin-form" onSubmit={handleSubmit}>
          {/* Row 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>
              <span>{t('config.deviceSn')} <span style={{ color: '#ef4444' }}>*</span></span>
              <input type="text" placeholder=""value={form.deviceSn} onChange={set('deviceSn')} autoComplete="off" spellCheck={false} />
            </label>
            <label>
              <span>{t('config.dongleSn')}</span>
              <input type="text" placeholder=""value={form.dongleSn} onChange={set('dongleSn')} autoComplete="off" spellCheck={false} />
            </label>
          </div>

          {/* Row 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
            <label>
              <span>{t('config.inverterIp')} <span style={{ color: '#ef4444' }}>*</span></span>
              <input type="text" placeholder=""value={form.inverterIp} onChange={set('inverterIp')} autoComplete="off" spellCheck={false} />
            </label>
            <label>
              <span>{t('config.modbusPort')}</span>
              <input type="number" placeholder=""value={form.inverterPort} onChange={set('inverterPort')} min={1} max={65535} />
            </label>
          </div>

          {error && (
            <div style={{ padding: '9px 12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 4, color: '#ef4444', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button type="submit" className="admin-primary" disabled={saving} style={{ width: '100%', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {saving && <span className="setup-spinner" />}
            {saving ? t('config.saving') : t('setup.start')}
          </button>
        </form>
      </div>
    </div>
  );
}
