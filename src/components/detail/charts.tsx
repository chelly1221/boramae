import { useMemo, useState, type ReactNode } from 'react';
import { fmtAxis, fmtDT, fmtDay, niceTicks, timeTicks, DAY } from '../../data/detail/agg';
import { useWidth } from './primitives';

/*
 * 상세 페이지 공용 차트 (인라인 SVG, px 좌표, 컨테이너 폭 추적).
 * - TimeSeriesChart: 시각 축 라인/영역/스텝/산점 + 임계선 + 구간 밴드 + 호버 툴팁 + 점 클릭
 * - BarChart: 범주/시간 버킷 막대 (단일·누적·범위) + 호버 툴팁 + 막대 클릭
 */

const GRID = 'rgba(50,30,20,0.08)';
const GRID_SOFT = 'rgba(50,30,20,0.05)';
const AXIS_TEXT = 'rgba(60,40,30,0.5)';
const PRIMARY = '#7f0d00';

/** 'rgba(...)'/hex 색을 alpha 적용 rgba로 (영역 채움용) */
export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const r = color.match(/^rgba?\(([^)]+)\)$/);
  if (r) {
    const [a, b, c] = r[1].split(',').map((s) => s.trim());
    return `rgba(${a},${b},${c},${alpha})`;
  }
  return color;
}

/* =========================================================================================
 * TimeSeriesChart
 * ======================================================================================= */

export interface Series {
  name: string;
  color: string;
  /** xs와 같은 길이. null = 결측(선 끊김) */
  values: (number | null)[];
  /** 라인 아래 영역 채움 */
  area?: boolean;
  dash?: boolean;
  /** 계단형 (시정·활주로 등 이산값) */
  step?: boolean;
  /** 산점(점만) */
  dots?: boolean;
  width?: number;
  /** 툴팁 값 포맷 (기본: 소수 1자리) */
  format?: (v: number) => string;
  /** 툴팁에서 숨김 (보조선 등) */
  hideTip?: boolean;
}

export interface Threshold {
  y: number;
  color?: string;
  label?: string;
  dash?: boolean;
}

export interface Band {
  from: number;
  to: number;
  color: string;
  label?: string;
}

interface TSProps {
  /** 각 점의 시각 (epoch ms), 오름차순 */
  xs: number[];
  series: Series[];
  height?: number;
  /** x 도메인 (기본 xs 범위). 조회 창을 넘기면 창 양끝 결측이 보임 */
  xDomain?: [number, number];
  yMin?: number;
  yMax?: number;
  /** y 라벨 포맷 */
  yFormat?: (v: number) => string;
  unit?: string;
  thresholds?: Threshold[];
  /** x 구간 강조 (이벤트 구간 등) */
  bands?: Band[];
  /** y 구간 강조 (한계 초과 영역 등) */
  yBands?: { from: number; to: number; color: string; label?: string }[];
  yTicks?: number;
  /** 점 클릭 (인덱스) — 원문 열기 등 */
  onPointClick?: (i: number) => void;
  /** 툴팁 커스텀 (기본: 시각 + 시리즈 값 목록) */
  tooltip?: (i: number) => ReactNode;
  /** 호버 시 툴팁 제목 (기본 fmtDT) */
  titleFormat?: (ts: number) => string;
  /** 왼쪽 축 폭 */
  padL?: number;
}

const PAD_R = 14;
const PAD_T = 12;
const PAD_B = 24;

function nearestIndex(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - x) < Math.abs(xs[lo] - x)) return lo - 1;
  return lo;
}

export function TimeSeriesChart({
  xs,
  series,
  height = 220,
  xDomain,
  yMin,
  yMax,
  yFormat,
  unit = '',
  thresholds = [],
  bands = [],
  yBands = [],
  yTicks = 5,
  onPointClick,
  tooltip,
  titleFormat = fmtDT,
  padL = 46,
}: TSProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = xs.length;
  const x0 = xDomain ? xDomain[0] : xs[0] ?? 0;
  const x1 = xDomain ? xDomain[1] : xs[n - 1] ?? 1;
  const span = Math.max(1, x1 - x0);

  const { lo, hi } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    series.forEach((s) =>
      s.values.forEach((v) => {
        if (v == null) return;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }),
    );
    thresholds.forEach((t) => {
      if (t.y < lo) lo = t.y;
      if (t.y > hi) hi = t.y;
    });
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (hi === lo) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    return { lo: yMin ?? lo - pad, hi: yMax ?? hi + pad };
  }, [series, thresholds, yMin, yMax]);

  const W = Math.max(0, width);
  const plotW = Math.max(1, W - padL - PAD_R);
  const plotH = Math.max(1, height - PAD_T - PAD_B);
  const X = (t: number) => padL + ((t - x0) / span) * plotW;
  const Y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const yt = useMemo(() => niceTicks(lo, hi, yTicks).filter((v) => v >= lo && v <= hi), [lo, hi, yTicks]);
  const xt = useMemo(() => timeTicks(x0, x1, Math.max(3, Math.floor(plotW / 90))), [x0, x1, plotW]);
  const fmtY = yFormat ?? ((v: number) => (Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Number(v.toFixed(2)))));

  const paths = useMemo(() => {
    return series.map((s) => {
      let d = '';
      let area = '';
      let open = false;
      let segStartX = 0;
      let lastX = 0;
      let lastY = 0;
      let segLen = 0;
      const dots: [number, number][] = [];
      /** 점 1개짜리 세그먼트(고립점) — 선이 그려지지 않으므로 원으로 표시 */
      const lonely: [number, number][] = [];
      const yBase = Y(0 >= lo && 0 <= hi ? 0 : lo); // 영역 기준선: 0이 범위 안이면 0, 아니면 하단
      const flush = () => {
        if (open && s.area) area += ` L${lastX.toFixed(1)},${yBase.toFixed(1)} L${segStartX.toFixed(1)},${yBase.toFixed(1)} Z`;
        if (open && segLen === 1 && !s.dots) lonely.push([lastX, lastY]);
        open = false;
        segLen = 0;
      };
      s.values.forEach((v, i) => {
        if (v == null) {
          flush();
          return;
        }
        const x = X(xs[i]);
        const y = Y(v);
        segLen++;
        if (s.dots) dots.push([x, y]);
        if (!open) {
          d += `M${x.toFixed(1)},${y.toFixed(1)}`;
          if (s.area) area += `M${x.toFixed(1)},${y.toFixed(1)}`;
          segStartX = x;
          open = true;
        } else if (s.step) {
          d += ` H${x.toFixed(1)} V${y.toFixed(1)}`;
          if (s.area) area += ` H${x.toFixed(1)} V${y.toFixed(1)}`;
        } else {
          d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
          if (s.area) area += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        }
        lastX = x;
        lastY = y;
      });
      flush();
      return { d, area, dots, lonely };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, xs, lo, hi, W, height, x0, x1]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < padL - 6 || px > W - PAD_R + 6) {
      setHover(null);
      return;
    }
    const t = x0 + ((px - padL) / plotW) * span;
    setHover(nearestIndex(xs, t));
  };

  const hx = hover != null ? X(xs[hover]) : 0;
  const tipLeft = hover != null && hx > padL + plotW * 0.6;

  return (
    <div ref={ref} className="tchart" style={{ height }}>
      {W > 0 && (
        <svg width={W} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover != null && onPointClick?.(hover)} style={{ cursor: onPointClick ? 'pointer' : 'crosshair' }}>
          {/* y 밴드 */}
          {yBands.map((b, i) => {
            const y1 = Y(Math.min(hi, Math.max(lo, b.to)));
            const y2 = Y(Math.min(hi, Math.max(lo, b.from)));
            return <rect key={`yb${i}`} x={padL} y={y1} width={plotW} height={Math.max(0, y2 - y1)} fill={b.color} />;
          })}
          {/* x 밴드 */}
          {bands.map((b, i) => {
            if (X(b.to) < padL || X(b.from) > padL + plotW) return null;
            let xa = Math.max(padL, X(b.from));
            const xb = Math.min(padL + plotW, X(b.to));
            const bw = Math.max(1.5, xb - xa); // 폭 0(단발 이벤트)도 최소 1.5px
            if (xa + bw > padL + plotW) xa = padL + plotW - bw;
            return (
              <g key={`b${i}`}>
                <rect x={xa} y={PAD_T} width={bw} height={plotH} fill={b.color} />
                {b.label && xb - xa > 40 && (
                  <text x={xa + 4} y={PAD_T + 11} fontSize="10" fill={AXIS_TEXT}>
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
          {/* 그리드 + y 라벨 */}
          {yt.map((v) => (
            <g key={v}>
              <line x1={padL} x2={padL + plotW} y1={Y(v)} y2={Y(v)} stroke={GRID} />
              {/* 단위 라벨과 겹치는 최상단 눈금 라벨은 숨김 */}
              {!(unit && Y(v) < PAD_T + 9) && (
                <text x={padL - 6} y={Y(v) + 3.5} fontSize="10" textAnchor="end" fill={AXIS_TEXT}>
                  {fmtY(v)}
                </text>
              )}
            </g>
          ))}
          {unit && (
            <text x={padL - 6} y={PAD_T - 3} fontSize="9.5" textAnchor="end" fill={AXIS_TEXT}>
              {unit}
            </text>
          )}
          {/* x 눈금 */}
          {xt.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={PAD_T} y2={PAD_T + plotH} stroke={t % DAY === 0 && span > DAY ? GRID : GRID_SOFT} />
              <text x={X(t)} y={height - 8} fontSize="10" textAnchor="middle" fill={AXIS_TEXT}>
                {fmtAxis(t, span)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={padL + plotW} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(50,30,20,0.14)" />
          {/* 시리즈 */}
          {series.map((s, si) => (
            <g key={s.name}>
              {s.area && paths[si].area && <path d={paths[si].area} fill={withAlpha(s.color, 0.09)} />}
              {!s.dots && <path d={paths[si].d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />}
              {s.dots && paths[si].dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.2} fill={s.color} opacity={0.85} />)}
              {paths[si].lonely.map(([x, y], i) => (
                <circle key={`l${i}`} cx={x} cy={y} r={2.6} fill={s.color} />
              ))}
            </g>
          ))}
          {/* 임계선 */}
          {thresholds.map((t, i) => (
            <g key={`th${i}`}>
              <line x1={padL} x2={padL + plotW} y1={Y(t.y)} y2={Y(t.y)} stroke={t.color ?? '#b8770a'} strokeWidth="1.5" strokeDasharray={t.dash === false ? undefined : '5 4'} />
              {t.label && (
                <text x={padL + plotW - 4} y={Y(t.y) - 4} fontSize="10" fontWeight="700" textAnchor="end" fill={t.color ?? '#b8770a'}>
                  {t.label}
                </text>
              )}
            </g>
          ))}
          {/* 호버 */}
          {hover != null && (
            <g>
              <line x1={hx} x2={hx} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(40,20,15,0.35)" strokeDasharray="3 3" />
              {series.map((s) => {
                const v = s.values[hover];
                if (v == null || s.hideTip) return null;
                return <circle key={s.name} cx={hx} cy={Y(v)} r={3.5} fill="#fff" stroke={s.color} strokeWidth="2" />;
              })}
            </g>
          )}
        </svg>
      )}
      {hover != null && W > 0 && (
        <div className="tchart__tip" style={tipLeft ? { right: W - hx + 10 } : { left: hx + 10 }}>
          <div className="tchart__tip-title">{titleFormat(xs[hover])}</div>
          {tooltip
            ? tooltip(hover)
            : series
                .filter((s) => !s.hideTip)
                .map((s) => {
                  const v = s.values[hover];
                  return (
                    <div key={s.name} className="tchart__tip-row">
                      <span className="tchart__tip-sw" style={{ background: s.color }} />
                      <span className="tchart__tip-name">{s.name}</span>
                      <span className="tchart__tip-val">{v == null ? '—' : (s.format ? s.format(v) : String(Number(v.toFixed(1)))) + unit}</span>
                    </div>
                  );
                })}
        </div>
      )}
    </div>
  );
}

/* =========================================================================================
 * BarChart
 * ======================================================================================= */

export interface StackPart {
  name: string;
  value: number;
  color: string;
}

export interface BarItem {
  label: string;
  /** 단일 막대 값 (stack 없을 때) */
  value?: number;
  /** 범위 막대 하한 (value가 상한) */
  lo?: number;
  /** 누적 막대 */
  stack?: StackPart[];
  color?: string;
  /** 툴팁 제목 (기본 label) */
  title?: string;
  /** 툴팁 추가 줄 */
  note?: ReactNode;
}

interface BarProps {
  items: BarItem[];
  height?: number;
  yMax?: number;
  yMin?: number;
  yFormat?: (v: number) => string;
  unit?: string;
  color?: string;
  onBarClick?: (i: number) => void;
  /** 라벨 표시 간격 강제 (기본 자동) */
  labelEvery?: number;
  thresholds?: Threshold[];
  padL?: number;
  /** 막대 최소 폭에 맞춰 x축 라벨 회전 없이 간격 조절 — 라벨 최소 폭(px) */
  labelMinPx?: number;
  /** 값 라벨을 막대 위에 표시 */
  showValues?: boolean;
  /** 정수 눈금 강제 (건수 축). 기본: 모든 값이 정수면 자동 */
  integer?: boolean;
  /** 막대 최대 폭(px) — 막대가 적을 때 과도하게 넓어지는 것 방지 */
  maxBarWidth?: number;
}

export function BarChart({ items, height = 180, yMax, yMin, yFormat, unit = '', color = PRIMARY, onBarClick, labelEvery, thresholds = [], padL = 40, labelMinPx = 34, showValues, integer, maxBarWidth = 72 }: BarProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = items.length;

  const tot = (it: BarItem) => (it.stack ? it.stack.reduce((a, p) => a + p.value, 0) : it.value ?? 0);
  const { lo, hi } = useMemo(() => {
    let hi = -Infinity;
    let lo = Infinity;
    items.forEach((it) => {
      const v = tot(it);
      if (v > hi) hi = v;
      const l = it.lo ?? 0;
      if (l < lo) lo = l;
      if (v < lo) lo = v;
    });
    thresholds.forEach((t) => {
      if (t.y > hi) hi = t.y;
    });
    if (!Number.isFinite(hi)) hi = 1;
    if (!Number.isFinite(lo)) lo = 0;
    if (yMin == null && lo > 0) lo = 0;
    if (hi <= lo) hi = lo + 1;
    return { lo: yMin ?? lo, hi: yMax ?? hi * 1.05 };
  }, [items, yMax, yMin, thresholds]);

  const W = Math.max(0, width);
  const plotW = Math.max(1, W - padL - PAD_R);
  const plotH = Math.max(1, height - PAD_T - PAD_B);
  const Y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / Math.max(1, n);
  const gap = Math.min(4, slot * 0.25);
  const bw = Math.min(maxBarWidth, Math.max(1, slot - gap));
  const inset = (slot - bw) / 2; // 슬롯 안 가운데 정렬
  const every = labelEvery ?? Math.max(1, Math.ceil(labelMinPx / slot));
  const isInt = integer ?? items.every((it) => Number.isInteger(tot(it)) && (it.lo == null || Number.isInteger(it.lo)));
  const yt = useMemo(() => niceTicks(lo, hi, 4, isInt).filter((v) => v >= lo && v <= hi), [lo, hi, isInt]);
  const fmtY = yFormat ?? ((v: number) => String(Number(v.toFixed(2))));
  const labelX = (cx: number) => Math.max(padL + 2, Math.min(W - 14, cx)); // 라벨이 SVG 밖으로 잘리지 않게

  return (
    <div ref={ref} className="bchart" style={{ height }}>
      {W > 0 && (
        <svg width={W} height={height} onMouseLeave={() => setHover(null)}>
          {yt.map((v) => (
            <g key={v}>
              <line x1={padL} x2={padL + plotW} y1={Y(v)} y2={Y(v)} stroke={GRID} />
              {!(unit && Y(v) < PAD_T + 9) && (
                <text x={padL - 6} y={Y(v) + 3.5} fontSize="10" textAnchor="end" fill={AXIS_TEXT}>
                  {fmtY(v)}
                </text>
              )}
            </g>
          ))}
          {unit && (
            <text x={padL - 6} y={PAD_T - 3} fontSize="9.5" textAnchor="end" fill={AXIS_TEXT}>
              {unit}
            </text>
          )}
          {items.map((it, i) => {
            const x = padL + i * slot + inset;
            const v = tot(it);
            const base = it.lo ?? Math.max(lo, 0);
            const parts: { y: number; h: number; color: string }[] = [];
            if (it.stack) {
              let acc = base;
              it.stack.forEach((p) => {
                const y1 = Y(acc + p.value);
                const y2 = Y(acc);
                parts.push({ y: y1, h: Math.max(0, y2 - y1), color: p.color });
                acc += p.value;
              });
            } else {
              const y1 = Y(Math.max(base, v));
              const y2 = Y(Math.min(base, v));
              parts.push({ y: y1, h: Math.max(v !== base ? 1 : 0, y2 - y1), color: it.color ?? color });
            }
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onClick={onBarClick ? () => onBarClick(i) : undefined} style={{ cursor: onBarClick ? 'pointer' : 'default' }}>
                <rect x={padL + i * slot} y={PAD_T} width={slot} height={plotH} fill={hover === i ? 'rgba(50,30,20,0.05)' : 'transparent'} />
                {parts.map((p, pi) => (
                  <rect key={pi} x={x} y={p.y} width={bw} height={p.h} fill={p.color} rx={bw > 6 ? 2 : 0} opacity={hover == null || hover === i ? 1 : 0.7} />
                ))}
                {showValues && v !== base && slot >= 22 && (
                  <text x={x + bw / 2} y={Y(v) - 3} fontSize="9.5" textAnchor="middle" fill={AXIS_TEXT}>
                    {fmtY(v)}
                  </text>
                )}
                {i % every === 0 && (
                  <text x={labelX(x + bw / 2)} y={height - 8} fontSize="10" textAnchor="middle" fill={AXIS_TEXT}>
                    {it.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={padL} x2={padL + plotW} y1={Y(Math.max(lo, Math.min(hi, 0)))} y2={Y(Math.max(lo, Math.min(hi, 0)))} stroke="rgba(50,30,20,0.14)" />
          {thresholds.map((t, i) => (
            <g key={`th${i}`}>
              <line x1={padL} x2={padL + plotW} y1={Y(t.y)} y2={Y(t.y)} stroke={t.color ?? '#b8770a'} strokeWidth="1.5" strokeDasharray={t.dash === false ? undefined : '5 4'} />
              {t.label && (
                <text x={padL + plotW - 4} y={Y(t.y) - 4} fontSize="10" fontWeight="700" textAnchor="end" fill={t.color ?? '#b8770a'}>
                  {t.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {hover != null && W > 0 && (
        <div className="tchart__tip" style={padL + hover * slot > W * 0.6 ? { right: W - (padL + hover * slot) + 8 } : { left: padL + (hover + 1) * slot + 8 }}>
          <div className="tchart__tip-title">{items[hover].title ?? items[hover].label}</div>
          {items[hover].stack ? (
            items[hover].stack!.map((p) => (
              <div key={p.name} className="tchart__tip-row">
                <span className="tchart__tip-sw" style={{ background: p.color }} />
                <span className="tchart__tip-name">{p.name}</span>
                <span className="tchart__tip-val">
                  {fmtY(p.value)}
                  {unit}
                </span>
              </div>
            ))
          ) : (
            <div className="tchart__tip-row">
              <span className="tchart__tip-sw" style={{ background: items[hover].color ?? color }} />
              <span className="tchart__tip-name">{items[hover].lo != null ? `${fmtY(items[hover].lo!)} ~ ` : ''}</span>
              <span className="tchart__tip-val">
                {fmtY(items[hover].value ?? 0)}
                {unit}
              </span>
            </div>
          )}
          {items[hover].note && <div className="tchart__tip-note">{items[hover].note}</div>}
        </div>
      )}
    </div>
  );
}

/** 24시간(UTC) 프로파일용 라벨 배열 — "00" … "23" */
export const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/** 일 버킷 라벨 (MM-DD) */
export const dayLabel = (ts: number) => fmtDay(ts);
