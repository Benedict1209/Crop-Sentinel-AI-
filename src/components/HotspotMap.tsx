import { useMemo, useState } from 'react';
import { DISTRICTS, MAP_H, MAP_W, project } from '../lib/geo';
import type { HotspotMarker } from '../lib/geo';
import type { RiskLevel } from '../domain/types';
import { Icon } from './icons';

const RISK_COLOR: Record<RiskLevel, string> = {
  high: '#b3261e',
  medium: '#d99b1c',
  low: '#2f8f5b',
};

export function HotspotMap({
  markers,
  selectedId,
  onSelect,
  legendLow,
  legendMedium,
  legendHigh,
  ariaLabel,
}: {
  markers: HotspotMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  legendLow: string;
  legendMedium: string;
  legendHigh: string;
  ariaLabel: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);

  const viewBox = useMemo(() => {
    const z = zoom;
    const cx = focus?.x ?? MAP_W / 2;
    const cy = focus?.y ?? MAP_H / 2;
    const w = MAP_W / z;
    const h = MAP_H / z;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [zoom, focus]);

  const gridLines = useMemo(() => {
    const lats: number[] = [];
    const lngs: number[] = [];
    for (let lat = 16; lat <= 22; lat += 1) lats.push(lat);
    for (let lng = 73; lng <= 80; lng += 1) lngs.push(lng);
    return { lats, lngs };
  }, []);

  function selectMarker(m: HotspotMarker) {
    onSelect(m.plotId);
    setFocus(project(m.lat, m.lng));
  }

  return (
    <div className="map-shell">
      <svg
        className="map-svg"
        viewBox={viewBox}
        role="img"
        aria-label={ariaLabel}
        onWheel={(e) => {
          e.preventDefault();
          setZoom((z) => Math.max(1, Math.min(8, z + (e.deltaY < 0 ? 0.5 : -0.5))));
        }}
      >
        {/* Schematic base: lat/long graticule + district centroids */}
        <rect x={-2000} y={-2000} width={MAP_W + 4000} height={MAP_H + 4000} fill="#f4f7f2" />
        <g stroke="#dfe6da" strokeWidth={0.8}>
          {gridLines.lats.map((lat) => {
            const p = project(lat, 72.3);
            return <line key={`la${lat}`} x1={0} y1={p.y} x2={MAP_W} y2={p.y} />;
          })}
          {gridLines.lngs.map((lng) => {
            const p = project(17.5, lng);
            return <line key={`lo${lng}`} x1={p.x} y1={0} x2={p.x} y2={MAP_H} />;
          })}
        </g>
        <g>
          {gridLines.lats.map((lat) => {
            const p = project(lat, 72.3);
            return (
              <text key={`lat${lat}`} x={6} y={p.y - 3} className="map-grid-label">
                {lat}°N
              </text>
            );
          })}
          {gridLines.lngs.map((lng) => {
            const p = project(17.5, lng);
            return (
              <text key={`lng${lng}`} x={p.x + 3} y={MAP_H - 6} className="map-grid-label">
                {lng}°E
              </text>
            );
          })}
        </g>

        {/* District centroids */}
        <g>
          {DISTRICTS.map((d) => {
            const p = project(d.lat, d.lng);
            return (
              <g key={d.name}>
                <circle cx={p.x} cy={p.y} r={2.6} fill="#9fb3a4" />
                <text x={p.x + 5} y={p.y + 3.4} className="map-label">
                  {d.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* Plot markers */}
        <g>
          {markers.map((m) => {
            const p = project(m.lat, m.lng);
            const selected = selectedId === m.plotId;
            const r = m.risk === 'high' ? 7 : m.risk === 'medium' ? 5.6 : 4.4;
            return (
              <g key={m.plotId} className="map-marker" onClick={() => selectMarker(m)} role="button" tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selectMarker(m)}>
                <title>{`${m.plotName} · ${m.district}`}</title>
                {selected && <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke="#0d2f24" strokeWidth={1.6} opacity={0.7} />}
                <circle
                  className="mark"
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={RISK_COLOR[m.risk]}
                  fillOpacity={0.82}
                  stroke="#ffffff"
                  strokeWidth={selected ? 2.6 : 1.4}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="map-legend">
        <span className="row nowrap" style={{ gap: 6 }}>
          <i className="dot high" /> {legendHigh}
        </span>
        <span className="row nowrap" style={{ gap: 6 }}>
          <i className="dot medium" /> {legendMedium}
        </span>
        <span className="row nowrap" style={{ gap: 6 }}>
          <i className="dot low" /> {legendLow}
        </span>
      </div>

      <div style={{ position: 'absolute', right: 10, top: 10 }} className="row no-print" >
        <button type="button" className="icon-btn sm" onClick={() => setZoom((z) => Math.min(8, z + 0.75))} aria-label="Zoom in">
          <Icon name="plus" size={14} />
        </button>
        <button type="button" className="icon-btn sm" onClick={() => setZoom((z) => Math.max(1, z - 0.75))}          aria-label="Zoom out"
        >
          <Icon name="minus" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          onClick={() => {
            setZoom(1);
            setFocus(null);
          }}
          aria-label="Reset view"
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
    </div>
  );
}
