"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { niceTicks } from "@/lib/format";
import { useWidth } from "./useWidth";
import styles from "./charts.module.css";

export interface LinePoint {
  x: number;
  y: number;
}

export interface TooltipRow {
  label: string;
  value: string;
}

interface Props {
  data: LinePoint[];
  label: string;
  formatY: (v: number) => string;
  formatX: (v: number) => string;
  yDomain?: [number, number];
  height?: number;
  tooltip: (index: number) => { title: string; rows: TooltipRow[] };
  dimmed?: boolean;
}

const M = { top: 14, right: 64, bottom: 28, left: 46 };

export function LineChart({ data, label, formatY, formatX, yDomain, height = 260, tooltip, dimmed }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;

  const geo = useMemo(() => {
    if (!data.length || innerW <= 0) return null;
    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x0 === x1) {
      x0 -= 1;
      x1 += 1;
    }
    let [y0, y1] = yDomain ?? [Math.min(...ys), Math.max(...ys)];
    if (!yDomain) {
      const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.1;
      y0 -= pad;
      y1 += pad;
    }
    const sx = (v: number) => M.left + ((v - x0) / (x1 - x0)) * innerW;
    const sy = (v: number) => M.top + innerH - ((v - y0) / (y1 - y0)) * innerH;
    const yTicks = niceTicks(y0, y1, 5).filter((t) => t >= y0 - 1e-9 && t <= y1 + 1e-9);
    const xTicks = niceTicks(x0, x1, Math.max(2, Math.min(7, Math.floor(innerW / 80))), true).filter((t) => t >= x0 && t <= x1);
    const pts = data.map((d) => [sx(d.x), sy(d.y)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const base = M.top + innerH;
    const area = pts.length > 1 ? `${line}L${pts.at(-1)![0].toFixed(1)},${base}L${pts[0]![0].toFixed(1)},${base}Z` : "";
    return { sx, sy, yTicks, xTicks, pts, line, area };
  }, [data, innerW, innerH, yDomain]);

  function nearest(clientX: number, rect: DOMRect): number {
    if (!geo) return 0;
    const x = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < geo.pts.length; i += 1) {
      if (Math.abs(geo.pts[i]![0] - x) < Math.abs(geo.pts[best]![0] - x)) best = i;
    }
    return best;
  }

  function onMove(e: PointerEvent<SVGRectElement>) {
    setActive(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!data.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((i) => Math.min(data.length - 1, Math.max(0, (i ?? data.length - 1) + (i === null ? 0 : step))));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  const last = geo?.pts.at(-1);
  const tip = active !== null && geo ? tooltip(active) : null;
  const tipX = active !== null && geo ? geo.pts[active]![0] : 0;
  const flip = tipX > width - 200;

  return (
    <div
      ref={ref}
      className={styles.chart}
      style={{ height, opacity: dimmed ? 0.55 : 1 }}
      tabIndex={data.length ? 0 : -1}
      role="img"
      aria-label={label}
      onKeyDown={onKey}
      onFocus={() => setActive((i) => i ?? (data.length ? data.length - 1 : null))}
      onBlur={() => setActive(null)}
    >
      {geo ? (
        <svg width={width} height={height} className={styles.svg} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {geo.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={M.left + innerW} y1={geo.sy(t)} y2={geo.sy(t)} className={styles.grid} />
              <text x={M.left - 10} y={geo.sy(t)} className={styles.tick} textAnchor="end" dominantBaseline="middle">
                {formatY(t)}
              </text>
            </g>
          ))}
          {geo.xTicks.map((t) => (
            <text key={`x${t}`} x={geo.sx(t)} y={M.top + innerH + 18} className={styles.tick} textAnchor="middle">
              {formatX(t)}
            </text>
          ))}
          {geo.area ? <path d={geo.area} fill={`url(#${gradientId})`} /> : null}
          <path d={geo.line} className={styles.line} />
          {active !== null ? (
            <line x1={tipX} x2={tipX} y1={M.top} y2={M.top + innerH} className={styles.crosshair} />
          ) : null}
          {last ? (
            <>
              <circle cx={last[0]} cy={last[1]} r={4.5} className={styles.dot} />
              <text x={last[0] + 10} y={last[1]} className={styles.endLabel} dominantBaseline="middle">
                {formatY(data.at(-1)!.y)}
              </text>
            </>
          ) : null}
          {active !== null ? <circle cx={geo.pts[active]![0]} cy={geo.pts[active]![1]} r={5.5} className={styles.dot} /> : null}
          <rect
            x={M.left}
            y={M.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
            className={styles.hit}
          />
        </svg>
      ) : null}
      {tip ? (
        <div className={styles.tooltip} style={{ left: flip ? undefined : tipX + 14, right: flip ? width - tipX + 14 : undefined, top: M.top }} role="presentation">
          <div className={styles.tipTitle}>{tip.title}</div>
          {tip.rows.map((r) => (
            <div key={r.label} className={styles.tipRow}>
              <span className={styles.tipKey} />
              <span className={styles.tipValue}>{r.value}</span>
              <span className={styles.tipLabel}>{r.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sparkline({ data, height = 36, label }: { data: number[]; height?: number; label: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  if (data.length < 2) return <div ref={ref} style={{ height }} aria-hidden="true" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 4;
  const pts = data.map((v, i) => [pad + (i / (data.length - 1)) * Math.max(0, width - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const end = pts.at(-1)!;
  return (
    <div ref={ref} style={{ height }} role="img" aria-label={label}>
      {width ? (
        <svg width={width} height={height} aria-hidden="true">
          <path d={d} className={styles.spark} />
          <circle cx={end[0]} cy={end[1]} r={3.5} className={styles.sparkDot} />
        </svg>
      ) : null}
    </div>
  );
}
