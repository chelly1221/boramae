import { useMemo } from 'react';
import { DAY, HOUR, fmtDur, UNIT_LABEL, type Unit } from '../../data/detail/agg';
import type { TimeWindow } from '../../data/types';
import { IconChevronLeft, IconChevronRight } from '../icons';

interface Props {
  win: TimeWindow;
  onChange: (w: TimeWindow) => void;
  /** 데이터 기준 "현재" (프리셋·상한) */
  now: number;
  /** 선택 하한 */
  minTs: number;
  /** 요약: 레코드 수 · 해상도 */
  count: number;
  unit: Unit;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const startOfMonth = (ts: number) => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const addMonths = (ts: number, n: number) => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
};

interface Preset {
  key: string;
  label: string;
  make: (now: number) => TimeWindow;
}
const PRESETS: Preset[] = [
  { key: '24h', label: '24시간', make: (now) => ({ from: now - DAY, to: now }) },
  { key: '7d', label: '7일', make: (now) => ({ from: now - 7 * DAY, to: now }) },
  { key: '30d', label: '30일', make: (now) => ({ from: now - 30 * DAY, to: now }) },
  { key: '90d', label: '90일', make: (now) => ({ from: now - 90 * DAY, to: now }) },
  { key: 'month', label: '이번 달', make: (now) => ({ from: startOfMonth(now), to: now }) },
  { key: 'prevMonth', label: '지난 달', make: (now) => ({ from: addMonths(startOfMonth(now), -1), to: startOfMonth(now) }) },
  { key: 'year', label: '올해', make: (now) => ({ from: Date.UTC(new Date(now).getUTCFullYear(), 0, 1), to: now }) },
];

/** 년/월/일/시 셀렉트 묶음 */
function DateTimeSelect({ ts, minTs, maxTs, onChange }: { ts: number; minTs: number; maxTs: number; onChange: (ts: number) => void }) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const yMin = new Date(minTs).getUTCFullYear();
  const yMax = new Date(maxTs).getUTCFullYear();
  const years = useMemo(() => Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i), [yMin, yMax]);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const set = (ny: number, nm: number, nd: number, nh: number) => {
    const maxD = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    onChange(Date.UTC(ny, nm, Math.min(nd, maxD), nh));
  };
  return (
    <span className="period__dt">
      <select className="period__sel" value={y} onChange={(e) => set(Number(e.target.value), m, day, h)}>
        {years.map((v) => (
          <option key={v} value={v}>
            {v}년
          </option>
        ))}
      </select>
      <select className="period__sel" value={m} onChange={(e) => set(y, Number(e.target.value), day, h)}>
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={i}>
            {pad2(i + 1)}월
          </option>
        ))}
      </select>
      <select className="period__sel" value={day} onChange={(e) => set(y, m, Number(e.target.value), h)}>
        {Array.from({ length: dim }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {pad2(i + 1)}일
          </option>
        ))}
      </select>
      <select className="period__sel" value={h} onChange={(e) => set(y, m, day, Number(e.target.value))}>
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>
            {pad2(i)}시
          </option>
        ))}
      </select>
    </span>
  );
}

/** 상세 페이지 기간 지정: 프리셋 + 년/월/일/시 직접 지정 + 이전/다음 기간 이동 (UTC) */
export function PeriodPicker({ win, onChange, now, minTs, count, unit }: Props) {
  const span = win.to - win.from;
  const activePreset = PRESETS.find((p) => {
    const w = p.make(now);
    return w.from === win.from && w.to === win.to;
  })?.key;

  const clamp = (w: TimeWindow): TimeWindow => {
    let from = Math.max(minTs, Math.min(w.from, now - HOUR));
    let to = Math.min(now, Math.max(w.to, minTs + HOUR));
    if (to - from < HOUR) {
      if (w.from !== win.from) to = Math.min(now, from + HOUR);
      else from = Math.max(minTs, to - HOUR);
    }
    if (to - from < HOUR) from = to - HOUR;
    return { from, to };
  };
  const shift = (dir: -1 | 1) => onChange(clamp({ from: win.from + dir * span, to: win.to + dir * span }));

  return (
    <div className="card period">
      <div className="period__row">
        <span className="period__label">조회 기간</span>
        <div className="segment">
          {PRESETS.map((p) => (
            <div key={p.key} className={`segment__item${activePreset === p.key ? ' segment__item--active' : ''}`} onClick={() => onChange(p.make(now))}>
              {p.label}
            </div>
          ))}
        </div>
        <div className="period__spacer" />
        <div className="period__nav">
          <div className="icon-btn" title="이전 기간" onClick={() => shift(-1)}>
            <IconChevronLeft />
          </div>
          <span className="period__span">{fmtDur(span)}</span>
          <div className={`icon-btn${win.to >= now ? ' icon-btn--disabled' : ''}`} title="다음 기간" onClick={() => win.to < now && shift(1)}>
            <IconChevronRight />
          </div>
        </div>
      </div>
      <div className="period__row">
        <span className="period__label">시작</span>
        <DateTimeSelect ts={win.from} minTs={minTs} maxTs={now} onChange={(ts) => onChange(clamp({ from: ts, to: win.to }))} />
        <span className="period__tilde">~</span>
        <span className="period__label">종료</span>
        <DateTimeSelect ts={win.to} minTs={minTs} maxTs={now} onChange={(ts) => onChange(clamp({ from: win.from, to: ts }))} />
        <span className="period__meta" title={`차트 기본 해상도 ${UNIT_LABEL[unit]} (패널별로 다를 수 있음)`}>
          UTC 기준 · 전문 <b>{count.toLocaleString()}</b>건
        </span>
      </div>
    </div>
  );
}
