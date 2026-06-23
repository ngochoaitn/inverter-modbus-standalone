'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BatteryCharging, ChevronLeft, ChevronRight, Home, Maximize2, Settings, Sun, X, Zap,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import HistoricalGraph from './HistoricalGraph';
import ThemeSwitcher, { type ThemeSkin } from './ThemeSwitcher';
import LanguageSwitcher from './LanguageSwitcher';
import PowerUnitSwitcher from './PowerUnitSwitcher';
import { useT } from '@/lib/i18n/I18nProvider';
import { usePowerUnit } from '@/lib/prefs/PowerUnitProvider';

// ── Helpers ────────────────────────────────────────────

function n(value: any, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function fmt(value: any, digits = 0) {
  if (value == null) return '--';
  const num = n(value);
  return digits > 0 ? num.toFixed(digits) : Math.round(num).toString();
}

// Compact "~Xh Ym" / "~Ym" label for a duration in minutes; null when not positive.
function fmtDuration(mins: number): string | null {
  if (!(mins > 0)) return null;
  return mins >= 60 ? `~${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m` : `~${Math.round(mins)}m`;
}

// Break the home load down into where it is being supplied from, using the hybrid
// inverter's natural priority: PV covers the load first, then battery discharge, then
// grid import (the remainder must be grid, by power balance). Returns null when idle.
function loadMix(metrics: any): { solar: number; battery: number; grid: number } | null {
  const load = n(metrics.loadPower);
  if (load <= 0) return null;
  const pv = n(metrics.pvPower) || (n(metrics.pv1Power) + n(metrics.pv2Power));
  const solarW   = Math.min(pv, load);
  let   rem      = load - solarW;
  const batteryW = Math.min(Math.max(n(metrics.batteryDischargePower), 0), rem);
  rem -= batteryW;
  const gridW = Math.max(rem, 0);
  const pct = (w: number) => Math.round((w / load) * 100);
  return { solar: pct(solarW), battery: pct(batteryW), grid: pct(gridW) };
}

// Inline "where the load comes from" chips (sun / battery / grid), hiding 0% sources.
function LoadMix({ mix }: { mix: { solar: number; battery: number; grid: number } }) {
  const items = [
    { key: 'solar',   icon: <Sun size={11} />,             pct: mix.solar,   color: 'var(--sf-solar)' },
    { key: 'battery', icon: <BatteryCharging size={11} />, pct: mix.battery, color: 'var(--sf-battery)' },
    { key: 'grid',    icon: <Zap size={11} />,             pct: mix.grid,    color: 'var(--sf-idle)' },
  ].filter(x => x.pct > 0);
  if (!items.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
      {items.map(x => (
        <span key={x.key} style={{ display: 'inline-flex', gap: 2, alignItems: 'center', color: x.color }}>
          {x.icon}{x.pct}%
        </span>
      ))}
    </span>
  );
}

// Only surface temperature sensors the inverter actually reports — some models
// leave internal/battery registers empty, so we hide whatever has no reading.
function tempReadings(metrics: any, t: (k: string) => string) {
  return [
    { key: 'internal', label: t('node.tempInner').trim(),     v: metrics.internalTemperature },
    { key: 'rad1',     label: t('node.tempRadiator').trim(),  v: metrics.radiator1Temperature },
    { key: 'rad2',     label: t('node.tempRadiator2').trim(), v: metrics.radiator2Temperature },
    { key: 'bat',      label: t('node.tempBattery').trim(),   v: metrics.batteryTemperature },
  ].filter(x => x.v != null && Number.isFinite(Number(x.v)));
}

const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isToday = (d: Date) => dateStr(d) === dateStr(new Date());

// ── Weather ────────────────────────────────────────────

// Returns a translation key suffix under `weather.*` for a WMO weather code.
function wmoKey(code: number) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partlyCloudy';
  if (code === 3) return 'overcast';
  if (code <= 48) return 'foggy';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'showers';
  if (code <= 86) return 'snowShowers';
  return 'thunderstorm';
}

function WeatherGlyph({ code = 0, size = 32 }: { code?: number; size?: number }) {
  const isRain = code >= 51 && code <= 82;
  const isSnow = code >= 71 && code <= 77;
  const isStorm = code >= 95;
  const isFog = code === 45 || code === 48;
  const isCloudy = code === 3;
  const isPartly = code === 2;
  if (isStorm) return <svg viewBox="0 0 32 32" width={size} height={size}><ellipse cx="12" cy="13" rx="9" ry="6" fill="var(--sf-ink-2)"/><ellipse cx="19" cy="15" rx="7" ry="5" fill="var(--sf-ink-2)"/><polyline points="14,21 11,26 15,26 12,31" fill="none" stroke="#f0a93a" strokeWidth="2" strokeLinejoin="round"/></svg>;
  if (isSnow) return <svg viewBox="0 0 32 32" width={size} height={size}><ellipse cx="12" cy="13" rx="9" ry="6" fill="var(--sf-ink-2)"/><ellipse cx="20" cy="15" rx="7" ry="5" fill="var(--sf-ink-2)"/><g fill="#a8d8f0" fontSize="7" fontFamily="sans-serif"><text x="8" y="27">❄</text><text x="16" y="29">❄</text><text x="23" y="26">❄</text></g></svg>;
  if (isRain) return <svg viewBox="0 0 32 32" width={size} height={size}><ellipse cx="12" cy="12" rx="9" ry="6" fill="var(--sf-ink-2)"/><ellipse cx="20" cy="14" rx="7" ry="5" fill="var(--sf-ink-2)"/><g stroke="#5ba4d4" strokeWidth="1.6" strokeLinecap="round"><line x1="10" y1="22" x2="8" y2="27"/><line x1="16" y1="22" x2="14" y2="27"/><line x1="22" y1="22" x2="20" y2="27"/></g></svg>;
  if (isFog) return <svg viewBox="0 0 32 32" width={size} height={size}><g stroke="var(--sf-ink-2)" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="12" x2="28" y2="12"/><line x1="6" y1="17" x2="26" y2="17"/><line x1="8" y1="22" x2="24" y2="22"/></g></svg>;
  if (isCloudy) return <svg viewBox="0 0 32 32" width={size} height={size}><ellipse cx="13" cy="15" rx="10" ry="7" fill="var(--sf-ink-2)"/><ellipse cx="22" cy="17" rx="7" ry="5" fill="var(--sf-ink-2)"/></svg>;
  if (isPartly) return <svg viewBox="0 0 32 32" width={size} height={size}><circle cx="11" cy="11" r="6" fill="#f0a93a"/><ellipse cx="19" cy="19" rx="9" ry="6" fill="var(--sf-ink-2)"/></svg>;
  return <svg viewBox="0 0 32 32" width={size} height={size}><circle cx="16" cy="16" r="7" fill="#f0a93a"/><g stroke="#f0a93a" strokeWidth="1.6" strokeLinecap="round"><line x1="16" y1="3" x2="16" y2="6"/><line x1="16" y1="26" x2="16" y2="29"/><line x1="3" y1="16" x2="6" y2="16"/><line x1="26" y1="16" x2="29" y2="16"/><line x1="6.5" y1="6.5" x2="8.5" y2="8.5"/><line x1="23.5" y1="23.5" x2="25.5" y2="25.5"/><line x1="6.5" y1="25.5" x2="8.5" y2="23.5"/><line x1="23.5" y1="8.5" x2="25.5" y2="6.5"/></g></svg>;
}

function useWeather() {
  const [weather, setWeather] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let lat: number, lon: number, city = '';
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
          );
          lat = pos.coords.latitude; lon = pos.coords.longitude;
        } catch {
          const geo = await (await fetch('https://freeipapi.com/api/json')).json();
          if (!geo.latitude) return;
          lat = geo.latitude; lon = geo.longitude; city = geo.cityName || '';
        }
        if (cancelled) return;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,shortwave_radiation_sum,sunrise,sunset&timezone=auto&forecast_days=1`;
        const wx = await (await fetch(url)).json();
        if (cancelled) return;
        const d = wx.daily;
        const sunsetRaw = d?.sunset?.[0];
        const sunset = sunsetRaw
          ? new Date(sunsetRaw).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          : '--:--';
        setWeather({
          tempMax: Math.round(d.temperature_2m_max?.[0] ?? 0),
          tempMin: Math.round(d.temperature_2m_min?.[0] ?? 0),
          code: d.weather_code?.[0] ?? 0,
          uv: (d.uv_index_max?.[0] ?? 0).toFixed(1),
          irr: ((d.shortwave_radiation_sum?.[0] ?? 0) / 3.6).toFixed(1),
          sunset, city,
        });
      } catch { /* widget stays at -- */ }
    }
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return weather;
}

// ── Energy History Chart ────────────────────────────────

const CHART_SERIES = [
  { key: 'solar',   color: '#38a34b', labelKey: 'chart.solarPower',   axis: 'left'  },
  { key: 'load',    color: '#5ba4d4', labelKey: 'chart.houseLoad',    axis: 'left'  },
  { key: 'grid',    color: '#a855f7', labelKey: 'chart.gridPower',    axis: 'left'  },
  { key: 'battery', color: '#c99318', labelKey: 'chart.batteryPower', axis: 'left'  },
  { key: 'soc',     color: '#06b6d4', labelKey: 'chart.batterySoc',   axis: 'right' },
];

function useEnergyChart(deviceSn: string | undefined, date: Date) {
  const [data, setData] = useState<any[]>([]);
  const key = dateStr(date);
  useEffect(() => {
    if (!deviceSn) return;
    let cancelled = false;
    async function load() {
      try {
        const from = new Date(date); from.setHours(0, 0, 0, 0);
        const to   = new Date(date); to.setHours(23, 59, 59, 999);
        const rows = await fetch(
          `/api/history/chart?deviceSn=${deviceSn}&from=${from.toISOString()}&to=${to.toISOString()}`
        ).then(r => r.json());
        if (!cancelled) setData(Array.isArray(rows) ? rows : []);
      } catch { /* ignore */ }
    }
    load();
    if (isToday(date)) {
      const timer = setInterval(load, 5 * 60 * 1000);
      return () => { cancelled = true; clearInterval(timer); };
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSn, key]);
  return data;
}

function EnergyHistoryChart({ data, hiddenSeries, date, height = 260 }: any) {
  const t = useT();
  const dayMs = useMemo(() => {
    const d = date ? new Date(date) : new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [date]);
  const ticks = useMemo(() => [0, 4, 8, 12, 16, 20, 24].map(h => dayMs + h * 3600000), [dayMs]);
  const fmtTick = (v: number) => new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const chartData = useMemo(() => data.map((d: any) => ({
    t:       new Date(d.timestamp).getTime(),
    solar:   d.pvPower     != null ? +(d.pvPower     / 1000).toFixed(2) : undefined,
    load:    d.loadPower   != null ? +(d.loadPower   / 1000).toFixed(2) : undefined,
    grid:    d.gridFlow    != null ? +(d.gridFlow    / 1000).toFixed(2) : undefined,
    battery: d.batteryFlow != null ? +(d.batteryFlow / 1000).toFixed(2) : undefined,
    soc:     d.batterySoc  != null ? +Number(d.batterySoc).toFixed(1)  : undefined,
  })), [data]);

  const yDomain = useMemo(() => {
    if (!chartData.length) return [0, 'auto'];
    let min = 0, max = 0;
    CHART_SERIES.filter(s => s.axis === 'left').forEach(s => chartData.forEach((d: any) => {
      const v = d[s.key];
      if (v != null) { if (v < min) min = v; if (v > max) max = v; }
    }));
    return [Math.floor(min * 10) / 10, Math.ceil(max * 10) / 10];
  }, [chartData]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
        <defs>
          {CHART_SERIES.map(s => (
            <linearGradient key={s.key} id={`efg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" vertical={false} />
        <XAxis
          dataKey="t" type="number" scale="time"
          domain={[dayMs, dayMs + 86400000]} ticks={ticks} tickFormatter={fmtTick}
          tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }}
          tickLine={false} axisLine={{ stroke: 'var(--sf-line)' }}
        />
        <YAxis
          yAxisId="left" domain={yDomain as any}
          tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }}
          axisLine={false} tickLine={false} width={36} tickFormatter={(v: number) => `${v}kW`}
        />
        <YAxis
          yAxisId="right" orientation="right" domain={[0, 100]}
          tick={{ fontSize: 9, fill: '#06b6d4', fontFamily: 'JetBrains Mono,monospace' }}
          axisLine={false} tickLine={false} width={30} tickFormatter={(v: any) => `${v}%`}
          hide={hiddenSeries?.has('soc')}
        />
        <ReferenceLine yAxisId="left" y={0} stroke="var(--sf-line)" strokeWidth={1} />
        <Tooltip
          cursor={{ stroke: 'var(--sf-ink)', strokeWidth: 0.8, strokeDasharray: '4 3' }}
          contentStyle={{ background: 'var(--sf-panel)', border: '1px solid var(--sf-line)', borderRadius: 4, fontSize: 11, padding: '6px 10px' }}
          labelFormatter={fmtTick as any}
          formatter={(v: any, name: any) => {
            const s = CHART_SERIES.find(x => t(x.labelKey) === name);
            return s?.axis === 'right' ? [`${v}%`, name] : [`${v} kW`, name];
          }}
        />
        {CHART_SERIES.map(s => (
          <Area
            key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={t(s.labelKey)}
            stroke={s.color} strokeWidth={s.axis === 'right' ? 1.5 : 1.8}
            strokeDasharray={s.axis === 'right' ? '4 2' : undefined}
            fill={`url(#efg-${s.key})`} dot={false}
            activeDot={{ r: 3, fill: s.color, strokeWidth: 0 }}
            isAnimationActive={false} connectNulls
            hide={hiddenSeries?.has(s.key)}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Trend Chart ────────────────────────────────────────

const TREND_SERIES = [
  { key: 'solar',        color: '#38a34b', labelKey: 'trend.solar'        },
  { key: 'home',         color: '#d44728', labelKey: 'trend.home'         },
  { key: 'batCharge',    color: '#c99318', labelKey: 'trend.batCharge'    },
  { key: 'batDischarge', color: '#e07535', labelKey: 'trend.batDischarge' },
  { key: 'gridImport',   color: '#7f858a', labelKey: 'trend.gridImport'   },
];

type TrendPeriod = 'day' | 'month' | 'year';

function useTrendChart(deviceSn: string | undefined, period: TrendPeriod) {
  const [data, setData] = useState<any[]>([]);
  useEffect(() => {
    if (!deviceSn) return;
    let cancelled = false;
    fetch(`/api/history/trend?deviceSn=${deviceSn}&period=${period}`)
      .then(r => r.json())
      .then(rows => { if (!cancelled) setData(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deviceSn, period]);
  return data;
}

function fmtTrendLabel(periodStr: string, mode: TrendPeriod) {
  const d = new Date(periodStr);
  if (mode === 'year')  return String(d.getUTCFullYear());
  if (mode === 'month') return d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return String(d.getUTCDate()).padStart(2, '0');
}

function TrendChart({ data, period, hiddenSeries, onToggle, height = 300 }: {
  data: any[]; period: TrendPeriod; hiddenSeries?: Set<string>;
  onToggle?: (key: string) => void; height?: number;
}) {
  const t = useT();
  const chartData = useMemo(
    () => data.map(d => ({ label: fmtTrendLabel(d.period, period), ...d })),
    [data, period],
  );

  const yDomain = useMemo(() => {
    if (!chartData.length) return [0, 'auto'];
    let max = 0;
    TREND_SERIES.forEach(s => chartData.forEach(d => {
      const v = d[s.key]; if (v != null && v > max) max = v;
    }));
    return [0, Math.ceil(max * 1.18)];
  }, [chartData]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }} tickLine={false} axisLine={{ stroke: 'var(--sf-line)' }} />
        <YAxis domain={yDomain as any} tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }} axisLine={false} tickLine={false} width={42} tickFormatter={(v: any) => `${v} kWh`} />
        <Tooltip
          cursor={{ fill: 'var(--sf-line)', opacity: 0.5 }}
          contentStyle={{ background: 'var(--sf-panel)', border: '1px solid var(--sf-line)', borderRadius: 4, fontSize: 11, padding: '6px 10px' }}
          formatter={(v: any, name: any) => v != null ? [`${v} kWh`, name] : ['-', name]}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 8 }}
          content={() => (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, fontFamily: 'JetBrains Mono,monospace' }}>
              {TREND_SERIES.map(s => (
                <span
                  key={s.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: hiddenSeries?.has(s.key) ? 0.3 : 1, cursor: 'pointer' }}
                  onClick={() => onToggle?.(s.key)}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  {t(s.labelKey)}
                </span>
              ))}
            </div>
          )}
        />
        {TREND_SERIES.map(s => (
          <Bar key={s.key} dataKey={s.key} name={t(s.labelKey)} fill={s.color} radius={[2, 2, 0, 0]} isAnimationActive={false} hide={hiddenSeries?.has(s.key)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Chart Modal ────────────────────────────────────────

function ChartModal({ title, onClose, children }: any) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sf-chart-modal-backdrop" onClick={onClose}>
      <div className="sf-chart-modal" onClick={(e: any) => e.stopPropagation()}>
        <div className="sf-chart-modal-bar">
          <span className="sf-chart-modal-title">{title}</span>
          <button className="sf-chart-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Metric Modal (single metric history) ───────────────

function MetricModal({ deviceSn, metric, onClose }: any) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="history-modal-backdrop" onClick={onClose}>
      <div className="history-modal-panel" onClick={(e: any) => e.stopPropagation()}>
        <HistoricalGraph
          deviceSn={deviceSn}
          metric={metric.metric}
          unit={metric.unit}
          color={metric.color}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

// ── Config Modal ───────────────────────────────────────

function ConfigModal({ config, onClose, onSaved }: { config: any; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [form, setForm] = useState({
    deviceSn: config?.deviceSn || '',
    dongleSn: config?.dongleSn || '',
    inverterIp: config?.inverterIp || '',
    inverterPort: String(config?.inverterPort ?? 8000),
    pv1RatedW: String(config?.pvRatedW?.[0] || ''),
    pv2RatedW: String(config?.pvRatedW?.[1] || ''),
    pv3RatedW: String(config?.pvRatedW?.[2] || ''),
    socFloorOnGrid: String(config?.socFloorOnGrid || ''),
    socFloorOffGrid: String(config?.socFloorOffGrid || ''),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.deviceSn.trim()) { setError(t('config.errDeviceSn')); return; }
    if (!form.inverterIp.trim()) { setError(t('config.errInverterIp')); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceSn: form.deviceSn.trim(),
          dongleSn: form.dongleSn.trim(),
          inverterIp: form.inverterIp.trim(),
          inverterPort: Number(form.inverterPort) || 8000,
          pvRatedW: [form.pv1RatedW, form.pv2RatedW, form.pv3RatedW].map(v => Number(v) || 0),
          socFloorOnGrid: Number(form.socFloorOnGrid) || 0,
          socFloorOffGrid: Number(form.socFloorOffGrid) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('config.errSave')); return; }
      onSaved();
      onClose();
    } catch {
      setError(t('config.errConnect'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="history-modal-backdrop" onClick={onClose}>
      <div
        className="sf-config-popover"
        onClick={(e: any) => e.stopPropagation()}
        style={{ position: 'relative', top: 'auto', right: 'auto', display: 'block', maxWidth: 480, margin: '0 auto' }}
      >
        <div className="sf-config-panel">
          <div className="sf-config-head">
            <div>
              <strong>{t('config.title')}</strong>
              <span>Lux Local · Modbus TCP</span>
            </div>
            <button type="button" className="sf-icon-btn" onClick={onClose}><X size={16} /></button>
          </div>

          <form onSubmit={handleSave}>
            <div className="sf-config-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="sf-config-field">
                <div className="field-label-row">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('config.deviceSn')} <span style={{ color: '#ef4444' }}>*</span></label>
                </div>
                <input type="text" value={form.deviceSn} onChange={set('deviceSn')} autoComplete="off" spellCheck={false} />
              </div>
              <div className="sf-config-field">
                <div className="field-label-row"><label>{t('config.dongleSn')}</label></div>
                <input type="text" value={form.dongleSn} onChange={set('dongleSn')} autoComplete="off" spellCheck={false} />
              </div>
              <div className="sf-config-field">
                <div className="field-label-row">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('config.inverterIp')} <span style={{ color: '#ef4444' }}>*</span></label>
                </div>
                <input type="text" value={form.inverterIp} onChange={set('inverterIp')} autoComplete="off" spellCheck={false} />
              </div>
              <div className="sf-config-field">
                <div className="field-label-row"><label>{t('config.modbusPort')}</label></div>
                <input type="number" value={form.inverterPort} onChange={set('inverterPort')} min={1} max={65535} />
              </div>
            </div>

            <div className="field-label-row" style={{ marginTop: 12 }}>
              <label>{t('config.pvRated')}</label>
            </div>
            <div className="sf-config-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              {([['pv1RatedW', 'PV1'], ['pv2RatedW', 'PV2'], ['pv3RatedW', 'PV3']] as const).map(([key, label]) => (
                <div className="sf-config-field" key={key}>
                  <div className="field-label-row"><label>{label} (Wp)</label></div>
                  <input
                    type="number"
                    value={(form as any)[key]}
                    onChange={set(key)}
                    min={0}
                    step={100}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>

            <div className="field-label-row" style={{ marginTop: 12 }}>
              <label>{t('config.socFloor')}</label>
            </div>
            <div className="sf-config-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="sf-config-field">
                <div className="field-label-row"><label>{t('config.socFloorOnGrid')}</label></div>
                <input type="number" value={form.socFloorOnGrid} onChange={set('socFloorOnGrid')} min={0} max={100} placeholder="20" />
              </div>
              <div className="sf-config-field">
                <div className="field-label-row"><label>{t('config.socFloorOffGrid')}</label></div>
                <input type="number" value={form.socFloorOffGrid} onChange={set('socFloorOffGrid')} min={0} max={100} placeholder="15" />
              </div>
            </div>

            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 4, color: '#ef4444', fontSize: 13, margin: '8px 0' }}>
                {error}
              </div>
            )}

            <div className="sf-config-actions">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? t('config.saving') : t('config.save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Node (PV Total / Home Load) ────────────────────────

function Node({ className = '', label, value, unit, sub, tag, glyph, onClick }: any) {
  return (
    <button className={`sf-node ${className}`} onClick={onClick} type="button">
      <div className="sf-label">
        <div className="sf-label-left">
          {glyph && <span className={`sf-glyph ${glyph}`} />}
          <span>{label}</span>
        </div>
        {tag && <span className="sf-tag">{tag}</span>}
      </div>
      <div className="sf-value-row">
        <span className="sf-value mono">{value}<small className="unit">{unit}</small></span>
      </div>
      {sub && <div className="sf-sub mono">{sub}</div>}
    </button>
  );
}

// ── Mobile detection ───────────────────────────────────

// Ticking clock so online/offline status stays live without new data arriving.
// A shared cadence keeps Desktop and Mobile views in sync instead of each
// freezing isOnline at its own render time.
function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function useIsMobile() {
  // Start `false` on both server and first client render so hydration matches;
  // the real viewport width is applied right after mount.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= 1334);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}

// ── MobileFlow ─────────────────────────────────────────

function MobileFlow({ metrics, config, deviceSn, lastSeenAt, theme, onThemeToggle, onConfigSaved, themeSkin, onThemeSkinChange }: PowerFlowProps) {
  const t = useT();
  const { pw } = usePowerUnit();
  const [activeTab, setActiveTab]   = useState<'flow' | 'stats'>('flow');
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('month');
  const [hiddenTrend, setHiddenTrend] = useState(new Set<string>());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [configOpen, setConfigOpen] = useState(false);
  const [activeMetric, setActiveMetric] = useState<any>(null);

  const onMetric = (metric: string, unit: string, color: string) =>
    setActiveMetric({ metric, unit, color });

  const now = useNow();
  const weather = useWeather();
  const chartData = useEnergyChart(deviceSn, selectedDate);
  const trendData = useTrendChart(deviceSn, trendPeriod);

  const toggleTrend = (k: string) =>
    setHiddenTrend(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; });

  const pv      = n(metrics.pvPower) || (n(metrics.pv1Power) + n(metrics.pv2Power));
  const battery = n(metrics.batteryFlow);
  const grid    = n(metrics.gridFlow);
  const load    = n(metrics.loadPower) || Math.max(pv + grid + battery, 0);
  const invTotalIn  = pv + n(metrics.batteryDischargePower) + n(metrics.powerFromGrid);
  const invTotalOut = load + n(metrics.batteryChargePower) + n(metrics.epsPower);
  const inverterNet = invTotalIn - invTotalOut;
  const soc         = n(metrics.batterySoc);
  const isBatChg    = battery < -20;
  const batteryActive = battery !== 0;

  const timeToFullLabel  = fmtDuration(n(metrics.batteryMinutesToFull));
  const timeToEmptyLabel = fmtDuration(n(metrics.batteryMinutesToEmpty));

  // PV strings present on this inverter (power or voltage seen). With 2+ strings
  // we list each string's power; with 0–1 we just show the MPPT count.
  const pvStrings = [1, 2, 3]
    .map(i => ({
      i,
      power: n(metrics[`pv${i}Power`]),
      voltage: n(metrics[`pv${i}Voltage`]),
      ratedW: n(config?.pvRatedW?.[i - 1]),
    }))
    .filter(s => s.power > 0 || s.voltage > 0);
  const pvSub = pvStrings.length >= 2
    ? pvStrings.map(s => `${pw(s.power).value}${pw(s.power).unit}`).join(' + ')
    : '1 MPPT';
  // Show the utilisation % on a second line aligned under each string's power,
  // but only when at least one string has a configured rated Wp.
  const pvHasRated = pvStrings.length >= 2 && pvStrings.some(s => s.ratedW > 0);
  // Total designed PV power (sum of configured strings) → overall utilisation %.
  const pvTotalRatedW = [0, 1, 2].reduce((sum, i) => sum + n(config?.pvRatedW?.[i]), 0);
  const pvTotalUtil   = pvTotalRatedW > 0 ? Math.round((pv / pvTotalRatedW) * 100) : null;

  // Compact temperature summary for the inverter node: the two radiator sensors
  // share one label ("Tản: 52°, 46°"); internal/battery are shown individually.
  const temps = tempReadings(metrics, t);
  const radValues = temps.filter(x => x.key === 'rad1' || x.key === 'rad2').map(x => `${fmt(x.v)}°`);
  const tempSub = [
    ...temps.filter(x => x.key === 'internal').map(x => `${x.label} ${fmt(x.v)}°`),
    ...(radValues.length ? [`${t('node.tempRadiator').trim()}: ${radValues.join(', ')}`] : []),
    ...temps.filter(x => x.key === 'bat').map(x => `${x.label} ${fmt(x.v)}°`),
  ].join(' ');
  const gridActive  = Math.abs(grid) > 10;
  const batteryState = battery < 0 ? 'Charging' : battery > 0 ? 'Discharging' : 'Standby';
  const lastSeen    = lastSeenAt ? new Date(lastSeenAt) : null;
  const isOnline    = lastSeen ? (now - lastSeen.getTime() < 15_000) : false;
  const homeEnergy  = n(metrics.homeConsumptionEnergyToday ?? metrics.loadEnergyToday);
  const importEnergy = n(metrics.importEnergyToday);
  const selfSufficiency = homeEnergy > 0 ? Math.max(0, Math.min(100, (1 - importEnergy / homeEnergy) * 100)) : 0;

  return (
    <div className="sf-mobile">
      {/* Header */}
      <div className="sfm-header">
        <div className="left">
          <h3>
            <span className={`sf-status-dot${isOnline ? '' : ' offline'}`} style={{ marginRight: 8, display: 'inline-block' }} />
            {'Lux Local'}
          </h3>
          <div className="sub">
            {isOnline ? t('status.online') : t('status.offline')}
            {config?.dongleSn ? ` · ${config.dongleSn}` : ''}
          </div>
        </div>
        <div className="sfm-actions">
          <PowerUnitSwitcher variant="circle" />
          <LanguageSwitcher variant="circle" />
          <ThemeSwitcher themeSkin={themeSkin} onThemeSkinChange={onThemeSkinChange} />
          <button className="sfm-circle-btn" onClick={onThemeToggle} title={t('common.toggleTheme')}>
            {theme === 'dark' ? '☀' : '◑'}
          </button>
          <button className="sfm-circle-btn" onClick={() => setConfigOpen(true)} title={t('common.settings')}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {activeTab === 'flow' ? (
        <>
          {/* Weather strip */}
          <div className="sf-weather-mini sfm-weather">
            <WeatherGlyph code={weather?.code ?? 0} size={16} />
            <div className="sf-wm-temp">
              <div className="sf-wm-t">
                {weather ? weather.tempMax : '--'}<span className="sf-wm-deg">°C</span>
                <span className="sf-wm-min">/{weather ? weather.tempMin : '--'}°</span>
              </div>
            </div>
            <div className="sf-wm-sep" />
            <div className="sf-wm-stat"><span className="k">{t('weather.sunset')}</span><span className="v">{weather?.sunset ?? '--:--'}</span></div>
            <div className="sf-wm-stat"><span className="k">{t('weather.uv')}</span><span className="v">{weather?.uv ?? '--'}</span></div>
            <div className="sf-wm-stat"><span className="k">{t('weather.irrad')}</span><span className="v">{weather ? `${weather.irr} kWh/m²` : '--'}</span></div>
          </div>

          {/* Main numbers */}
          <section className="sfm-card main-card">
            <div className="sfm-main-row">
              <div className="sfm-main-pv" onClick={() => onMetric('pvPower', 'W', '#38a34b')}>
                <small>{t('mobile.producing')}</small>
                <strong className="solar-c">{pw(pv).value}<span>{pw(pv).unit}</span></strong>
              </div>
              <div className="sfm-main-sep" />
              <div className="sfm-main-item" onClick={() => onMetric('loadPower', 'W', '#d44728')}>
                <small>{t('mobile.consume')}</small>
                <strong className="load-c">{pw(load).value}<span>{pw(load).unit}</span></strong>
              </div>
              <div className="sfm-main-item" onClick={() => onMetric('batteryFlow', 'W', '#c99318')}>
                <small>{t('mobile.battery')}</small>
                <strong className="battery-c">{pw(Math.abs(battery)).value}<span>{pw(Math.abs(battery)).unit}</span></strong>
              </div>
            </div>
          </section>

          {/* Summary tiles */}
          <section className="sfm-summary">
            <div className="item" onClick={() => onMetric('pvEnergyToday', 'kWh', '#38a34b')}><span>{t('mobile.solar')}</span><strong className="solar-c">{fmt(metrics.pvEnergyToday, 1)}<small>kWh</small></strong></div>
            <div className="item" onClick={() => onMetric('homeConsumptionEnergyToday', 'kWh', '#d44728')}><span>{t('mobile.consumption')}</span><strong className="load-c">{fmt(metrics.homeConsumptionEnergyToday ?? metrics.loadEnergyToday, 1)}<small>kWh</small></strong></div>
            <div className="item" onClick={() => onMetric('batterySoc', '%', '#c99318')}><span>{t('mobile.batteryPct')}</span><strong className="battery-c">{soc}</strong></div>
            <div className="item" onClick={() => onMetric('importEnergyToday', 'kWh', '#7f858a')}><span>{t('mobile.grid')}</span><strong className="idle-c">{fmt(metrics.importEnergyToday, 1)}<small>kWh</small></strong></div>
          </section>

          {/* Live flow card (cross layout) */}
          <section className="sfm-card flow-card">
            <div className="head">
              <span>{t('mobile.powerFlow')}</span>
              <small>
                <span className={`dot${isOnline ? ' online' : ''}`} style={{ width: 6, height: 6 }} />
                {t('status.realtime')}
              </small>
            </div>
            <div className="vflow2d">
              <svg className="wires2d" viewBox="0 0 300 320" preserveAspectRatio="none">
                {/* PV (top) → center */}
                <path className={`wire ${pv > 0 ? 'solar' : 'idle'}`} d="M 150 43 L 150 160" />
                {pv > 0 && <path className="flow solar" d="M 150 43 L 150 160" />}
                {/* Battery (left) ↔ center */}
                <path className={`wire ${batteryActive ? 'battery' : 'idle'}`} d="M 43 160 L 150 160" />
                {batteryActive && <path className={`flow battery${battery < 0 ? ' reverse' : ''}`} d="M 43 160 L 150 160" />}
                {/* center → Home (right) */}
                <path className={`wire ${load > 0 ? 'load' : 'idle'}`} d="M 150 160 L 256 160" />
                {load > 0 && <path className="flow load fast" d="M 150 160 L 256 160" />}
                {/* center → Grid (bottom) */}
                <path className={`wire ${gridActive ? 'grid' : 'idle'}`} d="M 150 160 L 150 277" />
                {gridActive && <path className={`flow grid${grid < 0 ? ' reverse' : ''}`} d="M 150 160 L 150 277" />}
                <circle cx="150" cy="160" r="3" fill="#fff" stroke="var(--sf-ink-3)" strokeWidth="1.2" />
              </svg>

              <div className="vnode v2 pv" onClick={() => onMetric('pvPower', 'W', '#38a34b')}>
                <div className="gly sun"><Sun size={14} color="#fff" /></div>
                <div className="name">{t('node.totalPv')}{pvTotalUtil != null ? ` · ${pvTotalUtil}%` : ''}</div>
                <div className="val">{pw(pv).value}<span className="u">{pw(pv).unit}</span></div>
                {pvHasRated ? (
                  <div className="sub" style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, justifyContent: 'center' }}>
                    {pvStrings.map((s, idx) => (
                      <span key={s.i} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
                        {idx > 0 && <span style={{ opacity: 0.45 }}>+</span>}
                        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                          <span>{pw(s.power).value}{pw(s.power).unit}</span>
                          {s.ratedW > 0 && (
                            <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{Math.round((s.power / s.ratedW) * 100)}%</span>
                          )}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="sub">{pvSub}</div>
                )}
              </div>

              <div className="vnode v2 bat" onClick={() => onMetric('batteryFlow', 'W', '#c99318')}>
                <div className={`gly batg${isBatChg ? ' charging' : ''}`} style={{ '--soc': `${soc}%` } as any}>
                  <div className="fill" />
                </div>
                <div className="name">{t('node.battery')}</div>
                <div className="val" style={{ color: 'var(--sf-battery)' }}>{pw(-battery).value}<span className="u">{pw(-battery).unit}</span></div>
                <div className="sub">{soc}% · {batteryState === 'Charging' ? t('state.charging') : batteryState === 'Discharging' ? t('state.discharging') : t('state.standby')}{timeToFullLabel ? ` · ${timeToFullLabel}` : timeToEmptyLabel ? ` · ${timeToEmptyLabel}` : ''}</div>
              </div>

              <div className="vnode v2 inv" onClick={() => onMetric('inverterPower', 'W', '#5ba4d4')}>
                <div className="name">LUXPOWER</div>
                <div className="val">{pw(inverterNet).value}<span className="u">{pw(inverterNet).unit} net</span></div>
                <div className="pbar"><span style={{ width: `${Math.max(6, Math.min(100, pv / 80))}%` }} /></div>
                <div className="sub" style={{ textAlign: 'left' }}>
                  {(radValues.length ? [`${t('node.tempRadiator').trim()}: ${radValues.join(', ')}`] : [])}
                  <br/>
                  {temps.filter(x => x.key === 'bat').map(x => `${x.label}: ${fmt(x.v)}°`)}
                </div>
              </div>

              <div className="vnode v2 load" onClick={() => onMetric('loadPower', 'W', '#d44728')}>
                <div className="gly houseg" />
                <div className="name">{t('node.home')}</div>
                <div className="val" style={{ color: 'var(--sf-load)' }}>{pw(load).value}<span className="u">{pw(load).unit}</span></div>
                <div className="sub">{loadMix(metrics) ? <LoadMix mix={loadMix(metrics)!} /> : t('node.essential')}</div>
              </div>

              <div className="vnode v2 gridn" onClick={() => onMetric('gridFlow', 'W', '#7f858a')}>
                <div className="gly towerg" />
                <div className="name">{t('node.grid')}</div>
                <div className="val" style={{ color: gridActive ? 'var(--sf-ink)' : 'var(--sf-ink-3)' }}>{pw(Math.abs(grid)).value}<span className="u">{pw(Math.abs(grid)).unit}</span></div>
                <div className="sub">{fmt(metrics.gridVoltage, 1)}V · {fmt(metrics.gridFrequency, 2)}Hz</div>
              </div>
            </div>
          </section>

          {/* Today chart */}
          <section className="sfm-chart-card">
            <div className="sfm-chart-head">
              <span className="sfm-chart-title">{t('title.energyToday')}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="sf-nav-day-btn" onClick={() => setSelectedDate(d => addDays(d, -1))}><ChevronLeft size={12} /></button>
                <input
                  type="date" className="sf-date-input"
                  value={dateStr(selectedDate)} max={dateStr(new Date())}
                  onChange={e => { const [y, m, d] = e.target.value.split('-').map(Number); setSelectedDate(new Date(y, m - 1, d)); }}
                />
                <button className="sf-nav-day-btn" onClick={() => setSelectedDate(d => addDays(d, 1))} disabled={isToday(selectedDate)}><ChevronRight size={12} /></button>
              </div>
            </div>
            <EnergyHistoryChart data={chartData} date={selectedDate} height={200} />
          </section>

          {/* Trend chart */}
          <section className="sfm-chart-card">
            <div className="sfm-chart-head">
              <span className="sfm-chart-title">{t('title.energyTrend')}</span>
              <div className="sf-period-toggle">
                {(['day', 'month', 'year'] as TrendPeriod[]).map(p => (
                  <button key={p} className={trendPeriod === p ? 'active' : ''} onClick={() => setTrendPeriod(p)}>
                    {t(`period.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart data={trendData} period={trendPeriod} hiddenSeries={hiddenTrend} onToggle={toggleTrend} height={240} />
          </section>
        </>
      ) : (
        /* STATS tab */
        <div className="sfm-card summary-card" style={{ margin: '0 12px 16px' }}>
          <div className="sfm-list no-pad">
            {[
              { label: t('summary.solarOutput'),     val: `${fmt(metrics.pvEnergyToday, 1)} kWh`,                 color: 'var(--sf-solar)'   },
              { label: t('summary.homeUsage'),       val: `${fmt(metrics.homeConsumptionEnergyToday ?? metrics.loadEnergyToday, 1)} kWh`,               color: 'var(--sf-load)'    },
              { label: t('summary.batCharge'),       val: `${fmt(metrics.batteryChargeEnergyToday, 1)} kWh`,      color: 'var(--sf-battery)' },
              { label: t('summary.batDischarge'),    val: `${fmt(metrics.batteryDischargeEnergyToday, 1)} kWh`,   color: 'var(--sf-battery)' },
              { label: t('summary.gridImport'),      val: `${fmt(metrics.importEnergyToday, 1)} kWh`,             color: 'var(--sf-idle)'    },
              { label: t('summary.gridExport'),      val: `${fmt(metrics.exportEnergyToday, 1)} kWh`,             color: 'var(--sf-solar)'   },
              { label: t('summary.selfSufficiency'), val: `${fmt(selfSufficiency, 0)}%`,                          color: 'var(--sf-solar)'   },
            ].map(row => (
              <div key={row.label} className="sfm-list-row">
                <span>{row.label}</span>
                <b style={{ color: row.color }}>{row.val}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <nav className="sfm-nav">
        <button className={activeTab === 'flow' ? 'active' : ''} onClick={() => setActiveTab('flow')}>
          <span className="icn"><span className="sq" /></span>
          <span>{t('nav.flow')}</span>
        </button>
        <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>
          <span className="icn"><span className="li"><b /><b /><b /></span></span>
          <span>{t('nav.stats')}</span>
        </button>
        <button onClick={() => setConfigOpen(true)}>
          <span className="icn"><Settings size={16} /></span>
          <span>{t('nav.setup')}</span>
        </button>
      </nav>

      {configOpen && (
        <ConfigModal config={config} onClose={() => setConfigOpen(false)} onSaved={() => { onConfigSaved(); setConfigOpen(false); }} />
      )}

      {activeMetric && (
        <MetricModal deviceSn={deviceSn} metric={activeMetric} onClose={() => setActiveMetric(null)} />
      )}
    </div>
  );
}

// ── Main PowerFlow Component ───────────────────────────

interface PowerFlowProps {
  metrics: any;
  config: any;
  deviceSn: string | undefined;
  lastSeenAt: string | null;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  onConfigSaved: () => void;
  themeSkin: ThemeSkin;
  onThemeSkinChange: (skin: ThemeSkin) => void;
}

function DesktopFlow({ metrics, config, deviceSn, lastSeenAt, theme, onThemeToggle, onConfigSaved, themeSkin, onThemeSkinChange }: PowerFlowProps) {
  const t = useT();
  const { pw } = usePowerUnit();
  const now = useNow();
  const weather = useWeather();
  const [hiddenSeries, setHiddenSeries] = useState(new Set<string>());
  const [hiddenTrendSeries, setHiddenTrendSeries] = useState(new Set<string>());
  const [openChart, setOpenChart] = useState<'today' | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('month');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [activeMetric, setActiveMetric] = useState<any>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const chartData = useEnergyChart(deviceSn, selectedDate);
  const trendData = useTrendChart(deviceSn, trendPeriod);

  const toggleSeries = (key: string) =>
    setHiddenSeries(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const onMetric = (metric: string, unit: string, color: string) =>
    setActiveMetric({ metric, unit, color });

  const pv      = n(metrics.pvPower) || (n(metrics.pv1Power) + n(metrics.pv2Power));
  const battery = n(metrics.batteryFlow);
  const grid    = n(metrics.gridFlow);
  const load    = n(metrics.loadPower) || Math.max(pv + grid + battery, 0);

  // Total designed PV power (sum of configured strings) → overall utilisation %.
  const pvTotalRatedW = [0, 1, 2].reduce((sum, i) => sum + n(config?.pvRatedW?.[i]), 0);
  const pvTotalUtil   = pvTotalRatedW > 0 ? Math.round((pv / pvTotalRatedW) * 100) : null;

  const invTotalIn  = pv + n(metrics.batteryDischargePower) + n(metrics.powerFromGrid);
  const invTotalOut = load + n(metrics.batteryChargePower) + n(metrics.epsPower);
  const inverterNet = invTotalIn - invTotalOut;

  const isBatChg = battery < -20;
  const batteryStateLabel = battery < 0 ? t('state.charging') : battery > 0 ? t('state.discharging') : t('state.standby');
  const batteryAbsFmt = pw(Math.abs(battery));
  const batteryPowerSigned = `${battery < 0 ? '+' : battery > 0 ? '-' : ''}${batteryAbsFmt.value} ${batteryAbsFmt.unit}`;

  // ETA labels — "đầy sau" while charging, "cạn sau" (to the discharge floor) while
  // discharging; only one is non-null at a time and only with a known capacity.
  const timeToFullLabel  = fmtDuration(n(metrics.batteryMinutesToFull));
  const timeToEmptyLabel = fmtDuration(n(metrics.batteryMinutesToEmpty));

  const lastSeen  = lastSeenAt ? new Date(lastSeenAt) : null;
  const isOnline  = lastSeen ? (now - lastSeen.getTime() < 15_000) : false;
  const lastTime  = lastSeen ? lastSeen.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

  const homeEnergy   = n(metrics.loadEnergyToday);
  const importEnergy = n(metrics.importEnergyToday);
  const selfSufficiency = homeEnergy > 0 ? Math.max(0, Math.min(100, (1 - importEnergy / homeEnergy) * 100)) : 0;

  const pv1Active      = n(metrics.pv1Power) > 0;
  const pv2Active      = n(metrics.pv2Power) > 0;
  const batteryActive  = battery !== 0;
  const loadActive     = load > 0;
  const gridActive     = Math.abs(grid) > 10;

  const pv1Path      = 'M 98 110 L 98 200 L 177 200 L 177 254';
  const pv2Path      = 'M 254 110 L 254 200 L 177 200';
  const pvToInvPath  = 'M 247 290 L 336 290';
  const batteryPath  = 'M 207 421 L 207 390 L 336 390';
  const loadPath     = 'M 516 290 L 600 290 L 600 70 L 637 70';
  const gridPath     = 'M 516 360 L 600 360 L 600 421 L 637 421';

  return (
    <div className="sf-layout">
      {/* ── Topbar ── */}
      <div className="sf-topbar">
        <div className="sf-topbar-row1">
          <div>
            <div className="sf-crumbs">
              <div className={`sf-status-dot${isOnline ? '' : ' offline'}`} />
              <span>
                {isOnline ? t('status.systemOnline') : lastTime ? t('status.offlineAt', { time: lastTime }) : t('status.waiting')}
              </span>
            </div>
            <h1 className="sf-stage-title">{t('title.powerFlow')}</h1>
          </div>
          <div className="sf-topbar-actions">
            <PowerUnitSwitcher />
            <LanguageSwitcher />
            <ThemeSwitcher themeSkin={themeSkin} onThemeSkinChange={onThemeSkinChange} />
            <button className="sf-btn sf-theme-btn" onClick={onThemeToggle}>
              {theme === 'dark' ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a1 1 0 0 0-1.3-1.3A7 7 0 1 0 14.3 10.8 1 1 0 0 0 13 9.5Z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="3.2"/><g strokeLinecap="round"><line x1="8" y1="1.5" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="14.5" y2="8"/><line x1="3.4" y1="3.4" x2="4.5" y2="4.5"/><line x1="11.5" y1="11.5" x2="12.6" y2="12.6"/><line x1="3.4" y1="12.6" x2="4.5" y2="11.5"/><line x1="11.5" y1="4.5" x2="12.6" y2="3.4"/></g></svg>
              )}
              <span>{theme === 'dark' ? t('common.dark') : t('common.light')}</span>
            </button>
            <button className="sf-btn sf-btn-primary" type="button" onClick={() => setConfigOpen(true)}>
              <Settings size={14} /> {t('common.setup')}
            </button>
          </div>
        </div>

        <div className="sf-topbar-row2">
          <div className="sf-dev-lic">
            <div className="dl-sn">
              <div className="dl-row">
                <span className="dl-lab">{t('config.deviceSn')}</span>
                <span className="dl-val">{deviceSn || config?.deviceSn || '--'}</span>
              </div>
              <div className="dl-row">
                <span className="dl-lab">{t('config.dongleSn')}</span>
                <span className="dl-val">{config?.dongleSn || '--'}</span>
              </div>
              <div className="dl-row">
                <span className="dl-lab">{t('config.inverter')}</span>
                <span className="dl-val">{config?.inverterIp ? `${config.inverterIp}:${config.inverterPort ?? 8000}` : '--'}</span>
              </div>
            </div>
          </div>

          <div className="sf-weather-mini">
            <WeatherGlyph code={weather?.code ?? 0} size={32} />
            <div className="sf-wm-temp">
              <div className="sf-wm-t">{weather ? weather.tempMax : '--'}<span className="sf-wm-deg">°C</span><span className="sf-wm-min">/{weather ? weather.tempMin : '--'}°</span></div>
              <div className="sf-wm-c">{weather ? (weather.city ? `${weather.city} · ${t(`weather.${wmoKey(weather.code)}`)}` : t(`weather.${wmoKey(weather.code)}`)) : '--'}</div>
            </div>
            <div className="sf-wm-sep" />
            <div className="sf-wm-stat"><span className="k">{t('weather.sunset')}</span><span className="v">{weather?.sunset ?? '--:--'}</span></div>
            <div className="sf-wm-stat"><span className="k">{t('weather.uv')}</span><span className="v">{weather?.uv ?? '--'}</span></div>
            <div className="sf-wm-stat"><span className="k">{t('weather.irrad')}</span><span className="v">{weather ? `${weather.irr} kWh/m²` : '--'}</span></div>
          </div>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="solar-flow-dashboard">
        <section className="sf-stage">
          <div className="sf-schematic">
            <svg className="sf-wires" viewBox="0 0 820 540" fill="none" preserveAspectRatio="xMidYMid meet">
              <path className={pv1Active ? 'solar' : 'idle'} d={pv1Path} />
              {pv1Active && <path className="sf-flow solar" d={pv1Path} />}
              <path className={pv2Active ? 'solar' : 'idle'} d={pv2Path} />
              {pv2Active && <path className="sf-flow solar" d={pv2Path} />}
              <path className={pv1Active || pv2Active ? 'solar' : 'idle'} d={pvToInvPath} />
              {(pv1Active || pv2Active) && <path className="sf-flow solar" d={pvToInvPath} />}
              <path className={batteryActive ? 'battery' : 'idle'} d={batteryPath} />
              {batteryActive && <path className={`sf-flow battery${battery < 0 ? ' reverse' : ''}`} d={batteryPath} />}
              <path className={loadActive ? 'load' : 'idle'} d={loadPath} />
              {loadActive && <path className="sf-flow load fast" d={loadPath} />}
              <path className={gridActive ? 'grid' : 'idle'} d={gridPath} />
              {gridActive && <path className={`sf-flow grid${grid > 0 ? ' reverse' : ''}`} d={gridPath} />}
              <circle className="sf-junction solar" cx="177" cy="200" r="4" />
              <circle className="sf-junction load"  cx="600" cy="290" r="4" />
              <circle className="sf-junction idle"  cx="600" cy="360" r="4" />
            </svg>

            <div className="sf-wire-label pv-main"><span className="arr">→</span>{pw(pv).value} {pw(pv).unit}</div>
            <div className="sf-wire-label battery-main"><span className="arr">{battery < 0 ? '←' : '→'}</span>{batteryPowerSigned} · {batteryStateLabel.toLowerCase()}</div>
            <div className="sf-wire-label load-main"><span className="arr">→</span>{pw(load).value} {pw(load).unit}</div>
            <div className="sf-wire-label grid-main"><span className="arr">◦</span>{gridActive ? `${pw(Math.abs(grid)).value} ${pw(Math.abs(grid)).unit}` : `${pw(0).value} ${pw(0).unit} ${t('node.idleLower')}`}</div>

            {/* PV Strings */}
            <div className="sf-pv-string-row">
              {[1, 2].map(i => {
                const power   = n(metrics[`pv${i}Power`]);
                const voltage = n(metrics[`pv${i}Voltage`]);
                const active  = power > 0 || voltage > 0;
                const current = voltage > 0 ? power / voltage : 0;
                const ratedW  = n(config?.pvRatedW?.[i - 1]);
                const util    = ratedW > 0 ? Math.round((power / ratedW) * 100) : null;
                return (
                  <button
                    key={i} type="button"
                    className={`sf-string${active ? ' active' : ''}`}
                    style={{ opacity: active ? 1 : 0.35, pointerEvents: active ? 'auto' : 'none' }}
                    onClick={() => onMetric(`pv${i}Power`, 'W', '#38a34b')}
                  >
                    <div className="sf-label">
                      <span>{t('node.pvString', { n: i })}</span>
                      <span className="sf-tag">{util != null ? `${util}%` : `MPPT ${i}`}</span>
                    </div>
                    <div className="sf-pv-val-row">
                      <strong className="mono">{pw(power).value}<small className="unit"> {pw(power).unit}</small></strong>
                    </div>
                    <small className="sf-sub mono">
                      {voltage.toFixed(1)} V · {current.toFixed(2)} A{ratedW > 0 ? ` · ${ratedW}Wp` : ''}
                    </small>
                  </button>
                );
              })}
            </div>

            <Node
              className="solar"
              label={t('node.pvTotal')}
              value={pw(pv).value}
              unit={` ${pw(pv).unit}`}
              tag={pvTotalUtil != null ? `${pvTotalUtil}%` : t('node.dc')}
              sub={pv > 0 ? '' : t('node.noSolar')}
              glyph="sun"
              onClick={() => onMetric('pvPower', 'W', '#38a34b')}
            />

            <div className="sf-inverter" onClick={() => onMetric('inverterPower', 'W', '#5ba4d4')} role="button" tabIndex={0}>
              <div className="iv-label">{t('node.inverterHybrid')}</div>
              <div className="iv-name">LUXPOWER</div>
              <div className="iv-power">{pw(inverterNet).value}<small>{pw(inverterNet).unit}</small></div>
              <div className="iv-bar"><span style={{ width: `${Math.max(6, Math.min(100, pv / 80))}%` }} /></div>
              <div className="iv-meta">
                {tempReadings(metrics, t).map(x => (
                  <span key={x.key}><b>{x.label}</b> {fmt(x.v)}°C</span>
                ))}
              </div>
            </div>

            <button className="sf-battery-node" type="button" onClick={() => onMetric('batteryFlow', 'W', '#c99318')}>
              <div className="sf-label">
                <div className="sf-label-left"><span>{t('node.batteryBank')}</span></div>
              </div>
              <div className="sf-bat-vis">
                <div className="sf-bat-shell">
                  <span
                    className={isBatChg ? 'charging' : ''}
                    style={{ width: `${Math.max(0, Math.min(100, n(metrics.batterySoc)))}%` }}
                  />
                </div>
                <div className="sf-bat-pct">{fmt(metrics.batterySoc)}<small>%</small></div>
              </div>
              <div className="sf-bat-rows">
                <span>{t('battery.state')}</span><b>{batteryStateLabel} {timeToFullLabel ?? timeToEmptyLabel ?? ''}</b>
                <span>{t('battery.power')}</span><b>{batteryPowerSigned}</b>
                <span>{t('battery.dcVolt')}</span><b>{fmt(metrics.batteryVoltage, 1)} V</b>
              </div>
            </button>

            <Node
              className="load"
              label={t('node.homeLoad')}
              value={pw(load).value}
              unit={` ${pw(load).unit}`}
              tag={t('node.essential')}
              sub={loadMix(metrics) ? <LoadMix mix={loadMix(metrics)!} /> : (load > 0 ? '' : t('node.idle'))}
              glyph="house"
              onClick={() => onMetric('loadPower', 'W', '#d44728')}
            />

            <button className="sf-grid-node" type="button" onClick={() => onMetric('gridFlow', 'W', '#7f858a')}>
              <div className="sf-label">
                <div className="sf-label-left">
                  <span className="sf-glyph tower" />
                  <span>{t('node.grid')}</span>
                </div>
                <span className={`sf-tag${gridActive ? ' online' : ''}`}>{gridActive ? t('node.active') : t('node.idle')}</span>
              </div>
              <div className="sf-grid-main">
                <div className="sf-value mono">{pw(Math.abs(grid)).value}<small className="unit"> {pw(Math.abs(grid)).unit}</small></div>
                <div className="sf-sub">{grid > 0 ? t('grid.exporting') : grid < 0 ? t('grid.importing') : t('grid.idle')}</div>
              </div>
              <div className="sf-grid-meta">
                <span>{fmt(metrics.gridVoltage, 1)} V</span>
                <span className="sep">·</span>
                <span>{fmt(metrics.gridFrequency, 2)} Hz</span>
              </div>
            </button>
          </div>

          <div className="sf-status-bar">
            <div className="left">
              <span>{t('bms.charge')} <b>{metrics.bmsChargeStatus || 'OK'}</b></span>
              <span>{t('bms.discharge')} <b>{metrics.bmsDischargeStatus || 'OK'}</b></span>
              <span>{t('bms.state')} <b>{metrics.inverterState || '--'}</b></span>
            </div>
            <div className="right mono">
              PV1 <b>{fmt(metrics.pv1Voltage, 1)} V</b> · PV2 <b>{fmt(metrics.pv2Voltage, 1)} V</b> |
              Grid <b>{fmt(metrics.gridVoltage, 1)} V</b> · Bat <b>{fmt(metrics.batteryVoltage, 1)} V</b> · SOC <b>{n(metrics.batterySoc)}%</b>
            </div>
          </div>
        </section>

        {/* Sidebar */}
        <aside className="sf-side">
          <section className="sf-card">
            <div className="sf-card-head">
              <span className="sf-card-title">{t('tiles.now')}</span>
              <small className="sf-card-link">{t('status.live')}</small>
            </div>
            <div className="sf-tiles">
              <div className="sf-tile" onClick={() => onMetric('pvPower', 'W', '#38a34b')}>
                <div className="t-head">
                  <div className="t-lab">{t('tiles.production')}</div>
                  <Sun size={14} className="t-ico" style={{ color: 'var(--sf-solar)' }} />
                </div>
                <div className="t-val mono">{pw(pv).value}<span className="unit">{pw(pv).unit}</span></div>
                <div className="t-bar"><div className="fill" style={{ width: `${Math.min(100, pv / 80)}%`, background: 'var(--sf-solar)' }} /></div>
              </div>
              <div className="sf-tile" onClick={() => onMetric('loadPower', 'W', '#d44728')}>
                <div className="t-head">
                  <div className="t-lab">{t('tiles.consumption')}</div>
                  <Home size={14} className="t-ico" style={{ color: 'var(--sf-load)' }} />
                </div>
                <div className="t-val mono">{pw(load).value}<span className="unit">{pw(load).unit}</span></div>
                <div className="t-bar"><div className="fill" style={{ width: `${Math.min(100, load / 60)}%`, background: 'var(--sf-load)' }} /></div>
              </div>
              <div className="sf-tile" onClick={() => onMetric('batteryFlow', 'W', '#c99318')}>
                <div className="t-head">
                  <div className="t-lab">{t('tiles.toBattery')}</div>
                  <BatteryCharging size={14} className="t-ico" style={{ color: 'var(--sf-battery)' }} />
                </div>
                <div className="t-val mono">{pw(Math.max(0, -battery)).value}<span className="unit">{pw(Math.max(0, -battery)).unit}</span></div>
                <div className="t-bar"><div className="fill" style={{ width: `${Math.min(100, Math.max(0, -battery) / 50)}%`, background: 'var(--sf-battery)' }} /></div>
              </div>
              <div className="sf-tile" onClick={() => onMetric('gridFlow', 'W', '#7f858a')}>
                <div className="t-head">
                  <div className="t-lab">{t('tiles.gridNet')}</div>
                  <Zap size={14} className="t-ico" style={{ color: grid === 0 ? 'var(--sf-ink-3)' : 'var(--sf-idle)' }} />
                </div>
                <div className="t-val mono" style={{ color: grid === 0 ? 'var(--sf-ink-3)' : 'inherit' }}>
                  {pw(Math.abs(grid)).value}<span className="unit">{pw(Math.abs(grid)).unit}</span>
                </div>
                <div className="t-bar"><div className="fill" style={{ width: `${Math.min(100, Math.abs(grid) / 50)}%` }} /></div>
              </div>
            </div>
          </section>

          <section className="sf-card">
            <div className="sf-card-head">
              <span className="sf-card-title">{t('summary.title')}</span>
              <small className="sf-card-link">{t('summary.todayTotal')}</small>
            </div>
            <div className="sf-stat-row">
              <span className="lab">{t('summary.solarOutput')}</span>
              <span className="val solar-c mono">{fmt(metrics.pvEnergyToday, 1)}<span className="unit"> kWh</span></span>
            </div>
            <div className="sf-stat-row">
              <span className="lab">{t('summary.homeUsage')}</span>
              <span className="val load-c mono">{fmt(metrics.homeConsumptionEnergyToday ?? metrics.loadEnergyToday, 1)}<span className="unit"> kWh</span></span>
            </div>
            <div className="sf-stat-row">
              <span className="lab">{t('summary.batteryCycle')}</span>
              <span className="val battery-c mono">{fmt(metrics.batteryChargeEnergyToday, 1)} <span className="sep">/</span> {fmt(metrics.batteryDischargeEnergyToday, 1)}<span className="unit"> kWh</span></span>
            </div>
            <div className="sf-stat-row">
              <span className="lab">{t('summary.gridImport')}</span>
              <span className="val mono">{fmt(metrics.importEnergyToday, 1)}<span className="unit"> kWh</span></span>
            </div>
            <div className="sf-stat-row">
              <span className="lab">{t('summary.gridExport')}</span>
              <span className="val solar-c mono">{fmt(metrics.exportEnergyToday, 1)}<span className="unit"> kWh</span></span>
            </div>
            <div className="sf-stat-row">
              <span className="lab">{t('summary.selfSufficiency')}</span>
              <span className="val mono" style={{ color: 'var(--sf-solar)' }}>{fmt(selfSufficiency, 0)}<span className="unit">%</span></span>
            </div>
          </section>
        </aside>
      </div>

      {/* ── Charts row ── */}
      <div className="sf-charts-row">
        <section className="sf-chart-card" style={{ flex: '0 0 55%' }}>
          <div className="sf-card-head" style={{ alignItems: 'flex-start', marginBottom: 0 }}>
            <div className="sf-card-title">{t('title.historyToday')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="sf-nav-day-btn" onClick={() => setSelectedDate(d => addDays(d, -1))}><ChevronLeft size={13} /></button>
              <input
                type="date"
                className="sf-date-input"
                value={dateStr(selectedDate)}
                max={dateStr(new Date())}
                onChange={e => {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  setSelectedDate(new Date(y, m - 1, d));
                }}
              />
              <button className="sf-nav-day-btn" onClick={() => setSelectedDate(d => addDays(d, 1))} disabled={isToday(selectedDate)}><ChevronRight size={13} /></button>
              <button className="sf-expand-btn" onClick={() => setOpenChart('today')} title={t('common.expand')}><Maximize2 size={13} /></button>
            </div>
          </div>
          <div className="sf-now-strip">
            {[
              { key: 'solar',   color: 'var(--sf-solar)',   label: t('chart.solar'),   val: `${pw(pv).value} ${pw(pv).unit}` },
              { key: 'battery', color: 'var(--sf-battery)', label: t('chart.battery'), val: `${pw(-battery).value} ${pw(-battery).unit}` },
              { key: 'load',    color: 'var(--sf-load)',    label: t('chart.home'),    val: `${pw(load).value} ${pw(load).unit}` },
              { key: 'grid',    color: 'var(--sf-idle)',    label: t('chart.grid'),    val: `${pw(Math.abs(grid)).value} ${pw(Math.abs(grid)).unit}` },
              { key: 'soc',     color: '#06b6d4',           label: t('chart.soc'),     val: `${n(metrics.batterySoc)}%` },
            ].map(item => (
              <div
                key={item.key}
                className={`sf-ns-item${hiddenSeries.has(item.key) ? ' dim' : ''}`}
                onClick={() => toggleSeries(item.key)}
              >
                <div className="k"><span className="dotsq" style={{ background: item.color }} />{item.label}</div>
                <div className="v mono" style={{ color: item.color }}>{item.val}</div>
              </div>
            ))}
          </div>
          <EnergyHistoryChart data={chartData} hiddenSeries={hiddenSeries} date={selectedDate} />
        </section>

        <section className="sf-chart-card" style={{ flex: 1 }}>
          <div className="sf-card-head" style={{ alignItems: 'center', marginBottom: 0 }}>
            <div className="sf-card-title">{t('title.historyTrend')}</div>
            <div className="sf-period-toggle">
              {(['day', 'month', 'year'] as TrendPeriod[]).map(p => (
                <button key={p} className={trendPeriod === p ? 'active' : ''} onClick={() => setTrendPeriod(p)}>
                  {t(`period.${p}`)}
                </button>
              ))}
            </div>
          </div>
          <TrendChart
            data={trendData}
            period={trendPeriod}
            hiddenSeries={hiddenTrendSeries}
            onToggle={k => setHiddenTrendSeries(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; })}
          />
        </section>
      </div>

      {/* ── Expanded today chart modal ── */}
      {openChart === 'today' && (
        <ChartModal title={t('title.historyToday')} onClose={() => setOpenChart(null)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12, marginBottom: 4 }}>
            <button className="sf-nav-day-btn" onClick={() => setSelectedDate(d => addDays(d, -1))}><ChevronLeft size={13} /></button>
            <input
              type="date" className="sf-date-input"
              value={dateStr(selectedDate)} max={dateStr(new Date())}
              onChange={e => { const [y, m, d] = e.target.value.split('-').map(Number); setSelectedDate(new Date(y, m - 1, d)); }}
            />
            <button className="sf-nav-day-btn" onClick={() => setSelectedDate(d => addDays(d, 1))} disabled={isToday(selectedDate)}><ChevronRight size={13} /></button>
          </div>
          <div className="sf-now-strip" style={{ marginTop: 8 }}>
            {[
              { key: 'solar',   color: 'var(--sf-solar)',   label: t('chart.solar'),   val: `${pw(pv).value} ${pw(pv).unit}` },
              { key: 'battery', color: 'var(--sf-battery)', label: t('chart.battery'), val: `${pw(-battery).value} ${pw(-battery).unit}` },
              { key: 'load',    color: 'var(--sf-load)',    label: t('chart.home'),    val: `${pw(load).value} ${pw(load).unit}` },
              { key: 'grid',    color: 'var(--sf-idle)',    label: t('chart.grid'),    val: `${pw(Math.abs(grid)).value} ${pw(Math.abs(grid)).unit}` },
              { key: 'soc',     color: '#06b6d4',           label: t('chart.soc'),     val: `${n(metrics.batterySoc)}%` },
            ].map(item => (
              <div
                key={item.key}
                className={`sf-ns-item${hiddenSeries.has(item.key) ? ' dim' : ''}`}
                onClick={() => toggleSeries(item.key)}
              >
                <div className="k"><span className="dotsq" style={{ background: item.color }} />{item.label}</div>
                <div className="v mono">{item.val}</div>
              </div>
            ))}
          </div>
          <EnergyHistoryChart data={chartData} hiddenSeries={hiddenSeries} date={selectedDate} height={480} />
        </ChartModal>
      )}

      {/* ── Config modal ── */}
      {configOpen && (
        <ConfigModal
          config={config}
          onClose={() => setConfigOpen(false)}
          onSaved={onConfigSaved}
        />
      )}

      {/* ── Single-metric history modal ── */}
      {activeMetric && (
        <MetricModal deviceSn={deviceSn} metric={activeMetric} onClose={() => setActiveMetric(null)} />
      )}
    </div>
  );
}

export default function PowerFlow(props: PowerFlowProps) {
  const mobile = useIsMobile();
  return mobile ? <MobileFlow {...props} /> : <DesktopFlow {...props} />;
}
