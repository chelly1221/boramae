export type View = 'stats' | 'map' | 'import';
export type Range = '24h' | '7d' | '30d';
export type Runway = '32L/32R' | '14L/14R';
export type Approach = 'ILS' | 'RNP' | 'VOR';

/** 파싱된 ATIS 전문 1건 */
export interface AtisRecord {
  /** 표시용 시각 — 24h: "HHMMZ", 그 외: "MM-DD HHMMZ" */
  time: string;
  /** UTC 시 (0–23) */
  hour: number;
  /** INFO 레터 */
  letter: string;
  /** 풍향(도, 실수) */
  dir: number;
  /** 풍속(KT, 정수) */
  spd: number;
  /** 시정(km, 10 = 10km 이상) */
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
}

export interface HeatRow {
  day: string;
  cells: HeatCell[];
}

export interface ImportedFile {
  name: string;
  count: number;
  at: string;
}
