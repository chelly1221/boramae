import type { AtisRecord, TimeWindow, WxGroup } from '../types';
import { TAG_DESC } from '../stats';
import { bucketize, DAY, dayBuckets, fmtDate, fmtDay, fmtDT, fmtHM, HOUR, niceTicks, pct, runs, type Bucket } from './agg';

/*
 * 기상현상 태그 상세 파생값 — 태그별 건수/칩, 해상도별(1시간·1일) 태그 누적 건수, UTC 시간대 분포,
 * 태그 × 시간대 그리드, 태그별 요약(첫/마지막 발생·최장 연속 구간·강도 분포), 태그 이벤트 구간 목록,
 * TREND(BECMG/TEMPO) 전문 목록과 최근기상(RE) 건수.
 * 태그 = 전문 "WITH FBL TS RA BR" 의 2글자 현상·기술자 코드(강도 제외, 중복 제거). 태그 건수 정의는 통계 카드(stats.ts tagChips)와 동일: 전문 1건에 태그 1개 = 1건.
 * 강도(FBL/MOD/HVY)는 r.wx 묶음에서 세며, 한 전문에 같은 코드가 여러 묶음에 있으면 가장 센 강도로 센다.
 */

/** 태그별 색 (알려진 태그 외에는 중립색) */
export const TAG_COLORS: Record<string, string> = {
  BR: '#c8871c',
  FG: '#9a6a12',
  HZ: '#d9b83a',
  FU: '#a08a6a',
  DU: '#b89a5a',
  SA: '#c9a96a',
  RA: '#6b8cae',
  DZ: '#8fa8c4',
  SN: '#5b8bc9',
  PL: '#7ea0d8',
  GR: '#4a6a8f',
  TS: '#c8422e',
  SH: '#4aa88c',
  PR: '#b8770a',
  MI: '#d4a24e',
  BC: '#caa35c',
  FZ: '#7b6bb3',
  BL: '#9a8cc9',
  DR: '#b0a4d6',
  SS: '#9c7a4a',
  DS: '#8a6a3a',
  SQ: '#e08a35',
};
/** 강도 라벨 (WxGroup.intensity) */
export const INTENSITY_LABEL: Record<WxGroup['intensity'], string> = { '-': 'FBL', '': 'MOD', '+': 'HVY' };
const INTENSITY_RANK: Record<WxGroup['intensity'], number> = { '-': 0, '': 1, '+': 2 };
export const TAG_OTHER_COLOR = '#8c7a6e';
export const tagColor = (tag: string) => TAG_COLORS[tag] ?? TAG_OTHER_COLOR;
export const tagDesc = (tag: string) => TAG_DESC[tag] ?? '기타';

/** 메인 차트 해상도 — 건수 누적 막대이므로 원본 단위는 쓰지 않는다 */
export type TagsUnit = 'hour' | 'day';
export const TAGS_UNIT_LABEL: Record<TagsUnit, string> = { hour: '1시간', day: '1일' };
/** 이 기간(일) 이하이면 1시간 버킷, 초과하면 1일 버킷 */
export const TAGS_HOUR_UNIT_MAX_DAYS = 7;

export interface TagChip {
  tag: string;
  desc: string;
  color: string;
  n: number;
  /** 전문 대비 비율 (%, 정수 — 카드 pct와 동일) */
  ratio: number;
  /** 표시용 비율 — 10% 미만은 소수 1자리, 0.05% 미만은 "<0.1" */
  ratioText: string;
}

export interface TagSummary extends TagChip {
  firstIdx: number;
  firstTs: number;
  lastIdx: number;
  lastTs: number;
  /** 연속 구간 수 */
  runCount: number;
  /** 최장 연속 구간 (없으면 null) */
  longest: TagRun | null;
  /** 강도별 전문 수 [FBL, MOD, HVY] (전문 1건당 가장 센 강도 1회) */
  intensity: [number, number, number];
}

/** TREND 변화 예보(BECMG/TEMPO) 전문 */
export interface TrendItem {
  index: number;
  ts: number;
  letter: string;
  trend: 'BECMG' | 'TEMPO';
  trendTxt: string;
  visTxt: string;
  wxTxt: string;
}

export interface TagRun {
  tag: string;
  color: string;
  /** 시작/끝 레코드 인덱스 (inclusive) */
  start: number;
  end: number;
  startTs: number;
  endTs: number;
  durMs: number;
  /** 구간 내 전문 수 */
  n: number;
}

export interface TagBucketItem {
  ts: number;
  label: string;
  /** 툴팁 제목 */
  title: string;
  /** 태그별 건수 (chips 순서, 0 포함) */
  counts: number[];
  total: number;
  /** 버킷 내 태그가 있는 첫 전문 인덱스 (없으면 버킷 첫 전문, 그것도 없으면 null) */
  idx: number | null;
}

export interface TagHourCell {
  n: number;
  /** 해당 시간대·태그의 첫 전문 인덱스 */
  idx: number | null;
}

export interface TagsDetail {
  n: number;
  /** 태그 보고 총 건수 (전문 × 태그) */
  total: number;
  /** 태그가 1개 이상 있는 전문 수 */
  tagged: number;
  taggedPct: number;
  /** 태그 종류 (건수 내림차순 — 통계 카드와 동일 정렬) */
  chips: TagChip[];
  top: TagChip | null;
  tsCount: number;
  tsLastTs: number | null;
  /** 태그 보고 최다 일 (UTC) */
  topDay: { ts: number; label: string; n: number; topTag: string | null } | null;
  /** 메인 차트 */
  unit: TagsUnit;
  /** 메인 차트 x 라벨 간격 강제값 (undefined = 자동) */
  labelEvery: number | undefined;
  buckets: Bucket[];
  items: TagBucketItem[];
  maxBucketTotal: number;
  /** UTC 시간대별 태그 건수 — hourCounts[chipIdx][hour] */
  hourCounts: number[][];
  hourTotals: number[];
  maxHourTotal: number;
  /** 시간대 최다 (태그 전체) — ties: 같은 건수인 시간대 수 */
  topHour: { hour: number; n: number; ties: number } | null;
  /** 새벽 안개 패턴: BR/FG 건수와 그중 03–06Z 건수 (fogPattern = 총 4건 이상이고 절반 이상이 03–06Z) */
  fog: { total: number; night: number; pattern: boolean };
  /** 태그 × 시간대 그리드 — grid[chipIdx][hour] */
  grid: TagHourCell[][];
  maxCell: number;
  summaries: TagSummary[];
  /** 태그 이벤트 구간 (시작 시각 오름차순) */
  events: TagRun[];
  longestRun: TagRun | null;
  /** TREND 변화 예보 */
  becmgN: number;
  tempoN: number;
  /** TREND 없는 전문 수 */
  trendNullN: number;
  trendItems: TrendItem[];
  /** 최근기상(RE …) 보고 전문 수 */
  recentN: number;
  /** 최근기상 코드별 건수 */
  recentCodes: { code: string; n: number }[];
}

/** 건수 막대 y축 상한 — 정수 눈금이 나오고, 최상단 눈금이 축 단위 표기와 겹치지 않을 만큼 여유(≥6%)를 둔다 */
export function countAxisMax(m: number): number {
  let hi = Math.max(4, Math.ceil(m * 1.15));
  for (let i = 0; i < 4; i++) {
    const t = niceTicks(0, hi, 4);
    const step = t.length > 1 ? t[1] - t[0] : 1;
    const top = t[t.length - 1];
    if (top <= hi * 0.94) break;
    hi = top + step * 0.5;
  }
  return hi;
}

/** 전문 대비 비율 표시 문자열 (%) — 작은 비율이 0%로 뭉개지지 않게 소수 1자리 */
export function fmtRatio(part: number, whole: number): string {
  if (!whole || !part) return '0';
  const v = (part / whole) * 100;
  if (v >= 10) return String(Math.round(v));
  if (v < 0.05) return '<0.1';
  return v.toFixed(1).replace(/\.0$/, '');
}

export function pickTagsUnit(win: TimeWindow): TagsUnit {
  return (win.to - win.from) / DAY <= TAGS_HOUR_UNIT_MAX_DAYS ? 'hour' : 'day';
}

export function computeTagsDetail(recs: AtisRecord[], win: TimeWindow): TagsDetail {
  const n = recs.length;

  // 태그별 건수 (카드와 동일: 등장 순서 유지 후 건수 내림차순 안정 정렬)
  const cnt = new Map<string, number>();
  let total = 0;
  let tagged = 0;
  recs.forEach((r) => {
    if (r.tags.length) tagged++;
    r.tags.forEach((tg) => {
      cnt.set(tg, (cnt.get(tg) ?? 0) + 1);
      total++;
    });
  });
  const chips: TagChip[] = [...cnt.keys()]
    .sort((a, b) => (cnt.get(b) as number) - (cnt.get(a) as number))
    .map((tag) => ({ tag, desc: tagDesc(tag), color: tagColor(tag), n: cnt.get(tag) as number, ratio: pct(cnt.get(tag) as number, n), ratioText: fmtRatio(cnt.get(tag) as number, n) }));
  const chipIdx = new Map<string, number>();
  chips.forEach((c, i) => chipIdx.set(c.tag, i));
  const K = chips.length;

  // TS · TREND · 최근기상
  let tsCount = 0;
  let tsLastTs: number | null = null;
  let becmgN = 0;
  let tempoN = 0;
  let trendNullN = 0;
  let recentN = 0;
  const recentCnt = new Map<string, number>();
  const trendItems: TrendItem[] = [];
  recs.forEach((r, i) => {
    if (r.tags.includes('TS')) {
      tsCount++;
      tsLastTs = r.ts;
    }
    if (r.trend === 'BECMG' || r.trend === 'TEMPO') {
      if (r.trend === 'BECMG') becmgN++;
      else tempoN++;
      trendItems.push({ index: i, ts: r.ts, letter: r.letter, trend: r.trend, trendTxt: r.trendTxt, visTxt: r.visTxt, wxTxt: r.wxTxt });
    } else if (!r.trend) trendNullN++;
    if (r.recent.length) {
      recentN++;
      r.recent.forEach((c) => recentCnt.set(c, (recentCnt.get(c) ?? 0) + 1));
    }
  });
  const recentCodes = [...recentCnt.entries()].map(([code, c]) => ({ code, n: c })).sort((a, b) => b.n - a.n);

  // 최다 일
  let topDay: TagsDetail['topDay'] = null;
  dayBuckets(recs, win).forEach((b) => {
    if (!b.recs.length) return;
    let dn = 0;
    const dc = new Map<string, number>();
    b.recs.forEach((r) =>
      r.tags.forEach((tg) => {
        dn++;
        dc.set(tg, (dc.get(tg) ?? 0) + 1);
      }),
    );
    if (dn > 0 && (!topDay || dn > topDay.n)) {
      let topTag: string | null = null;
      let best = 0;
      dc.forEach((v, k) => {
        if (v > best) {
          best = v;
          topTag = k;
        }
      });
      topDay = { ts: b.ts, label: fmtDate(b.ts), n: dn, topTag };
    }
  });

  // 메인: 해상도별 태그 누적 건수
  const unit = pickTagsUnit(win);
  const buckets = bucketize(recs, unit, win);
  const span = win.to - win.from;
  // 축 라벨: 1일 단위 → MM-DD, 1시간 단위 → 2일 이하면 매시 HH:MMZ, 그 이상이면 00Z(일 경계)에만 MM-DD (나머지는 빈 라벨)
  const labelOf = unit === 'day' ? fmtDay : span <= 2 * DAY ? fmtHM : (ts: number) => (ts % DAY === 0 ? fmtDay(ts) : '');
  const titleOf = unit === 'day' ? fmtDate : (ts: number) => `${fmtDT(ts)} ~ ${fmtHM(ts + HOUR)}`;
  let maxBucketTotal = 0;
  const items: TagBucketItem[] = buckets.map((b) => {
    const counts = new Array<number>(K).fill(0);
    let tot = 0;
    let idx: number | null = null;
    b.recs.forEach((r, j) => {
      if (r.tags.length && idx == null) idx = b.idx[j];
      r.tags.forEach((tg) => {
        counts[chipIdx.get(tg) as number]++;
        tot++;
      });
    });
    if (idx == null && b.idx.length) idx = b.idx[0];
    if (tot > maxBucketTotal) maxBucketTotal = tot;
    return { ts: b.ts, label: labelOf(b.ts), title: titleOf(b.ts), counts, total: tot, idx };
  });

  // 시간대별 + 그리드
  const hourCounts: number[][] = Array.from({ length: K }, () => new Array<number>(24).fill(0));
  const grid: TagHourCell[][] = Array.from({ length: K }, () => Array.from({ length: 24 }, () => ({ n: 0, idx: null as number | null })));
  recs.forEach((r, i) => {
    r.tags.forEach((tg) => {
      const k = chipIdx.get(tg) as number;
      hourCounts[k][r.hour]++;
      const cell = grid[k][r.hour];
      cell.n++;
      if (cell.idx == null) cell.idx = i;
    });
  });
  const hourTotals = new Array<number>(24).fill(0);
  let maxCell = 0;
  hourCounts.forEach((row) =>
    row.forEach((v, h) => {
      hourTotals[h] += v;
      if (v > maxCell) maxCell = v;
    }),
  );
  let maxHourTotal = 0;
  let topHour: TagsDetail['topHour'] = null;
  hourTotals.forEach((v, h) => {
    if (v > maxHourTotal) maxHourTotal = v;
    if (v > 0 && (!topHour || v > topHour.n)) topHour = { hour: h, n: v, ties: 0 };
  });
  if (topHour) {
    const th = topHour as { hour: number; n: number; ties: number };
    th.ties = hourTotals.filter((v) => v === th.n).length;
  }
  let fogTotal = 0;
  let fogNight = 0;
  ['BR', 'FG'].forEach((tg) => {
    const k = chipIdx.get(tg);
    if (k == null) return;
    hourCounts[k].forEach((v, h) => {
      fogTotal += v;
      if (h >= 3 && h <= 6) fogNight += v;
    });
  });
  const fog = { total: fogTotal, night: fogNight, pattern: fogTotal >= 4 && fogNight / fogTotal >= 0.5 };

  // 강도 분포 — 전문 1건당 코드별 가장 센 강도
  const intensityOf = new Map<string, [number, number, number]>();
  chips.forEach((c) => intensityOf.set(c.tag, [0, 0, 0]));
  recs.forEach((r) => {
    const best = new Map<string, number>();
    r.wx.forEach((g) => g.codes.forEach((code) => best.set(code, Math.max(best.get(code) ?? -1, INTENSITY_RANK[g.intensity]))));
    best.forEach((rank, code) => {
      const arr = intensityOf.get(code);
      if (arr) arr[rank]++;
    });
  });

  // 태그별 요약 + 이벤트 구간
  const events: TagRun[] = [];
  let longestRun: TagRun | null = null;
  const summaries: TagSummary[] = chips.map((c) => {
    const rs = runs(recs, (r) => r.tags.includes(c.tag)).map<TagRun>((run) => ({
      tag: c.tag,
      color: c.color,
      start: run.start,
      end: run.end,
      startTs: run.startTs,
      endTs: run.endTs,
      durMs: run.durMs,
      n: run.end - run.start + 1,
    }));
    let longest: TagRun | null = null;
    rs.forEach((r) => {
      events.push(r);
      if (!longest || r.durMs > longest.durMs || (r.durMs === longest.durMs && r.n > longest.n)) longest = r;
      if (!longestRun || r.durMs > longestRun.durMs || (r.durMs === longestRun.durMs && r.n > longestRun.n)) longestRun = r;
    });
    const first = rs[0];
    const last = rs[rs.length - 1];
    return {
      ...c,
      firstIdx: first ? first.start : -1,
      firstTs: first ? first.startTs : 0,
      lastIdx: last ? last.end : -1,
      lastTs: last ? last.endTs : 0,
      runCount: rs.length,
      longest,
      intensity: intensityOf.get(c.tag) ?? [0, 0, 0],
    };
  });
  events.sort((a, b) => a.startTs - b.startTs || a.start - b.start);

  return {
    n,
    total,
    tagged,
    taggedPct: pct(tagged, n),
    chips,
    top: chips[0] ?? null,
    tsCount,
    tsLastTs,
    topDay,
    unit,
    labelEvery: unit === 'hour' ? (span > 2 * DAY ? 1 : Math.max(1, Math.ceil(buckets.length / 13))) : undefined,
    buckets,
    items,
    maxBucketTotal,
    hourCounts,
    hourTotals,
    maxHourTotal,
    topHour,
    fog,
    grid,
    maxCell,
    summaries,
    events,
    longestRun,
    becmgN,
    tempoN,
    trendNullN,
    trendItems,
    recentN,
    recentCodes,
  };
}
