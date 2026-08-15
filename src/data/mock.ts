import { RUNWAY_TRUE_HEADING } from './airport';
import type { Approach, AtisRecord, ImportedFile, Range, Runway, TimeWindow } from './types';

/*
 * 데모용 목데이터 — 시각(ts)의 결정적 함수로 합성한다. 같은 시각은 어떤 기간으로 조회하든 같은 값.
 * 계절(기온·풍향·QNH·강수 확률)과 일변화(기온·풍속)를 반영하고, 새벽 03–06Z 안개·강수·뇌전 이벤트를 넣는다.
 * 정기 발행(:00/:30) 외에 상태가 크게 바뀌면 :15/:45에 임시 갱신 전문을 추가한다.
 * 실제 구현에서는 Tauri 백엔드(파서/DB)에서 오는 레코드로 대체.
 */

/** 데모 "현재" 시각 */
export const MOCK_NOW = Date.UTC(2026, 7, 15, 12, 0);
/** 데이터 보유 시작 (기간 선택 하한) */
export const DATA_START = Date.UTC(2024, 0, 1);

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT = 15 * MIN;

const RANGE_MS: Record<Range, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

/** 툴바 기간(24h/7d/30d) → 조회 창 */
export function rangeWindow(range: Range): TimeWindow {
  return { from: MOCK_NOW - RANGE_MS[range], to: MOCK_NOW };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pad2 = (n: number) => String(n).padStart(2, '0');

/* ---------- 결정적 난수 / 노이즈 ---------- */

/** 정수 n, salt → [0,1) */
function h01(n: number, salt: number): number {
  let x = Math.imul(n | 0, 374761393) + Math.imul(salt | 0, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** 부드러운 값 노이즈 [-1,1] — period(ms) 단위 격자를 smoothstep 보간 */
function vnoise(ts: number, period: number, salt: number): number {
  const p = ts / period;
  const i = Math.floor(p);
  const f = p - i;
  const s = f * f * (3 - 2 * f);
  const a = h01(i, salt) * 2 - 1;
  const b = h01(i + 1, salt) * 2 - 1;
  return a + (b - a) * s;
}

/* ---------- 시각 → 기상 상태 ---------- */

interface Wx {
  t: number;
  dp: number;
  dir: number;
  spd: number;
  vis: number;
  cloud: string;
  ceil: number | null;
  qnh: number;
  rwy: Runway;
  tags: string[];
}

function wxAt(ts: number): Wx {
  const d = new Date(ts);
  const doy = (ts - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY;
  const hUTC = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dayKey = Math.floor(ts / DAY);
  /** 1 = 한겨울(1/20), -1 = 한여름(7/22) */
  const season = Math.cos((2 * Math.PI * (doy - 20)) / 365);

  // 기온: 계절 평균 + 일변화(05Z=14KST 최고) + 노이즈
  const diurnal = Math.cos((2 * Math.PI * (hUTC - 5)) / 24);
  const t = 11.7 - 14 * season + 4 * diurnal + 3 * vnoise(ts, 3 * DAY, 1) + vnoise(ts, 6 * HOUR, 2);

  // 이벤트(일 단위 시드): 안개(03–06Z) / 연무 / 강수(계절별 확률, 여름 장마) / 뇌전(여름 오후) / 눈(겨울)
  const fogDay = h01(dayKey, 11) < 0.3;
  const fogI = h01(dayKey, 12);
  const hazeDay = !fogDay && h01(dayKey, 13) < 0.15;
  const rainProb = 0.27 - 0.13 * season; // 겨울 0.14 ~ 여름 0.40
  const rainDay = h01(dayKey, 14) < rainProb;
  const rainStart = Math.floor(h01(dayKey, 15) * 20);
  const rainLen = 3 + Math.floor(h01(dayKey, 16) * 6);
  const raining = rainDay && hUTC >= rainStart && hUTC < rainStart + rainLen;
  const snow = raining && season > 0.6;
  const ts_ = raining && season < -0.5 && h01(dayKey, 17) < 0.5 && hUTC >= 5 && hUTC < 10;
  const fog = fogDay && hUTC >= 3 && hUTC < 7;

  // 노점 스프레드: 겨울 건조(8) ~ 여름 습윤(4), 안개/강수 시 좁아짐
  let spread = 6 + 2 * season + 2.5 * vnoise(ts, DAY, 3) - 1.5 * diurnal;
  if (fog) spread = 0.5 + fogI;
  else if (raining) spread = 1 + h01(dayKey, 18);
  spread = Math.max(0, spread);

  // 시정
  let vis = 10;
  const tags: string[] = [];
  if (fog) {
    vis = Math.max(0.5, Math.round((0.5 + 4.5 * fogI) * 2) / 2);
    tags.push(vis <= 1 ? 'FG' : 'BR');
  } else if (raining) {
    vis = 4 + Math.round(h01(dayKey, 19) * 4);
    tags.push(snow ? 'SN' : 'RA');
  } else if (hazeDay) {
    vis = 6 + Math.round(h01(dayKey, 20) * 2);
    tags.push('HZ');
  }
  if (ts_) tags.push('TS');

  // 바람: 겨울 NW(≈315) ~ 여름 SW(≈225), 느린 노이즈(활주로 선택 기준) + 빠른 노이즈
  const dirSlow = 270 + 45 * season + 45 * vnoise(ts, 8 * HOUR, 21);
  const dir = (((dirSlow + 20 * vnoise(ts, 1.5 * HOUR, 22)) % 360) + 360) % 360;
  let spd = 9 + 2 * season + 3 * Math.cos((2 * Math.PI * (hUTC - 6)) / 24) + 4 * vnoise(ts, 6 * HOUR, 23) + 2 * vnoise(ts, HOUR, 24);
  if (ts_) spd += 8;
  // 강풍일(약 6%): 하루 종일 +6~12KT (한계 초과·강풍 이벤트용)
  if (h01(dayKey, 25) < 0.06) spd += 6 + 6 * h01(dayKey, 26);
  spd = Math.round(Math.max(2, Math.min(35, spd)));

  // 활주로: 느린 풍향 기준 (플래핑 방지). 250°~70°(북서~북동) → 32
  const ds = ((dirSlow % 360) + 360) % 360;
  const rwy: Runway = ds > 250 || ds < 70 ? '32L/32R' : '14L/14R';

  // 구름
  let cloud: string;
  let ceil: number | null = null;
  if (fog || raining) {
    cloud = 'BKN008';
    ceil = 800;
  } else {
    const c = vnoise(ts, 5 * HOUR, 41);
    if (c < -0.4) cloud = 'CAVOK';
    else if (c < 0.35) cloud = 'SCT025';
    else if (c < 0.8) {
      cloud = 'BKN020';
      ceil = 2000;
    } else {
      cloud = 'BKN012';
      ceil = 1200;
    }
  }

  // QNH: 겨울 고기압 ~ 여름 저기압 + 느린 변동 + 반일주기
  const qnh = Math.round(1015 + 7 * season + 6 * vnoise(ts, 3 * DAY, 31) + 2 * vnoise(ts, 12 * HOUR, 32) + Math.cos((2 * Math.PI * (hUTC - 2)) / 12));

  return { t: Math.round(t), dp: Math.round(t - spread), dir, spd, vis, cloud, ceil, qnh, rwy, tags };
}

/** 임시 갱신 판정: 직전 발행 대비 유의미한 변화 */
function significant(a: Wx, b: Wx): boolean {
  if (a.rwy !== b.rwy) return true;
  if (a.cloud !== b.cloud) return true;
  if (a.tags.join() !== b.tags.join()) return true;
  const visCat = (v: number) => (v >= 10 ? 2 : v >= 5 ? 1 : 0);
  if (visCat(a.vis) !== visCat(b.vis)) return true;
  const dd = Math.abs(((a.dir - b.dir + 540) % 360) - 180);
  if (dd >= 30 && b.spd >= 6) return true;
  if (Math.abs(a.spd - b.spd) >= 8) return true;
  return false;
}

function toRecord(ts: number, w: Wx, letter: string): AtisRecord {
  const d = new Date(ts);
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const dayTag = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const hdg = RUNWAY_TRUE_HEADING[w.rwy];
  const rel = ((w.dir - hdg) * Math.PI) / 180;
  const d10 = (Math.round(w.dir / 10) * 10) % 360 || 360;
  const xw = Math.abs(w.spd * Math.sin(rel));
  const tw = Math.max(0, -w.spd * Math.cos(rel));
  const ar = h01(Math.floor(ts / SLOT), 51);
  const app: Approach = ar < 0.8 ? 'ILS' : ar < 0.93 ? 'RNP' : 'VOR';
  const visTxt = w.vis >= 10 ? '10KM' : w.vis >= 5 ? `${w.vis}KM` : `${Math.round(w.vis * 1000)}M`;
  const wind = `${String(d10).padStart(3, '0')}/${pad2(w.spd)}KT`;
  const wxTok = w.tags.length ? ' ' + w.tags.join(' ') : '';
  return {
    ts,
    time: `${dayTag} ${hh}${mm}Z`,
    hour: d.getUTCHours(),
    letter,
    dir: w.dir,
    spd: w.spd,
    vis: w.vis,
    visTxt,
    cloud: w.cloud,
    ceil: w.ceil,
    t: w.t,
    dp: w.dp,
    qnh: w.qnh,
    rwy: w.rwy,
    xw,
    tw,
    app,
    tags: w.tags,
    wind,
    raw:
      `RKSS ATIS INFO ${letter} ${hh}${mm}Z. ${app} APCH RWY ${w.rwy.replace('/', ' AND ')}. ` +
      `WIND ${wind}. VIS ${visTxt}${wxTok}. ${w.cloud}. T${w.t}/DP${w.dp}. QNH ${w.qnh}HPA. TRL 140. ACK INFO ${letter}.`,
  };
}

/* ---------- 조회 API ---------- */

const cache = new Map<string, AtisRecord[]>();
const CACHE_MAX = 12;

/**
 * [from, to] 구간의 전문 조회 (ts 오름차순). 결정적이라 어느 기간으로 잘라도 같은 시각은 같은 값.
 * `_refreshTick`은 새로고침 버튼용 인자 — 목데이터는 무시하지만 백엔드 연결 시 재조회 트리거로 사용.
 */
export function getRecordsBetween(from: number, to: number, _refreshTick = 0): AtisRecord[] {
  from = Math.max(DATA_START, from);
  to = Math.min(MOCK_NOW, to);
  if (!(to >= from)) return [];
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const recs: AtisRecord[] = [];
  // 레터는 일 단위로 A부터 순환 — 하루 시작부터 생성해 레터를 맞춘다
  let day = Math.floor(from / DAY) * DAY;
  for (; day <= to; day += DAY) {
    let issued = 0;
    let last: Wx | null = null;
    for (let ts = day; ts < day + DAY && ts <= to; ts += SLOT) {
      const w = wxAt(ts);
      const regular = ts % (30 * MIN) === 0;
      if (!regular && (!last || !significant(last, w))) continue;
      const letter = LETTERS[issued % 26];
      issued++;
      last = w;
      if (ts >= from) recs.push(toRecord(ts, w, letter));
    }
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, recs);
  return recs;
}

/** 툴바 기간(24h/7d/30d) 레코드 */
export function getRecords(range: Range, refreshTick = 0): AtisRecord[] {
  const w = rangeWindow(range);
  return getRecordsBetween(w.from, w.to, refreshTick);
}

export const IMPORTED_FILES: ImportedFile[] = [
  { name: 'rkss_atis_20260815.log', count: 22, at: '오늘 14:02' },
  { name: 'rkss_atis_20260814.log', count: 48, at: '어제 23:58' },
  { name: 'rkss_atis_20260813.log', count: 48, at: '08-13 23:59' },
  { name: 'rkss_atis_202608_backfill.csv', count: 1296, at: '08-12 09:14' },
];

export const WATCH_FOLDER = '~/Documents/ATIS/RKSS';
