import { computeHeatRows } from '../stats';
import type { AtisRecord, HeatRow, TimeWindow } from '../types';
import { DAY, fmtDay, HOUR, pct } from './agg';

/*
 * 기상 히트맵 상세 파생값 — 기간 전체 일 × 24시간(UTC) 이벤트 그리드(stats.ts `computeHeatRows` 재사용) +
 * 셀(시간대) 단위 집계: 종류별 셀 수, 이벤트 없는 날, 최다 시간대/일, 시간대별·일별 종류 누적, 시정 저하 집중 구간.
 *
 * 셀 이벤트 정의는 카드(`computeHeatRows`)와 동일:
 *   강수 = 레코드 태그에 RA·SN / 시정 저하 = 강수가 아니면서 vis < 10 / 활주로 전환 = 직전 레코드와 rwy가 다름.
 *   셀 = 해당 UTC 시각(1시간)에 속한 레코드 중 하나라도 조건 충족.
 */

export type HeatKind = 'fog' | 'rain' | 'rwy';
export const HEAT_KINDS: HeatKind[] = ['fog', 'rain', 'rwy'];
/** 카드와 동일한 색 (design README 7번) */
export const HEAT_COLOR: Record<HeatKind, string> = {
  fog: '#c8871c',
  rain: '#6b8cae',
  rwy: '#7f0d00',
};
export const HEAT_NAME: Record<HeatKind, string> = {
  fog: '시정 저하',
  rain: '강수',
  rwy: '활주로 전환',
};

/** 셀 높이 축소·스크롤 전환 기준 (행 수) */
const ROWS_MID = 14;
const ROWS_SCROLL = 45;
/** 시정 저하 "집중 구간" 판정: 순환 4시간 창이 전체 시정 저하 셀의 이 비율(%) 이상을 차지 (균등 분포 16.7%의 약 2.4배) */
export const FOG_PEAK_SHARE = 40;

export interface HeatKindCount {
  fog: number;
  rain: number;
  rwy: number;
  /** 종류 무관 이벤트가 있는 셀 수 (복합 셀은 1로 셈) */
  any: number;
}

export interface HeatDay extends HeatKindCount {
  /** 일 시작 (epoch ms, UTC) */
  ts: number;
  /** "MM-DD" */
  label: string;
  /** 그날 레코드 수 */
  n: number;
  /** 활주로 전환 횟수 (레코드 단위) */
  rwyChanges: number;
  /** 그날 첫 이벤트 레코드 인덱스 (없으면 null) */
  firstEvIndex: number | null;
  /** 그날 첫 이벤트 시각 */
  firstEvTs: number | null;
}

export interface HeatDetail {
  rows: HeatRow[];
  /** 그리드 셀 높이(px) — 행 수에 따라 16 → 14 → 12 */
  cellH: number;
  /** 행이 많아 스크롤 컨테이너로 감쌀지 */
  scroll: boolean;
  /** 창 길이 (시간) */
  hoursSpan: number;
  /** 레코드가 하나라도 있는 셀 수 (관측 시간 수) */
  dataCells: number;
  /** 종류별 이벤트 셀 수 */
  cells: HeatKindCount;
  /** 활주로 전환 횟수 (레코드 단위, 카드 rwyEvents 정의) */
  rwyChanges: number;
  /** 레코드가 있는 날 수 */
  dataDays: number;
  /** 이벤트가 하나도 없는 날 수 (레코드가 있는 날 기준) */
  quietDays: number;
  /** UTC 시간대별 종류 누적 (24) */
  hourStack: HeatKindCount[];
  /** 이벤트 최다 시간대 (없으면 null). ties = 같은 셀 수인 시간대 수 (1이면 단독) */
  topHour: { hour: number; count: number; ties: number } | null;
  /** 일별 집계 (창 전체, 빈 날 포함) */
  daily: HeatDay[];
  /** 이벤트 최다 일 (없으면 null, 동률이면 가장 이른 날) */
  topDay: HeatDay | null;
  /** 이벤트 최다 일과 같은 셀 수인 날 수 (1이면 단독) */
  topDayTies: number;
  /** 이벤트가 있는 날 (이벤트 셀 수 내림차순) */
  eventDays: HeatDay[];
  /** 시정 저하 최다 시간대 */
  fogTopHour: { hour: number; count: number } | null;
  /** 시정 저하가 집중된 연속 4시간 구간 (순환) — 시정 저하 셀 4개 이상일 때만 */
  fogPeak: { h0: number; h1: number; count: number; share: number } | null;
}

const zeroCount = (): HeatKindCount => ({ fog: 0, rain: 0, rwy: 0, any: 0 });

export function computeHeatDetail(recs: AtisRecord[], win: TimeWindow): HeatDetail {
  const rows = computeHeatRows(recs, win.from, win.to);
  const nRows = rows.length;
  const scroll = nRows > ROWS_SCROLL;
  const cellH = scroll ? 12 : nRows > ROWS_MID ? 14 : 16;

  // 셀(시간) 단위 이벤트 — computeHeatRows와 같은 정의
  const cellMap = new Map<number, { fog: boolean; rain: boolean; rwy: boolean }>();
  // 일 단위 집계
  const dayMap = new Map<number, HeatDay>();
  const dayOf = (ts: number) => Math.floor(ts / DAY) * DAY;
  const getDay = (dts: number): HeatDay => {
    let d = dayMap.get(dts);
    if (!d) {
      d = {
        ts: dts,
        label: fmtDay(dts),
        n: 0,
        rwyChanges: 0,
        firstEvIndex: null,
        firstEvTs: null,
        ...zeroCount(),
      };
      dayMap.set(dts, d);
    }
    return d;
  };
  let rwyChanges = 0;
  recs.forEach((r, i) => {
    const key = Math.floor(r.ts / HOUR) * HOUR;
    let c = cellMap.get(key);
    if (!c) {
      c = { fog: false, rain: false, rwy: false };
      cellMap.set(key, c);
    }
    const rain = r.tags.includes('RA') || r.tags.includes('SN');
    const fog = !rain && r.vis < 10;
    const rwy = i > 0 && r.rwy !== recs[i - 1].rwy;
    if (rain) c.rain = true;
    if (fog) c.fog = true;
    if (rwy) c.rwy = true;
    const d = getDay(dayOf(r.ts));
    d.n++;
    if (rwy) {
      d.rwyChanges++;
      rwyChanges++;
    }
    if ((rain || fog || rwy) && d.firstEvIndex == null) {
      d.firstEvIndex = i;
      d.firstEvTs = r.ts;
    }
  });

  const cells = zeroCount();
  const hourStack: HeatKindCount[] = Array.from({ length: 24 }, zeroCount);
  cellMap.forEach((c, key) => {
    const h = new Date(key).getUTCHours();
    const d = getDay(dayOf(key));
    const any = c.fog || c.rain || c.rwy;
    if (c.fog) {
      cells.fog++;
      hourStack[h].fog++;
      d.fog++;
    }
    if (c.rain) {
      cells.rain++;
      hourStack[h].rain++;
      d.rain++;
    }
    if (c.rwy) {
      cells.rwy++;
      hourStack[h].rwy++;
      d.rwy++;
    }
    if (any) {
      cells.any++;
      hourStack[h].any++;
      d.any++;
    }
  });

  // 일별 (창 전체, 히트맵 행 순서와 동일)
  const daily: HeatDay[] = rows.map(
    (row) =>
      dayMap.get(row.dayTs) ?? {
        ts: row.dayTs,
        label: row.day,
        n: 0,
        rwyChanges: 0,
        firstEvIndex: null,
        firstEvTs: null,
        ...zeroCount(),
      },
  );
  const dataDays = daily.filter((d) => d.n > 0).length;
  const quietDays = daily.filter((d) => d.n > 0 && d.any === 0).length;
  let topDay: HeatDay | null = null;
  let topDayTies = 0;
  daily.forEach((d) => {
    if (d.any <= 0) return;
    if (!topDay || d.any > topDay.any) {
      topDay = d;
      topDayTies = 1;
    } else if (d.any === topDay.any) topDayTies++;
  });
  const eventDays = daily.filter((d) => d.any > 0).sort((a, b) => b.any - a.any || a.ts - b.ts);

  let topHour: HeatDetail['topHour'] = null;
  let fogTopHour: HeatDetail['fogTopHour'] = null;
  hourStack.forEach((c, h) => {
    if (c.any > 0) {
      if (!topHour || c.any > topHour.count) topHour = { hour: h, count: c.any, ties: 1 };
      else if (c.any === topHour.count) topHour.ties++;
    }
    if (c.fog > 0 && (!fogTopHour || c.fog > fogTopHour.count)) fogTopHour = { hour: h, count: c.fog };
  });

  // 시정 저하 집중 구간: 순환 4시간 창 중 셀 수 최대
  let fogPeak: HeatDetail['fogPeak'] = null;
  if (cells.fog >= 4) {
    let best = -1;
    let bestH = 0;
    for (let h = 0; h < 24; h++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += hourStack[(h + k) % 24].fog;
      if (s > best) {
        best = s;
        bestH = h;
      }
    }
    fogPeak = {
      h0: bestH,
      h1: (bestH + 3) % 24,
      count: best,
      share: pct(best, cells.fog),
    };
  }

  return {
    rows,
    cellH,
    scroll,
    hoursSpan: Math.max(1, Math.round((win.to - win.from) / HOUR)),
    dataCells: cellMap.size,
    cells,
    rwyChanges,
    dataDays,
    quietDays,
    hourStack,
    topHour,
    daily,
    topDay,
    topDayTies,
    eventDays,
    fogTopHour,
    fogPeak,
  };
}
