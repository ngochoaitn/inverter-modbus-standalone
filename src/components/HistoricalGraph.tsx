'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { X } from 'lucide-react';

function toLocalDateTimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toNumeric(value: any) {
  if (value === true || value === 'true' || value === 'on') return 1;
  if (value === false || value === 'false' || value === 'off') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default function HistoricalGraph({ deviceSn, metric, label, unit, color, onClose, hideClose }: any) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const fetchHistory = async (from: string, to: string) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      // In local version, we use our historical readings API
      const res = await fetch(`/api/history?deviceSn=${deviceSn}&metric=${metric}&from=${from}&to=${to}`, { signal: controller.signal });
      const history = await res.json();
      
      const processed: any[] = [];
      const GAP_MS = 5 * 60 * 1000;
      for (let i = 0; i < history.length; i++) {
        const item = history[i];
        const ts = new Date(item.timestamp).getTime();
        if (i > 0) {
          const prev = new Date(history[i - 1].timestamp).getTime();
          if (ts - prev > GAP_MS) {
            processed.push({ timestamp: prev + 1000, value: null });
            processed.push({ timestamp: ts - 1000, value: null });
          }
        }
        processed.push({ timestamp: ts, value: toNumeric(item.value) });
      }
      setData(processed);
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const setLast24h = () => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    setFromValue(toLocalDateTimeValue(from));
    setToValue(toLocalDateTimeValue(to));
    fetchHistory(from.toISOString(), to.toISOString());
  };

  useEffect(() => { setLast24h(); }, [deviceSn, metric]);

  const applyRange = () => {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return;
    fetchHistory(from.toISOString(), to.toISOString());
  };

  const fmtTick = (v: any) => new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (v: any) => new Date(v).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const hasNeg = data.some(d => d.value != null && d.value < 0);
  const yVals = data.filter(d => d.value != null).map(d => d.value);
  const yMin = yVals.length ? Math.min(...yVals) : 0;
  const yMax = yVals.length ? Math.max(...yVals) : 0;
  const pad = (yMax - yMin) * 0.12 || 1;
  const yDomain = [Math.floor((yMin - pad) * 10) / 10, Math.ceil((yMax + pad) * 10) / 10];

  return (
    <div className="hg-panel">
      {/* Header */}
      <div className="hg-head">
        <div className="hg-head-left">
          <div className="hg-metric">{label}</div>
          <div className="hg-sub">
            <span className="hg-sn">{deviceSn}</span>
            {unit && <span className="hg-unit-chip">{unit}</span>}
          </div>
        </div>
        <div className="hg-head-right">
          <div className="hg-range">
            <div className="hg-range-field">
              <span className="hg-range-lbl">Từ</span>
              <input type="datetime-local" className="sf-date-input bg-transparent border border-white/10 rounded px-2 py-1 text-[10px]" value={fromValue} onChange={e => setFromValue(e.target.value)} />
            </div>
            <div className="hg-range-field">
              <span className="hg-range-lbl">Đến</span>
              <input type="datetime-local" className="sf-date-input bg-transparent border border-white/10 rounded px-2 py-1 text-[10px]" value={toValue} onChange={e => setToValue(e.target.value)} />
            </div>
            <div className="hg-range-btns">
              <button className="hg-apply-btn" onClick={applyRange}>Áp dụng</button>
              <button className="hg-apply-btn" onClick={setLast24h}>24h qua</button>
            </div>
          </div>
          {!hideClose && (
            <button className="sf-expand-btn p-2 hover:bg-white/5 rounded" onClick={onClose}><X size={14} /></button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="hg-chart">
        {loading ? (
          <div className="hg-loading">Đang tải lịch sử...</div>
        ) : data.length === 0 ? (
          <div className="hg-loading">Không có dữ liệu</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="hg-area-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" vertical={false} />
              <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }} tickLine={false} axisLine={{ stroke: 'var(--sf-line)' }} minTickGap={48} />
              <YAxis domain={yDomain} tick={{ fontSize: 9, fill: 'var(--sf-ink-3)', fontFamily: 'JetBrains Mono,monospace' }} axisLine={false} tickLine={false} width={46} tickFormatter={v => `${v}${unit ? ` ${unit}` : ''}`} />
              {hasNeg && <ReferenceLine y={0} stroke="var(--sf-line)" strokeWidth={1} />}
              <Tooltip cursor={{ stroke: 'var(--sf-ink)', strokeWidth: 0.8, strokeDasharray: '4 3' }} contentStyle={{ background: 'var(--sf-panel)', border: '1px solid var(--sf-line)', borderRadius: 4, fontSize: 11, padding: '6px 10px' }} labelFormatter={fmtDate} formatter={(v: any) => v == null ? ['--', label] : [`${v}${unit ? ` ${unit}` : ''}`, label]} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.8} fill="url(#hg-area-fill)" dot={false} activeDot={{ r: 3, fill: color, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
