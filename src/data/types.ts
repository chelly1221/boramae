export type View = 'stats' | 'map' | 'import';
export type Range = '24h' | '7d' | '30d';
export type Runway = '32L/32R' | '14L/14R';
export type Approach = 'ILS' | 'RNP' | 'VOR';

/** 통계 카드 → 상세 페이지 키 (시계열이 의미 있는 항목) */
export type DetailKey = 'temp' | 'wind' | 'xwind' | 'runway' | 'heat' | 'update' | 'cloud' | 'qnh' | 'vis' | 'tags';

/** 상세 페이지 조회 기간 (epoch ms, UTC, [from, to]) */
export interface TimeWindow {
  from: number;
  to: number;
}

/** 파싱된 ATIS 전문 1건 */
export interface AtisRecord {
  /** 발행 시각 (epoch ms, UTC) */
  ts: number;
  /** 표시용 시각 — "MM-DD HHMMZ" */
  time: string;
  /** UTC 시 (0–23) */
  hour: number;
  /** INFO 레터 */
  letter: string;
  /** 풍향(도, 실수) */
  dir: number;
  /** 풍속(KT, 정수) */
  spd: number;
  /** 시정(km, 10 = 10km 이상, 1 미만은 0.5 단위 소수) */
  vis: number;
  visTxt: string;
  cloud: string;
  /** 실링(ft) — 없으면 null */
  ceil: number | null;
  t: number;
  dp: number;
  qnh: number;
  rwy: Runway;
  /** 사용 활주로 기준 측풍 성분(KT) */
  xw: number;
  /** 사용 활주로 기준 배풍 성분(KT) */
  tw: number;
  app: Approach;
  tags: string[];
  /** "DDD/SSKT" */
  wind: string;
  raw: string;
}

export interface HeatCell {
  bg: string;
  title: string;
  /** 셀 시간대 시작 (epoch ms) */
  ts: number;
  /** 셀 시간대에 속한 첫 레코드 인덱스 (레코드 배열 기준) — 없으면 null */
  index: number | null;
}

export interface HeatRow {
  day: string;
  /** 일 시작 (epoch ms, UTC) */
  dayTs: number;
  cells: HeatCell[];
}

export interface ImportedFile {
  name: string;
  count: number;
  at: string;
}
