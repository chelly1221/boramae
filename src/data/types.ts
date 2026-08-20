export type View = 'stats' | 'map' | 'import';
export type Range = '24h' | '7d' | '30d';
/** 사용 활주로 방향 (측풍·지도·전환 판정 기준). 실제 착륙/이륙 활주로는 arrRwy/depRwy */
export type Runway = '32L/32R' | '14L/14R';
/** 접근 방식 — 전문 "EXPECT ILS (Z) RWY.. APPROACH" / "EXPECT RNP APPROACH" / "LOC Y APPROACH" */
export type Approach = 'ILS' | 'RNP' | 'LOC';

/** 통계 카드 → 상세 페이지 키 (시계열이 의미 있는 항목) */
export type DetailKey = 'temp' | 'wind' | 'xwind' | 'runway' | 'heat' | 'update' | 'cloud' | 'qnh' | 'vis' | 'tags' | 'rwycond' | 'notice' | 'bird';

/** 조류 무리 규모 — HVY 큰 무리 / LGT 작은 무리 */
export type BirdKind = 'HVY' | 'LGT';
/** 8방위 (ARP 기준) */
export type Dir8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** ATIS remarks의 조류 활동 보고 1건 — "HVY FLOCK 5NM NW" (현재 전문에는 아직 없음, 모델만 유지) */
export interface BirdReport {
  kind: BirdKind;
  /** ARP 기준 방위 */
  dir: Dir8;
  /** ARP 기준 거리 (NM) */
  nm: number;
}

/** 상세 페이지 조회 기간 (epoch ms, UTC, [from, to]) */
export interface TimeWindow {
  from: number;
  to: number;
}

/** 현재 기상 1묶음 — "WITH FBL TS RA BR" → { intensity: '-', codes: ['TS','RA','BR'] } */
export interface WxGroup {
  /** FBL '-' / MOD '' / HVY '+' */
  intensity: '-' | '' | '+';
  /** 2글자 현상·기술자 코드 (TS RA BR FG PR SH DZ SN HZ FU DU …) */
  codes: string[];
  /** 원문 토큰 ("FBL TS RA BR") */
  text: string;
}

/** 구름층 1개 — "BKN 2 THOUSAND 5 HUNDRED FEET" → { cover: 'BKN', ft: 2500 } */
export interface CloudLayer {
  cover: 'FEW' | 'SCT' | 'BKN' | 'OVC';
  ft: number;
  cb: boolean;
}

/** RVR 보고 1건 — "RWY32R TOUCHDOWN RVR 1 THOUSAND 2 HUNDRED M" / "MID RVR …" / "END RVR …" */
export interface RvrReport {
  rwy: string;
  pos: 'TDZ' | 'MID' | 'END';
  m: number;
}

/** 활주로 표면 상태 보고 (겨울철 RWYCC 보고 · 제동작용 보고) */
export interface RunwayCondition {
  /** 보고 대상 활주로 ("32R") — 알 수 없으면 '' */
  rwy: string;
  /** 보고 시각 "HHMM" (UTC) — 없으면 null */
  at: string | null;
  /** RWYCC 3분할 코드 [첫/중간/끝] (드물게 2개) — 없으면 null */
  codes: number[] | null;
  /** 코드 줄 꼬리말 (DOWNGRADED / WET / DRY SNOW …) */
  note: string;
  /** 구간별 오염 상태 문장 ("FIRST PART 25 PERCENT 15 MILIMETERS WET SNOW …") */
  parts: string[];
  /** 제동작용 보고 ("GOOD TO MEDIUM") — 없으면 null */
  braking: string | null;
  /** 제동작용 보고 기체 ("A380", "M A-320") */
  reportedBy: string | null;
  /** 기타 상태 문장 (RUNWAY WIDTH 15 / DRIFTING SNOW / CHEMICALLY TREATED / TAXIWAY B2 POOR …) */
  extra: string[];
}

/** 운영 공지(remarks) 종류 */
export type NoticeKind =
  | 'GPS' // GPS 신호 불량/간섭
  | 'FLOW' // 흐름관리 (출발 지연)
  | 'WS' // 윈드시어 경보/주의보
  | 'LVP' // 저시정 절차 (CAT-II/III)
  | 'GRASS' // 잔디 깎기
  | 'FLTCK' // 비행검사
  | 'BALLOON' // 미상 자유기구
  | 'GP_OTS' // 활공각(GP) 운용 중단
  | 'WIP' // 공사 (WORK IN PROGRESS)
  | 'CLOSED' // 공항 폐쇄 (수능 등)
  | 'BIRDS' // 조류 일반 주의 (FLOCKS OF BIRDS VICINITY AIRPORT)
  | 'OTHER'; // 분류되지 않은 공지

/** 운영 공지 1건 */
export interface Notice {
  kind: NoticeKind;
  /** 원문 문장 (마침표 제거) */
  text: string;
  /** 관련 활주로 ("14L") — 있으면 */
  rwy?: string;
  /** 흐름관리: 대상 (RKPC / Y2 …) 과 지연 분 */
  flow?: { dest: string; min: number }[];
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
  /** 풍향(도). VRB/CALM은 0 */
  dir: number;
  /** 풍속(KT, 정수) */
  spd: number;
  /** 돌풍(KT) — 없으면 null */
  gust: number | null;
  /** 풍향 변동 범위 "VARIABLE BETWEEN a AND b" — 없으면 null */
  varFrom: number | null;
  varTo: number | null;
  /** 풍향 VRB / CALM */
  vrb: boolean;
  calm: boolean;
  /** 시정(km, 10 = 10km 이상/CAVOK, 1 미만은 소수) */
  vis: number;
  visTxt: string;
  cavok: boolean;
  /** RVR 보고 (없으면 빈 배열) */
  rvr: RvrReport[];
  /** 구름 요약 코드 — "CAVOK" / "NSC" / "SKC" / "VV002" / "FEW010 BKN025CB" */
  cloud: string;
  clouds: CloudLayer[];
  /** 수직 시정(ft) — 없으면 null */
  vv: number | null;
  /** 실링(ft) — BKN/OVC 최저층, VV 포함. 없으면 null */
  ceil: number | null;
  t: number;
  dp: number;
  qnh: number;
  /** QNH inHg ×100 (2980) — 없으면 null */
  qnhIn: number | null;
  /** 사용 활주로 방향 (착륙 활주로 기준, 없으면 이륙 활주로) */
  rwy: Runway;
  /** 착륙 활주로 ("32R") — 없으면 null */
  arrRwy: string | null;
  /** 이륙 활주로 ("32L") — 없으면 null */
  depRwy: string | null;
  /** 사용 활주로 기준 측풍 성분(KT) */
  xw: number;
  /** 사용 활주로 기준 배풍 성분(KT) */
  tw: number;
  app: Approach;
  /** 접근 명칭 원문 ("ILS" / "ILS Z" / "RNP" / "LOC Y") */
  appName: string;
  /** 접근/출발 관제 주파수 — 없으면 null */
  appFreq: string | null;
  depFreq: string | null;
  /** 현재 기상 현상 코드 (중복 제거, 강도 제외) — 카드/히트맵 집계용 */
  tags: string[];
  /** 현재 기상 묶음 (강도 포함 원문) */
  wx: WxGroup[];
  /** "FBL TS RA BR" / "" */
  wxTxt: string;
  /** 최근 기상 (RE RA → ['RA']) */
  recent: string[];
  /** TREND 예보 종류 — 없으면 null */
  trend: 'NOSIG' | 'BECMG' | 'TEMPO' | null;
  /** TREND 내용 원문 ("BECMG VISIBILITY 2 THOUSAND M FBL RA") */
  trendTxt: string;
  /** 활주로 표면 상태 보고 (없으면 빈 배열) */
  rwyCond: RunwayCondition[];
  /** 운영 공지 (없으면 빈 배열) */
  notices: Notice[];
  /** 조류 활동 보고 (remarks) — 없으면 빈 배열 */
  birds: BirdReport[];
  /** "DDD/SSKT" · "DDD/SSGGGKT" · "VRB/SSKT" · "CALM" */
  wind: string;
  raw: string;
  /** 원본 파일명 */
  file: string;
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

/** 감시 폴더에서 읽어 온 파일 1개 (백엔드 → 프론트) */
export interface AtisFile {
  name: string;
  /** 수정 시각 (epoch ms) */
  mtime: number;
  text: string;
}

export interface ImportedFile {
  name: string;
  /** 파싱 결과 — 레코드 생성 여부와 사유 */
  ok: boolean;
  reason: string;
  /** 레코드 시각 (epoch ms) — 실패면 null */
  ts: number | null;
  mtime: number;
}
