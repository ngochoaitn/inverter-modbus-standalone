'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, X } from 'lucide-react';
import { METRIC_CATALOG, METRIC_COLORS, resolveMetric } from '@/lib/historyMetrics';

const MAX_METRICS = 5;
const GAP_MS = 5 * 60 * 1000;

interface Entity { key: string; label: string; unit: string; color: string; }

function toLocalDateTimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toNumeric(value: any): number | null {
  if (value === true || value === 'true' || value === 'on') return 1;
  if (value === false || value === 'false' || value === 'off') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// Pick the first palette colour not already used by an entity.
function nextColor(entities: Entity[]): string {
  const used = new Set(entities.map(e => e.color));
  return METRIC_COLORS.find(c => !used.has(c)) || METRIC_COLORS[entities.length % METRIC_COLORS.length];
}

async function fetchSeries(deviceSn: string, key: string, from: string, to: string, signal: AbortSignal) {
  const res = await fetch(`/api/history?deviceSn=${deviceSn}&metric=${key}&from=${from}&to=${to}`, { signal });
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

export default function HistoricalGraph({ deviceSn, metric, label, unit, color, onClose, hideClose }: any) {
  const [entities, setEntities] = useState<Entity[]>(() =>
    metric
      ? [{ key: metric, label: label || resolveMetric(metric).label, unit: unit ?? resolveMetric(metric).unit, color: color || METRIC_COLORS[0] }]
      : [],
  );
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [range, setRange] = useState(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString(), to: to.toISOString() };
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFromValue(toLocalDateTimeValue(new Date(range.from)));
    setToValue(toLocalDateTimeValue(new Date(range.to)));
  }, [range]);

  const entityKeys = entities.map(e => e.key).join(',');

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    if (!entities.length) { setRows([]); setLoading(false); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const results = await Promise.all(
        entities.map(e => fetchSeries(deviceSn, e.key, range.from, range.to, controller.signal).catch(() => [])),
      );
      const byTime = new Map<number, any>();
      results.forEach((series, idx) => {
        const key = entities[idx].key;
        for (const point of series) {
          const ts = new Date(point.timestamp).getTime();
          let row = byTime.get(ts);
          if (!row) { row = { timestamp: ts }; byTime.set(ts, row); }
          row[key] = toNumeric(point.value);
        }
      });
      const sorted = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
      const withGaps: any[] = [];
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i].timestamp - sorted[i - 1].timestamp > GAP_MS) {
          withGaps.push({ timestamp: sorted[i - 1].timestamp + 1000 });
          withGaps.push({ timestamp: sorted[i].timestamp - 1000 });
        }
        withGaps.push(sorted[i]);
      }
      setRows(withGaps);
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSn, range, entityKeys]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const setLast24h = () => {
    const to = new Date();
    setRange({ from: new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString(), to: to.toISOString() });
  };

  const applyRange = () => {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return;
    setRange({ from: from.toISOString(), to: to.toISOString() });
  };

  const addMetric = (key: string) => {
    setEntities(prev => {
      if (prev.length >= MAX_METRICS || prev.some(e => e.key === key)) return prev;
      const m = resolveMetric(key);
      return [...prev, { key, label: m.label, unit: m.unit ?? '', color: nextColor(prev) }];
    });
    setPickerOpen(false);
    setSearch('');
  };

  const removeMetric = (key: string) =>
    setEntities(prev => (prev.length <= 1 ? prev : prev.filter(e => e.key !== key)));

  // Axis assignment: when entities span >1 unit, the second unit goes to the right axis.
  const units = [...new Set(entities.map(e => e.unit))];
  const rightUnit = units.length > 1 ? units[1] : null;
  const axisOf = (e: Entity) => (rightUnit && e.unit === rightUnit ? 'right' : 'left');
  const leftEntities = entities.filter(e => axisOf(e) === 'left');
  const rightEntities = entities.filter(e => axisOf(e) === 'right');
  const leftUnit = units[0] ?? '';

  const domainOf = (keys: string[]): [number, number] => {
    const vals: number[] = [];
    for (const row of rows) for (const k of keys) {
      if (row[k] != null && Number.isFinite(row[k])) vals.push(row[k]);
    }
    if (!vals.length) return [0, 1];
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.12 || 1;
    return [Math.floor((min - pad) * 10) / 10, Math.ceil((max + pad) * 10) / 10];
  };
  const leftDomain = domainOf(leftEntities.map(e => e.key));
  const rightDomain = domainOf(rightEntities.map(e => e.key));
  const hasNeg = leftDomain[0] < 0 || rightDomain[0] < 0;

  const entityByKey = useMemo(() => Object.fromEntries(entities.map(e => [e.key, e])), [entities]);
  const fmtTick = (v: any) => new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (v: any) => new Date(v).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const title = entities.length === 1 ? entities[0].label : `${entities.length} chỉ số`;
  const activeKeys = new Set(entities.map(e => e.key));
  const q = search.trim().toLowerCase();

  return (
    <div className="hg-panel">
      {/* Header */}
      <div className="hg-head">
        <div className="hg-head-left">
          <div className="hg-metric">{title}</div>
          <div className="hg-sub"><span className="hg-sn">{deviceSn}</span></div>
        </div>
        <div className="hg-head-right">
          <div className="hg-range">
            <div className="hg-range-field">
              <span className="hg-range-lbl">Từ</span>
              <input type="datetime-local" className="sf-date-input" value={fromValue} onChange={e => setFromValue(e.target.value)} />
            </div>
            <div className="hg-range-field">
              <span className="hg-range-lbl">Đến</span>
              <input type="datetime-local" className="sf-date-input" value={toValue} onChange={e => setToValue(e.target.value)} />
            </div>
            <div className="hg-range-btns">
              <button className="hg-apply-btn" onClick={applyRange}>Áp dụng</button>
              <button className="hg-apply-btn" onClick={setLast24h}>24h qua</button>
            </div>
          </div>
          {!hideClose && (
            <button className="sf-expand-btn" onClick={onClose}><X size={14} /></button>
          )}
        </div>
      </div>

      {/* Legend + add-metric picker */}
      <div className="hg-legend">
        {entities.map(e => (
          <span key={e.key} className="hg-chip" style={{ borderColor: `${e.color}66` }}>
            <span className="hg-chip-dot" style={{ background: e.color }} />
            <span className="hg-chip-lbl">{e.label}</span>
            {e.unit && <span className="hg-chip-unit">{e.unit}</span>}
            {entities.length > 1 && (
              <button className="hg-chip-x" onClick={() => removeMetric(e.key)} title="Bỏ"><X size={11} /></button>
            )}
          </span>
        ))}
        {entities.length < MAX_METRICS && (
          <div className="hg-add-wrap" ref={pickerRef}>
            <button className="hg-add-btn" onClick={() => setPickerOpen(o => !o)}>
              <Plus size={13} /> Thêm chỉ số
            </button>
            {pickerOpen && (
              <div className="hg-picker">
                <input
                  autoFocus autoComplete="off" className="hg-picker-search"
                  placeholder="Tìm chỉ số…" value={search} onChange={e => setSearch(e.target.value)}
                />
                <div className="hg-picker-list">
                  {METRIC_CATALOG.map(group => {
                    const items = group.items.filter(it =>
                      !activeKeys.has(it.key) && (!q || it.label.toLowerCase().includes(q) || it.key.toLowerCase().includes(q)),
                    );
                    return items.length ? (
                      <div key={group.group} className="hg-picker-group">
                        <div className="hg-picker-group-title">{group.group}</div>
                        {items.map(it => (
                          <button key={it.key} className="hg-picker-item" onClick={() => addMetric(it.key)}>
                            <span>{it.label}</span>
                            {it.unit && <span className="hg-picker-unit">{it.unit}</span>}
                          </button>
                        ))}
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="hg-chart">
        {loading ? (
          <div className="hg-loading">Đang tải lịch sử...</div>
        ) : rows.length === 0 ? (
          <div className="hg-loading">Không có dữ liệu</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: rightEntities.length ? 8 : 4, left: 0, bottom: 0 }}>
              <defs>
                {entities.map(e => (
                  <linearGradient key={e.key} id={`hg-fill-${e.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={e.color} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={e.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" vertical={false} />
              <XAxis
                dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tickFormatter={fmtTick} tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }}
                tickLine={false} axisLine={{ stroke: 'var(--sf-line)' }} minTickGap={48}
              />
              <YAxis
                yAxisId="left" domain={leftDomain}
                tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }}
                axisLine={false} tickLine={false} width={46} tickFormatter={v => `${v}${leftUnit ? ` ${leftUnit}` : ''}`}
              />
              {rightEntities.length > 0 && (
                <YAxis
                  yAxisId="right" orientation="right" domain={rightDomain}
                  tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }}
                  axisLine={false} tickLine={false} width={46} tickFormatter={v => `${v}${rightUnit ? ` ${rightUnit}` : ''}`}
                />
              )}
              {hasNeg && <ReferenceLine yAxisId="left" y={0} stroke="var(--sf-line)" strokeWidth={1} />}
              <Tooltip
                cursor={{ stroke: 'var(--sf-ink)', strokeWidth: 0.8, strokeDasharray: '4 3' }}
                contentStyle={{ background: 'var(--sf-panel)', border: '1px solid var(--sf-line)', borderRadius: 4, fontSize: 11, padding: '6px 10px' }}
                labelFormatter={fmtDate}
                formatter={(v: any, name: any) => {
                  const e = entityByKey[name] || {};
                  return [v == null ? '--' : `${v}${e.unit ? ` ${e.unit}` : ''}`, e.label || name];
                }}
              />
              {entities.length === 1 ? (
                <Area
                  yAxisId={axisOf(entities[0])} type="monotone" dataKey={entities[0].key} name={entities[0].key}
                  stroke={entities[0].color} strokeWidth={1.8} fill={`url(#hg-fill-${entities[0].key})`}
                  dot={false} activeDot={{ r: 3, fill: entities[0].color, strokeWidth: 0 }}
                  isAnimationActive={false} connectNulls={false}
                />
              ) : entities.map(e => (
                <Line
                  key={e.key} yAxisId={axisOf(e)} type="monotone" dataKey={e.key} name={e.key}
                  stroke={e.color} strokeWidth={1.8} dot={false}
                  activeDot={{ r: 3, fill: e.color, strokeWidth: 0 }}
                  isAnimationActive={false} connectNulls={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
