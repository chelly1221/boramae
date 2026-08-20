import type { Approach, AtisRecord, CloudLayer, Notice, NoticeKind, RunwayCondition, Runway, RvrReport, WxGroup } from '../types';

/*
 * RKSS 음성 ATIS 전문(텍스트) 파서.
 *
 * 전문은 문장 단위 줄로 구성된다 (예):
 *   ON AIR ID : TWR
 *   GIMPO INTERNATIONAL AIRPORT INFORMATION K TIME 1230 UTC.
 *   EXPECT ILS RWY14R APPROACH. / DEPARTURE RWY14L.
 *   SEOUL APPROACH FREQUENCY WILL BE 119.1. / SEOUL DEPARTURE FREQUENCY WILL BE 125.15.
 *   [RWY14R CONDITION REPORT AT 0600 UTC. RUNWAY CONDITION CODES 2, 0, 1 DOWNGRADED. FIRST PART … / RWY14L BRAKING ACTION …]
 *   RWY14R TOUCHDOWN WIND 200 AT 15 KNOTS. [VARIABLE BETWEEN 160 AND 220.] | RWY32R TOUCHDOWN. WIND VARIABLE BETWEEN 150 AND 210 2 KNOTS. | WIND CALM.
 *   CAV-OK. | VISIBILITY 10KM. | VISIBILITY 3 THOUSAND M. [WITH HVY RA.] [RWY14R TOUCHDOWN RVR … M. MID RVR … END RVR …]
 *   CLOUD. SCT 1 THOUSAND FEET. BKN 2 THOUSAND 5 HUNDRED FEET. | NSC. | SKY OBSCURED. VERTICAL VISIBILITY 2 HUNDRED FEET.
 *   TEMPERATURE 26 CENTIGRADE. DEW POINT 26. QNH 0998 HECTOPASCALS 2947 INCHES.
 *   [ADVISE WEATHER. RE RA. / WS RWY14R.]
 *   TREND WEATHER. NOSIG. | BECMG. VISIBILITY 2 THOUSAND M. FBL RA.
 *   [운영 공지: FLOCKS OF BIRDS … / GPS SIGNALS ARE UNRELIABLE … / FLOW CONTROL IN EFFECT ON RKPC BY 10 MINUTES. / …]
 *   ADVISE ON INITIAL CONTACT YOU HAVE INFORMATION K.
 *
 * 이 모듈은 의존성이 없다(타입만 import) — Node(`node --experimental-strip-types`)로 scripts/check-parse.ts에서
 * 전체 보관 파일에 대해 커버리지를 검증할 수 있게 하기 위함. 측풍/배풍 계산은 호출 측(atis/record.ts)에서 한다.
 */

/** 파서 출력 — 측풍/배풍(xw/tw)만 비어 있는 레코드 */
export type ParsedAtis = Omit<AtisRecord, 'xw' | 'tw'>;

export interface ParseResult {
  rec: ParsedAtis | null;
  /** 레코드를 만들지 못한 사유 (rec가 null일 때) */
  reason: string;
  /** 어떤 규칙에도 걸리지 않아 OTHER 공지로 넘어간 줄 (커버리지 점검용) */
  unknown: string[];
}

/** 진방위 활주로 heading — airport.ts와 동일 (의존성 없이 쓰려고 복제) */
const RUNWAY_TRUE_HEADING: Record<Runway, number> = { '32L/32R': 315, '14L/14R': 135 };

const pad2 = (n: number) => String(n).padStart(2, '0');
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ---------- 파일명 → 시각 ---------- */

/** "2026, 08 02, Sunday, 11 - 34 - 24.TXT" → epoch ms (UTC). 형식이 다르면 null */
export function fileNameTs(name: string): number | null {
  const m = /^(\d{4}),\s*(\d{2})\s+(\d{2}),\s*[A-Za-z]+,\s*(\d{2})\s*-\s*(\d{2})\s*-\s*(\d{2})\.txt$/i.exec(name.trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** 파일 시각(UTC)과 전문 헤더 HHMM을 합쳐 발행 시각을 만든다 (자정 넘김 보정: 12시간 이상 차이 나면 전/다음 날) */
export function issueTs(fileTs: number, hhmm: string | null): number {
  if (!hhmm || !/^\d{4}$/.test(hhmm)) return Math.floor(fileTs / MIN) * MIN;
  const hh = +hhmm.slice(0, 2);
  const mm = +hhmm.slice(2);
  if (hh > 23 || mm > 59) return Math.floor(fileTs / MIN) * MIN;
  const day = Math.floor(fileTs / DAY) * DAY;
  let ts = day + hh * HOUR + mm * MIN;
  if (ts - fileTs > 12 * HOUR) ts -= DAY;
  else if (fileTs - ts > 12 * HOUR) ts += DAY;
  return ts;
}

/* ---------- 숫자 낱말 ---------- */

/** "4 THOUSAND 5 HUNDRED" / "2 HUNDRED 50" / "10" / "8" → 정수. 해석 불가면 null */
export function wordNumber(s: string): number | null {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  let total = 0;
  let cur: number | null = null;
  for (const t of toks) {
    if (/^\d+$/.test(t)) {
      if (cur != null) total += cur; // "2 HUNDRED 50" 의 50처럼 단위 없이 이어지는 숫자
      cur = +t;
    } else if (t === 'THOUSAND') {
      total += (cur ?? 1) * 1000;
      cur = null;
    } else if (t === 'HUNDRED') {
      total += (cur ?? 1) * 100;
      cur = null;
    } else return null;
  }
  if (cur != null) total += cur;
  return total;
}

/* ---------- 기상 현상 코드 ---------- */

/** 강도 낱말 → METAR 부호 */
const INTENSITY: Record<string, WxGroup['intensity']> = { FBL: '-', MOD: '', HVY: '+' };
/** 알려진 현상/기술자 코드 (2글자) */
const WX_CODES = new Set([
  'TS', 'SH', 'FZ', 'MI', 'BC', 'PR', 'DR', 'BL', // 기술자
  'RA', 'SN', 'DZ', 'GR', 'GS', 'PL', 'SG', 'IC', 'UP', // 강수
  'BR', 'FG', 'FU', 'HZ', 'DU', 'SA', 'VA', // 시정 장애
  'PO', 'SQ', 'FC', 'SS', 'DS', // 기타
]);

/** "FBL TS RA BR AND MOD SN" → 묶음 목록 (코드 없는 묶음은 버림) */
export function parseWx(s: string): WxGroup[] {
  const out: WxGroup[] = [];
  for (const part of s.split(/\s+AND\s+/)) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    let intensity: WxGroup['intensity'] = '';
    const codes: string[] = [];
    toks.forEach((t, i) => {
      if (i === 0 && t in INTENSITY) intensity = INTENSITY[t];
      else if (WX_CODES.has(t) && !codes.includes(t)) codes.push(t);
    });
    if (codes.length) out.push({ intensity, codes, text: toks.join(' ') });
  }
  return out;
}

/* ---------- 공지 분류 ---------- */

const NOTICE_RULES: [RegExp, NoticeKind][] = [
  [/FLOCKS? OF BIRDS?/, 'BIRDS'],
  [/GPS|GEOMAGN/, 'GPS'],
  [/FLOW CONTROL/, 'FLOW'],
  [/WINDSHEAR|WIND SHEAR|^WS RWY/, 'WS'],
  [/LOW VISIBILITY PROCEDURES|CAT-?II|CAT-?III|LATEST CEILING AND VISIBILITY/, 'LVP'],
  [/GRASS CUTTING|GLASS CUTTING/, 'GRASS'],
  [/FLIGHT CHECK/, 'FLTCK'],
  [/BALLOO?N/, 'BALLOON'],
  [/GP OUT OF SERVICE|GLIDE ?PATH OUT/, 'GP_OTS'],
  [/WORK(ING)? IN PROGRESS/, 'WIP'],
  [/AIRPORT CLOSED|PROHIBITED TAKE ?OFF/, 'CLOSED'],
];

/** 공지 문장 분류 — 어떤 규칙에도 안 걸리면 null */
export function classifyNotice(text: string): NoticeKind | null {
  for (const [re, kind] of NOTICE_RULES) if (re.test(text)) return kind;
  return null;
}

/** "FLOW CONTROL IN EFFECT ON RKPC BY 10 MINUTES AND Y 2 BY 5 MINUTES" → [{dest:'RKPC',min:10},{dest:'Y2',min:5}] */
export function parseFlow(text: string): { dest: string; min: number }[] {
  const out: { dest: string; min: number }[] = [];
  const body = text.replace(/^.*?IN EFFECT\s*/, '').replace(/^AND\s+/, '');
  for (const piece of body.split(/\s+AND\s+/)) {
    const m = /^(?:ON\s+)?(.+?)\s+BY\s+(\d+)\s+MINUTES?/.exec(piece.trim());
    if (!m) continue;
    const dest = m[1].replace(/\s+/g, '');
    if (dest) out.push({ dest, min: +m[2] });
  }
  return out;
}

/* ---------- 본 파서 ---------- */

type Section = 'main' | 'cloud' | 'advise' | 'trend' | 'rmk';

const RWY = '(\\d{2}[LRC]?)';

/**
 * 전문 텍스트 1건 → 레코드.
 * @param text  파일 내용
 * @param file  파일명 (시각·원본 추적)
 * @param mtime 파일 수정 시각 (파일명에서 시각을 못 읽을 때 대체)
 */
export function parseAtis(text: string, file: string, mtime: number): ParseResult {
  const raw = text.replace(/\r\n?/g, '\n').trim();
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const unknown: string[] = [];

  let letter = '';
  let hhmm: string | null = null;
  let arrRwy: string | null = null;
  let depRwy: string | null = null;
  let app: Approach | null = null;
  let appName = '';
  let appFreq: string | null = null;
  let depFreq: string | null = null;
  let dir: number | null = null;
  let spd: number | null = null;
  let gust: number | null = null;
  let varFrom: number | null = null;
  let varTo: number | null = null;
  let vrb = false;
  let calm = false;
  let visM: number | null = null;
  let cavok = false;
  const rvr: RvrReport[] = [];
  let lastRvrRwy = '';
  const clouds: CloudLayer[] = [];
  let nsc: 'NSC' | 'SKC' | null = null;
  let vv: number | null = null;
  let obscured = false;
  let t: number | null = null;
  let dp: number | null = null;
  let qnh: number | null = null;
  let qnhIn: number | null = null;
  const wx: WxGroup[] = [];
  const recent: string[] = [];
  let trend: ParsedAtis['trend'] = null;
  const trendLines: string[] = [];
  const rwyCond: RunwayCondition[] = [];
  const notices: Notice[] = [];
  let section: Section = 'main';
  /** 다음 공지 문장에 붙일 선행 구절 ("AT 3 THOUSAND FEET." → "LOW LEVEL WINDSHEAR ADVISORIES IN EFFECT AT 3 THOUSAND FEET") */
  let pending = '';

  const cond = () => {
    if (!rwyCond.length) rwyCond.push({ rwy: '', at: null, codes: null, note: '', parts: [], braking: null, reportedBy: null, extra: [] });
    return rwyCond[rwyCond.length - 1];
  };
  const newCond = (rwy: string, at: string | null): RunwayCondition => {
    const c: RunwayCondition = { rwy, at, codes: null, note: '', parts: [], braking: null, reportedBy: null, extra: [] };
    rwyCond.push(c);
    return c;
  };
  const addNotice = (text0: string) => {
    const text = pending ? `${text0} ${pending}` : text0;
    pending = '';
    const kind = classifyNotice(text);
    if (!kind) unknown.push(text);
    const n: Notice = { kind: kind ?? 'OTHER', text };
    const rm = new RegExp(`RWY\\s?${RWY}`).exec(text);
    if (rm) n.rwy = rm[1];
    if (kind === 'FLOW') n.flow = parseFlow(text);
    notices.push(n);
    section = 'rmk';
  };
  /** 흐름관리 이어쓰기 줄 ("AND RKPC BY 5 MINUTES") → 직전 FLOW 공지에 합침 */
  const flowContinuation = (text: string): boolean => {
    if (!/^AND\s+.+\s+BY\s+\d+\s+MINUTES?$/.test(text)) return false;
    const last = notices[notices.length - 1];
    const pairs = parseFlow(text);
    if (last && last.kind === 'FLOW') {
      last.text += ' ' + text;
      last.flow = [...(last.flow ?? []), ...pairs];
    } else notices.push({ kind: 'FLOW', text, flow: pairs });
    return true;
  };

  for (const line0 of lines) {
    const line = line0.replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    let m: RegExpExecArray | null;

    /* --- 헤더/푸터/운용자 --- */
    if (/^ON AIR ID\b/.test(line)) continue;
    if ((m = /INFORMATION\s+([A-Z])?\s*TIME\s+(\d{3,4})?\s*UTC/.exec(line))) {
      if (m[1]) letter = m[1];
      if (m[2]) hhmm = m[2].padStart(4, '0');
      continue;
    }
    if (/^GIMPO INTERNATIONAL AIRPORT INFORMATION\b/.test(line)) {
      const lm = /INFORMATION\s+([A-Z])\b/.exec(line);
      if (lm && !letter) letter = lm[1];
      continue;
    }
    if ((m = /^ADVISE ON INITIAL CONTACT YOU HAVE INFORMATION\s*([A-Z])?/.exec(line))) {
      if (!letter && m[1]) letter = m[1];
      continue;
    }

    /* --- 공지(remarks)는 어느 위치에 있어도 먼저 분류 --- */
    if (flowContinuation(line)) continue;
    if (/FLOW CONTROL/.test(line)) {
      addNotice(line);
      continue;
    }
    if (/^WS RWY|WINDSHEAR|WIND SHEAR/.test(line)) {
      addNotice(line);
      continue;
    }
    if (/^(FLOCKS? OF BIRDS?|GPS |GPS$|EXCISE EXTREME CAUTION|EXERCISE EXTREME CAUTION|BECAUSE OF GEOMAGN|USE CAUTION|USE CATIOM|GRASS CUTTING|GLASS CUTTING|FLIGHT CHECK|GP OUT OF SERVICE|WORK(ING)? IN PROGRESS|ADVICE ATC|CHECK YOUR QUALIFICATION|LATEST CEILING|GIMPO INTERNATIONAL AIRPORT CLOSED|ALL AIRCRAFT PROHIBITED|LOW LEVEL WINDSHEAR)/.test(line)) {
      addNotice(line);
      continue;
    }

    /* --- 접근/출발 --- */
    if ((m = new RegExp(`^(?:EXPECT\\s+)?(ILS(?:\\s+[A-Z])?|RNP(?:\\s+[A-Z])?|LOC(?:\\s+[A-Z])?|VOR(?:\\s+[A-Z])?)\\s*(?:RWY\\s?${RWY})?\\s+APPROACH$`).exec(line))) {
      const name = m[1].replace(/\s+/g, ' ');
      if (!app) {
        app = name.startsWith('ILS') ? 'ILS' : name.startsWith('RNP') ? 'RNP' : 'LOC';
        appName = name;
      }
      if (m[2] && !arrRwy) arrRwy = m[2];
      continue;
    }
    if ((m = new RegExp(`^(?:EXPECT\\s+)?RWY\\s?${RWY}\\s+APPROACH$`).exec(line))) {
      if (!arrRwy) arrRwy = m[1];
      continue;
    }
    if ((m = new RegExp(`^DEPARTURE\\s+RWY\\s?${RWY}$`).exec(line))) {
      depRwy = m[1];
      continue;
    }
    if ((m = /^SEOUL APPROACH FREQUENCY WILL BE\s+([\d.]+?)\.?$/.exec(line))) {
      appFreq = m[1];
      continue;
    }
    if ((m = /^SEOUL DEPARTURE FREQUENCY WILL BE\s+([\d.]+?)\.?$/.exec(line))) {
      depFreq = m[1];
      continue;
    }

    /* --- 활주로 표면 상태 --- */
    if ((m = new RegExp(`^RWY\\s?${RWY}\\s+CONDITION REPORT(?:\\s+AT\\s+(\\d{4})\\s*UTC)?$`).exec(line))) {
      newCond(m[1], m[2] ?? null);
      continue;
    }
    if ((m = /^RUNWAY CONDITION CODES?\s+([\d,\s]+?)\s*([A-Z].*)?$/.exec(line))) {
      const c = cond();
      c.codes = m[1]
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number);
      c.note = (m[2] ?? '').trim();
      continue;
    }
    if (/^(FIRST|SECOND|THIRD) PART\b/.test(line)) {
      cond().parts.push(line);
      continue;
    }
    if ((m = new RegExp(`^RWY\\s?${RWY}\\s+BRAKING ACTION REPORTED BY\\s+(.+?)\\s+AT\\s+(\\d{4})\\s*UTC,?\\s*(.+)$`).exec(line))) {
      const c = newCond(m[1], m[3]);
      c.reportedBy = m[2].replace(/\s*-\s*/g, '-');
      c.braking = m[4].trim();
      continue;
    }
    if ((m = new RegExp(`^(?:RWY\\s?${RWY}\\s+)?(?:RUNWAY\\s+)?(?:RUNWAY CONDITION\\s+(.+?)\\s+)?BRAKING ACTION\\s+(.+?)(?:\\s+REPORTED BY\\s+(.+))?$`).exec(line))) {
      const c = newCond(m[1] ?? '', null);
      if (m[2]) c.extra.push(m[2].trim());
      c.braking = m[3].trim();
      c.reportedBy = m[4] ? m[4].replace(/\s*-\s*/g, '-') : null;
      continue;
    }
    if ((m = new RegExp(`^RWY\\s?${RWY}\\s+RUNWAY CONDITION\\s+(.+)$`).exec(line))) {
      const c = newCond(m[1], null);
      c.extra.push(m[2].trim());
      continue;
    }
    if (/^(RUNWAY (WIDTH|DRIFTING|CHEMICALLY|CONDITION)|TAXIWAY\b)/.test(line)) {
      cond().extra.push(line);
      continue;
    }

    /* --- 바람 --- */
    if ((m = /^(?:RWY\s?\d{2}[LRC]?\s+)?(?:TOUCHDOWN\s+)?WIND\s+(\d{3})\s+AT\s+(?:(\d+)\s+)?(?:GUST\s+(\d+)\s+)?KNOTS?$/.exec(line))) {
      dir = +m[1] % 360;
      gust = m[3] != null ? +m[3] : null;
      spd = m[2] != null ? +m[2] : gust ?? 0;
      continue;
    }
    if (/^RWY\s?\d{2}[LRC]?\s+TOUCHDOWN$/.test(line)) continue; // 다음 줄에 "WIND VARIABLE BETWEEN …"
    if (/^WIND CALM$/.test(line)) {
      calm = true;
      dir = 0;
      spd = 0;
      continue;
    }
    if ((m = /^(?:WIND\s+)?VARIABLE BETWEEN\s+(\d{3})\s+AND\s+(\d{3})(?:\s+(\d+)\s+KNOTS?)?$/.exec(line))) {
      varFrom = +m[1] % 360;
      varTo = +m[2] % 360;
      if (dir == null) {
        // 풍향 없는 VRB — 대표 풍향은 변동 범위의 중앙
        vrb = true;
        const span = (varTo - varFrom + 360) % 360;
        dir = (varFrom + span / 2) % 360;
        spd = m[3] != null ? +m[3] : spd ?? 0;
      } else if (spd == null && m[3] != null) spd = +m[3];
      continue;
    }

    /* --- 시정 / RVR --- */
    if (/^CAV-?OK$/.test(line)) {
      if (section === 'trend') trendLines.push(line);
      else {
        cavok = true;
        visM = 10000;
      }
      continue;
    }
    if ((m = /^VISIBILITY\s+(.+?)\s*(KM|M)$/.exec(line))) {
      if (section === 'trend') {
        trendLines.push(line);
        continue;
      }
      const n = wordNumber(m[1]);
      if (n != null) visM = m[2] === 'KM' ? n * 1000 : n;
      else unknown.push(line);
      continue;
    }
    if ((m = new RegExp(`^(?:RWY\\s?${RWY}\\s+)?(TOUCHDOWN|MID|END)\\s+RVR\\s+(.+?)\\s*M$`).exec(line))) {
      const n = wordNumber(m[3]);
      if (m[1]) lastRvrRwy = m[1];
      if (n != null) rvr.push({ rwy: lastRvrRwy, pos: m[2] === 'TOUCHDOWN' ? 'TDZ' : (m[2] as 'MID' | 'END'), m: n });
      else unknown.push(line);
      continue;
    }

    /* --- 구름 --- */
    if (/^CLOUDS?$/.test(line)) {
      if (section !== 'trend') section = 'cloud';
      else trendLines.push(line);
      continue;
    }
    if ((m = /^(FEW|SCT|BKN|OVC)(?:\s+(CB|TCU))?(?:\s+(.+?)\s+FEET)?$/.exec(line))) {
      if (section === 'trend') {
        trendLines.push(line);
        continue;
      }
      const ft = m[3] ? wordNumber(m[3]) : null;
      if (ft == null) {
        unknown.push(line);
        continue;
      }
      clouds.push({ cover: m[1] as CloudLayer['cover'], ft, cb: m[2] === 'CB' || m[2] === 'TCU' });
      continue;
    }
    if (/^(NSC|SKC|NCD)$/.test(line)) {
      if (section === 'trend') trendLines.push(line);
      else nsc = line === 'SKC' ? 'SKC' : 'NSC';
      continue;
    }
    if (/^SKY OBSCURED$/.test(line)) {
      obscured = true;
      continue;
    }
    if ((m = /^VERTICAL VISIBILITY\s+(.+?)\s+FEET$/.exec(line))) {
      const ft = wordNumber(m[1]);
      if (ft != null) vv = ft;
      else unknown.push(line);
      continue;
    }
    if (/^AT\s+.+?\s+FEET$/.test(line)) {
      // TREND 안의 고도 이어쓰기는 TREND 내용으로, 그 외("AT 3 THOUSAND FEET." 뒤 윈드시어 공지)는 다음 공지에 붙인다
      if (section === 'trend') trendLines.push(line);
      else pending = line;
      continue;
    }

    /* --- 온도 / 노점 / QNH --- */
    if ((m = /^TEMPERATURE\s+(MINUS\s+)?(\d+)\s*(?:CENTIGRADE|DEGREES?)?$/.exec(line))) {
      t = (m[1] ? -1 : 1) * +m[2] || 0;
      continue;
    }
    if ((m = /^DEW ?POINT\s+(MINUS\s+)?(\d+)$/.exec(line))) {
      dp = (m[1] ? -1 : 1) * +m[2] || 0;
      continue;
    }
    if ((m = /^QNH\s+(\d{3,4})\s*HECTOPASCALS?(?:\s+(\d{4})\s*INCHES)?$/.exec(line))) {
      qnh = +m[1];
      qnhIn = m[2] ? +m[2] : null;
      continue;
    }

    /* --- 보조 기상 (ADVISE WEATHER) / TREND --- */
    if (/^ADVISE WEATHER$/.test(line)) {
      section = 'advise';
      continue;
    }
    if (/^TREND WEATHER$/.test(line)) {
      section = 'trend';
      continue;
    }
    if (/^NOSIG$/.test(line)) {
      if (!trend) trend = 'NOSIG';
      section = 'trend';
      continue;
    }
    if ((m = /^(BECMG|TEMPO)\b/.exec(line))) {
      if (!trend || trend === 'NOSIG') trend = m[1] as 'BECMG' | 'TEMPO';
      trendLines.push(line);
      section = 'trend';
      continue;
    }
    if (/^NSW$/.test(line)) {
      trendLines.push(line);
      continue;
    }
    if ((m = /^RE\s+([A-Z ]+)$/.exec(line))) {
      parseWx(m[1]).forEach((g) => g.codes.forEach((c) => recent.includes(c) || recent.push(c)));
      continue;
    }
    if ((m = /^(?:WITH\s+)?((?:FBL|MOD|HVY|TS|SH|FZ|MI|BC|PR|DR|BL|RA|SN|DZ|GR|GS|PL|SG|IC|UP|BR|FG|FU|HZ|DU|SA|VA|PO|SQ|FC|SS|DS|TCB|SEV|AND)(?:\s+(?:FBL|MOD|HVY|TS|SH|FZ|MI|BC|PR|DR|BL|RA|SN|DZ|GR|GS|PL|SG|IC|UP|BR|FG|FU|HZ|DU|SA|VA|PO|SQ|FC|SS|DS|TCB|SEV|AND))*)$/.exec(line))) {
      if (section === 'trend') trendLines.push(line);
      else if (section === 'advise') unknown.push(line); // 시운전 시기의 임의 입력 — 현재 기상으로 취급하지 않음
      else wx.push(...parseWx(m[1]));
      continue;
    }

    /* --- 그 외: 공지로 분류 시도 --- */
    addNotice(line);
  }

  /* ---------- 검증 ---------- */
  const missing: string[] = [];
  if (!letter) letter = '?';
  if (dir == null || spd == null) missing.push('바람');
  if (visM == null) missing.push('시정');
  if (t == null) missing.push('기온');
  if (dp == null) missing.push('노점');
  if (qnh == null) missing.push('QNH');
  if (!arrRwy && !depRwy) missing.push('활주로');
  if (missing.length) return { rec: null, reason: `${missing.join('·')} 없음`, unknown };

  const fileTs = fileNameTs(file) ?? mtime;
  const ts = issueTs(fileTs, hhmm);
  const d = new Date(ts);

  const rwyRef = arrRwy ?? depRwy ?? '';
  const rwy: Runway = rwyRef.startsWith('14') ? '14L/14R' : '32L/32R';
  if (!(rwy in RUNWAY_TRUE_HEADING)) return { rec: null, reason: `활주로 해석 불가 ${rwyRef}`, unknown };

  const visKm = visM! / 1000;
  const vis = Math.min(10, visKm);
  const visTxt = visM! >= 10000 ? '10KM' : visM! >= 1000 ? `${Number((visM! / 1000).toFixed(1))}KM` : `${visM}M`;

  const ceilLayers = clouds.filter((c) => c.cover === 'BKN' || c.cover === 'OVC').map((c) => c.ft);
  let ceil: number | null = ceilLayers.length ? Math.min(...ceilLayers) : null;
  if (vv != null && (ceil == null || vv < ceil)) ceil = vv;
  const cloud = cavok
    ? 'CAVOK'
    : clouds.length
      ? clouds.map((c) => `${c.cover}${pad3(Math.round(c.ft / 100))}${c.cb ? 'CB' : ''}`).join(' ')
      : vv != null
        ? `VV${pad3(Math.round(vv / 100))}`
        : obscured
          ? 'VV///'
          : (nsc ?? 'NSC');

  const tags: string[] = [];
  wx.forEach((g) => g.codes.forEach((c) => tags.includes(c) || tags.push(c)));

  const spdI = Math.round(spd!);
  const wind = calm ? 'CALM' : `${vrb ? 'VRB' : pad3(Math.round(dir! / 10) * 10 || 360)}/${pad2(spdI)}${gust != null ? `G${pad2(gust)}` : ''}KT`;

  const rec: ParsedAtis = {
    ts,
    time: `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z`,
    hour: d.getUTCHours(),
    letter,
    dir: dir!,
    spd: spdI,
    gust,
    varFrom,
    varTo,
    vrb,
    calm,
    vis,
    visTxt,
    cavok,
    rvr,
    cloud,
    clouds,
    vv,
    ceil,
    t: t!,
    dp: dp!,
    qnh: qnh!,
    qnhIn,
    rwy,
    arrRwy,
    depRwy,
    app: app ?? 'ILS',
    appName: appName || (app ? app : 'ILS'),
    appFreq,
    depFreq,
    tags,
    wx,
    wxTxt: wx.map((g) => g.text).join(' AND '),
    recent,
    trend,
    trendTxt: trendLines.join(' '),
    rwyCond,
    notices,
    birds: [],
    wind,
    raw,
    file,
  };
  return { rec, reason: '', unknown };
}

const pad3 = (n: number) => String(n).padStart(3, '0');

/** 사용 활주로 진방위 기준 측풍/배풍 성분 (KT) */
export function windComponents(rwy: Runway, dir: number, spd: number): { xw: number; tw: number } {
  const rel = ((dir - RUNWAY_TRUE_HEADING[rwy]) * Math.PI) / 180;
  return { xw: Math.abs(spd * Math.sin(rel)), tw: Math.max(0, -spd * Math.cos(rel)) };
}

/** 파서 출력 → 완전한 레코드 (측풍/배풍 포함) */
export function toRecord(p: ParsedAtis): AtisRecord {
  const { xw, tw } = p.calm ? { xw: 0, tw: 0 } : windComponents(p.rwy, p.dir, p.spd);
  return { ...p, xw, tw };
}
