import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { T } from '../lib/i18n';
import { fmtDateShort } from '../lib/format';
import type { Lang } from '../domain/types';

const AXIS = { stroke: '#939b95', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' };
const GRID = '#edeee9';

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: '7px 10px', fontSize: 12 }}>
      <div className="muted-2 small">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="row nowrap" style={{ gap: 6 }}>
          <i className="dot" style={{ background: p.color }} />
          <span className="muted">{p.name}</span>
          <strong style={{ marginLeft: 'auto' }}>{p.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function HealthTrendChart({
  data,
  t,
  lang,
  height = 232,
}: {
  data: { date: string; scans: number; high: number; moderate: number; healthy: number }[];
  t: T;
  lang: Lang;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gHealthy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3aa96b" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#3aa96b" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gModerate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d99b1c" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#d99b1c" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gHigh" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c0392b" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#c0392b" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={(v: string) => fmtDateShort(v, lang)} minTickGap={22} />
        <YAxis tick={AXIS} allowDecimals={false} />
        <Tooltip content={<TooltipBox />} />
        <Legend wrapperStyle={{ fontSize: 11.5 }} />
        <Area type="monotone" dataKey="high" name={t('chart.high')} stroke="#b3261e" fill="url(#gHigh)" strokeWidth={1.8} />
        <Area type="monotone" dataKey="moderate" name={t('chart.moderate')} stroke="#b47100" fill="url(#gModerate)" strokeWidth={1.8} />
        <Area type="monotone" dataKey="healthy" name={t('chart.healthy')} stroke="#2f8f5b" fill="url(#gHealthy)" strokeWidth={1.8} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ConditionBars({
  data,
  height = 250,
}: {
  data: { label: string; count: number; group: string }[];
  height?: number;
}) {
  const colorFor = (g: string) =>
    g === 'pest' ? '#b47100' : g === 'disease' ? '#b3261e' : g === 'disorder' ? '#1f5f8b' : g === 'healthy' ? '#2f8f5b' : '#6b746d';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 22, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={{ ...AXIS, fontSize: 11 }} width={168} />
        <Tooltip content={<TooltipBox />} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorFor(d.group)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RiskDonut({
  data,
  t,
  height = 210,
}: {
  data: { level: string; count: number }[];
  t: T;
  height?: number;
}) {
  const colors: Record<string, string> = { high: '#b3261e', medium: '#d99b1c', low: '#2f8f5b' };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="level" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {data.map((d, i) => (
            <Cell key={i} fill={colors[d.level] ?? '#6b746d'} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11.5 }} formatter={(v: string) => t(`risk.${v}`)} />
        <Tooltip content={<TooltipBox />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RiskTrendChart({
  data,
  t,
  lang,
  height = 240,
}: {
  data: { date: string; score: number; kind: string }[];
  t: T;
  lang: Lang;
  height?: number;
}) {
  const observedEnd = data.findIndex((d) => d.kind !== 'observed' && d.kind !== 'simulated');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={(v: string) => fmtDateShort(v, lang)} minTickGap={18} />
        <YAxis domain={[0, 100]} tick={AXIS} />
        <Tooltip content={<TooltipBox />} />
        <Legend wrapperStyle={{ fontSize: 11.5 }} />
        <Line type="monotone" dataKey="score" name={t('risk.score')} stroke="#17543c" strokeWidth={2.2} dot={{ r: 2.5 }} />
        {observedEnd >= 0 && (
          <Line
            type="monotone"
            dataKey={(d: { date: string; score: number; kind: string }) => (d.kind === 'forecast' ? d.score : null)}
            name={t('risk.forecast')}
            stroke="#1f5f8b"
            strokeWidth={2.2}
            strokeDasharray="4 3"
            dot={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TrapTrendChart({
  data,
  t,
  lang,
  threshold,
  height = 220,
}: {
  data: { date: string; count: number }[];
  t: T;
  lang: Lang;
  threshold?: number | null;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={(v: string) => fmtDateShort(v, lang)} minTickGap={12} />
        <YAxis tick={AXIS} allowDecimals={false} />
        <Tooltip content={<TooltipBox />} />
        <Bar dataKey="count" name={t('traps.count')} fill="#17543c" radius={[3, 3, 0, 0]} barSize={16} />
        {typeof threshold === 'number' && (
          <ReferenceLine
            y={threshold}
            stroke="#b47100"
            strokeDasharray="5 4"
            strokeWidth={1.8}
            label={{ value: t('traps.threshold'), position: 'insideTopRight', fill: '#8a5600', fontSize: 10.5 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, color = '#17543c', height = 42 }: { data: number[]; color?: string; height?: number }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <YAxis hide domain={[0, 100]} />
        <Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.14} strokeWidth={1.6} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
