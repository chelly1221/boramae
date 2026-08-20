import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { DAY, fmtDay, HOUR } from '../../data/detail/agg';
import { windColor } from '../../data/stats';
import type { AtisRecord } from '../../data/types';

/*
 * 지도 타임라인 (캔버스) — 전문을 솎지 않고 **실제 시각에 비례**해 그린다.
 * - 전문 i는 [ts_i, min(ts_{i+1}, ts_i + SEG_MAX_MS)) 구간의 색 막대(풍속 색), 그 뒤 공백은 빈칸(수신 공백)
 * - 막대가 충분히 넓으면 풍향 화살표, 선택 전문은 테두리, 재생 중엔 가상 시각 재생선
 * - 줌/팬은 시간 축: 휠(커서 기준 확대/축소), 드래그·Shift+휠(이동), 더블클릭(전체). 최소 구간 1시간
 * - 아래에 시각 축: 눈금/라벨 간격은 픽셀 폭에 맞춰 1h…30d 중 선택, 00Z는 날짜 굵게
 */

export interface TimeView {
  from: number;
  to: number;
}

interface Props {
  recs: AtisRecord[];
  /** 선택 전문 인덱스 */
  sel: number;
  onPick: (i: number) => void;
  /** 보이는 시간 구간 (null = 전체) */
  view: TimeView | null;
  onView: (v: TimeView | null) => void;
  /** 재생 가상 시각 (없으면 null) */
  playClock: number | null;
  /** 호버 중인 전문 인덱스 알림 (-1 = 없음) */
  onHover?: (i: number) => void;
}

/** 전문 유효 구간 상한 — 다음 전문이 이보다 늦으면 그 사이는 공백으로 그림 */
const SEG_MAX_MS = 3 * HOUR;
/** 줌 최소 구간 */
const MIN_SPAN = HOUR;
/** 전체 보기 여백 (구간의 비율) */
const PAD = 0.01;
const STRIP_H = 22;
const AXIS_H = 18;
export const TIMELINE_H = STRIP_H + AXIS_H;
const ARROW_MIN_PX = 14;
const DRAG_PX = 4;
const STEPS = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

/** 전체 구간 (양끝 여백 포함) */
export function fullView(recs: AtisRecord[]): TimeView {
  const from = recs[0]?.ts ?? 0;
  const to = recs[recs.length - 1]?.ts ?? from + HOUR;
  const span = Math.max(HOUR, to - from);
  return { from: from - span * PAD, to: to + span * PAD + Math.min(HOUR, span * 0.02) };
}

/** ts 이하의 마지막 전문 인덱스 (없으면 -1) */
function idxAt(recs: AtisRecord[], t: number): number {
  let lo = 0;
  let hi = recs.length - 1;
  if (hi < 0 || recs[0].ts > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (recs[mid].ts <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function Timeline({ recs, sel, onPick, view, onView, playClock, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(-1);
  const full = useMemo(() => fullView(recs), [recs]);
  const v = view ?? full;
  const span = Math.max(1, v.to - v.from);
  const zoomed = view != null && (v.from > full.from + 1 || v.to < full.to - 1);

  // 컨테이너 폭
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => setWidth(cv.clientWidth));
    ro.observe(cv);
    setWidth(cv.clientWidth);
    return () => ro.disconnect();
  }, []);

  const X = useCallback((t: number) => ((t - v.from) / span) * width, [v.from, span, width]);
  const T = useCallback((x: number) => v.from + (x / Math.max(1, width)) * span, [v.from, span, width]);

  const setRange = useCallback(
    (from: number, to: number) => {
      let sp = Math.max(MIN_SPAN, to - from);
      if (sp >= full.to - full.from) {
        onView(null);
        return;
      }
      let f = from;
      if (f < full.from) f = full.from;
      if (f + sp > full.to) f = full.to - sp;
      onView({ from: f, to: f + sp });
    },
    [full.from, full.to, onView],
  );

  const zoomAt = useCallback(
    (factor: number, pivotT: number) => {
      const nsp = span / factor;
      const k = (pivotT - v.from) / span;
      setRange(pivotT - k * nsp, pivotT - k * nsp + nsp);
    },
    [span, v.from, setRange],
  );

  /* ---------- 그리기 ---------- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(TIMELINE_H * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, TIMELINE_H);

    // 스트립 배경 (공백 = 이 색이 그대로 보임)
    ctx.fillStyle = 'rgba(50,30,20,0.06)';
    ctx.fillRect(0, 0, width, STRIP_H);

    // 보이는 전문 범위
    const n = recs.length;
    let i0 = idxAt(recs, v.from);
    if (i0 < 0) i0 = 0;
    const i1 = Math.min(n - 1, idxAt(recs, v.to) + 1);
    for (let i = i0; i <= i1; i++) {
      const r = recs[i];
      const end = i + 1 < n ? Math.min(recs[i + 1].ts, r.ts + SEG_MAX_MS) : r.ts + Math.min(HOUR, SEG_MAX_MS);
      const x0 = X(r.ts);
      const x1 = X(end);
      if (x1 < 0 || x0 > width) continue;
      const w = Math.max(1, x1 - x0);
      ctx.fillStyle = windColor(r.spd);
      ctx.fillRect(x0, 0, w, STRIP_H);
      if (w > 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x0, 0, 1, STRIP_H);
      }
      if (w >= ARROW_MIN_PX) {
        // 풍향 화살표 (바람이 불어가는 방향): dir+180
        const cx = x0 + w / 2;
        const cy = STRIP_H / 2;
        const ang = ((r.dir + 180) * Math.PI) / 180;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 5);
        ctx.lineTo(0, -5);
        ctx.moveTo(-3.2, -1.8);
        ctx.lineTo(0, -5);
        ctx.lineTo(3.2, -1.8);
        ctx.stroke();
        ctx.restore();
      }
    }
    // 호버 / 선택 테두리
    const outline = (i: number, color: string, lw: number) => {
      if (i < 0 || i >= n) return;
      const r = recs[i];
      const end = i + 1 < n ? Math.min(recs[i + 1].ts, r.ts + SEG_MAX_MS) : r.ts + Math.min(HOUR, SEG_MAX_MS);
      const x0 = X(r.ts);
      const w = Math.max(2, X(end) - x0);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(x0 + lw / 2, lw / 2, w - lw, STRIP_H - lw);
    };
    if (hover >= 0 && hover !== sel) outline(hover, 'rgba(255,255,255,0.8)', 1.5);
    outline(sel, '#fff', 2);
    if (sel >= 0) outline(sel, 'rgba(0,0,0,0.45)', 1);

    // 재생선
    if (playClock != null) {
      const x = X(playClock);
      if (x >= 0 && x <= width) {
        ctx.fillStyle = 'rgba(127,13,0,0.9)';
        ctx.fillRect(x - 1, 0, 2, STRIP_H + 4);
      }
    }

    // 시각 축
    const pxPer = (ms: number) => (ms / span) * width;
    const labelStep = STEPS.find((st) => pxPer(st) >= 56) ?? STEPS[STEPS.length - 1];
    const tickStep = STEPS.find((st) => pxPer(st) >= 7) ?? labelStep;
    ctx.font = '9px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'top';
    for (let t = Math.ceil(v.from / tickStep) * tickStep; t <= v.to; t += tickStep) {
      const x = Math.round(X(t)) + 0.5;
      const day = t % DAY === 0;
      const labeled = t % labelStep === 0;
      ctx.strokeStyle = day ? 'rgba(50,30,20,0.55)' : 'rgba(50,30,20,0.25)';
      ctx.beginPath();
      ctx.moveTo(x, STRIP_H);
      ctx.lineTo(x, STRIP_H + (day ? 7 : labeled ? 6 : 4));
      ctx.stroke();
      if (!labeled) continue;
      const d = new Date(t);
      const text = day ? fmtDay(t) : labelStep < HOUR * 3 ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : `${pad2(d.getUTCHours())}Z`;
      ctx.font = day ? 'bold 9px Consolas, "Courier New", monospace' : '9px Consolas, "Courier New", monospace';
      ctx.fillStyle = day ? 'rgba(60,40,30,0.8)' : 'rgba(60,40,30,0.55)';
      const tw = ctx.measureText(text).width;
      const tx = Math.min(width - tw, Math.max(0, x - tw / 2));
      ctx.fillText(text, tx, STRIP_H + 8);
    }
  }, [recs, v.from, v.to, span, width, sel, hover, playClock, X]);

  /* ---------- 상호작용 ---------- */
  // 휠: 줌 (Shift: 팬) — passive:false
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (e.shiftKey) {
        const d = Math.sign(e.deltaY) * span * 0.15;
        setRange(v.from + d, v.to + d);
      } else zoomAt(e.deltaY < 0 ? 1.3 : 1 / 1.3, T(x));
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [span, v.from, v.to, setRange, zoomAt, T]);

  const drag = useRef<{ x0: number; from0: number; to0: number; moved: boolean } | null>(null);
  const pickAt = (clientX: number) => {
    const cv = canvasRef.current;
    if (!cv) return -1;
    const t = T(clientX - cv.getBoundingClientRect().left);
    const i = idxAt(recs, t);
    return i < 0 ? 0 : i;
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    drag.current = { x0: e.clientX, from0: v.from, to0: v.to, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      const i = pickAt(e.clientX);
      if (i !== hover) {
        setHover(i);
        onHover?.(i);
      }
      return;
    }
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < DRAG_PX) return;
    d.moved = true;
    const dt = (dx / Math.max(1, width)) * (d.to0 - d.from0);
    setRange(d.from0 - dt, d.to0 - dt);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const i = pickAt(e.clientX);
      if (i >= 0) onPick(i);
    }
  };
  const onLeave = () => {
    setHover(-1);
    onHover?.(-1);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`timeline${zoomed ? ' timeline--zoomed' : ''}`}
      style={{ height: TIMELINE_H }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={onLeave}
      onDoubleClick={() => onView(null)}
    />
  );
}
