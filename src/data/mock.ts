import type { Approach, AtisRecord, HeatRow, ImportedFile, Range, Runway } from './types';

/*
 * 데모용 목데이터 — 디자인 시안(design/ATIS Analyzer.dc.html)의 `recs()` / `heat()` 로직을 그대로 이식.
 * 시드 난수라 항상 같은 값을 만든다. 실제 구현에서는 Tauri 백엔드(파서/DB)에서 오는 레코드로 대체.
 */

const RANGE_SPEC: Record<Range, { count: number; stepMin: number }> = {
  '24h': { count: 48, stepMin: 30 },
  '7d': { count: 168, stepMin: 60 },
  '30d': { count: 240, stepMin: 180 },
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pad2 = (n: number) => String(n).padStart(2, '0');

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const cache = new Map<Range, AtisRecord[]>();

/**
 * 기간별 레코드 조회. `_refreshTick`은 새로고침 버튼용 인자 — 목데이터는 결정적이라 무시하지만
 * 백엔드 연결 시 재조회 트리거로 사용.
 */
export function getRecords(range: Range, _refreshTick = 0): AtisRecord[] {
  const hit = cache.get(range);
  if (hit) return hit;

  const { count, stepMin } = RANGE_SPEC[range];
  const multi = range !== '24h';
  const end = Date.UTC(2026, 7, 15, 12, 0);
  const rnd = lcg(42);
  const recs: AtisRecord[] = [];
  let qnh = 1014.2;
  let dir = 322;
  let spd = 10;

  for (let i = 0; i < count; i++) {
    const d = new Date(end - (count - 1 - i) * stepMin * 60000);
    const hh = pad2(d.getUTCHours());
    const mm = pad2(d.getUTCMinutes());
    const dayTag = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const f = i / count;

    qnh += (rnd() - 0.47) * 0.9;
    dir = dir + (rnd() - 0.5) * 26;
    if (f > 0.33 && f < 0.48) dir -= 17;
    else if (f > 0.56 && f < 0.69) dir += 19;
    dir = ((dir % 360) + 360) % 360;
    spd = Math.max(4, Math.min(19, spd + (rnd() - 0.5) * 3.4));
    if (f > 0.41 && f < 0.46) spd = 21;

    const q = Math.round(qnh);
    const vis = rnd() < 0.12 ? 4 + Math.round(rnd() * 4) : 10;
    let cloud: string;
    let ceil: number | null = null;
    if (vis < 10) {
      cloud = 'BKN008';
      ceil = 800;
    } else {
      const c = rnd();
      if (c < 0.28) cloud = 'CAVOK';
      else if (c < 0.62) cloud = 'SCT025';
      else {
        cloud = 'BKN020';
        ceil = 2000;
      }
    }
    const t = 22 + Math.round(rnd() * 4);
    const dp = vis < 10 ? t - 1 : t - 4 - Math.round(rnd() * 3);
    const rwy: Runway = dir > 250 || dir < 70 ? '32L/32R' : '14L/14R';
    const hdg = rwy[0] === '3' ? 323 : 143;
    const rel = ((dir - hdg) * Math.PI) / 180;
    const d10 = (Math.round(dir / 10) * 10) % 360 || 360;
    const s = Math.round(spd);
    const xw = Math.abs(s * Math.sin(rel));
    const tw = Math.max(0, -s * Math.cos(rel));
    const ar = rnd();
    const app: Approach = ar < 0.78 ? 'ILS' : ar < 0.92 ? 'RNP' : 'VOR';
    const tags: string[] = [];
    if (vis < 10) tags.push(vis <= 6 ? 'BR' : 'HZ');
    if (rnd() < 0.1) tags.push('RA');
    if (f > 0.43 && f < 0.48) tags.push('TS');
    const letter = LETTERS[i % 26];
    const visTxt = vis >= 10 ? '10KM' : `${vis}KM`;
    const wind = `${String(d10).padStart(3, '0')}/${pad2(s)}KT`;

    recs.push({
      time: (multi ? `${dayTag} ` : '') + `${hh}${mm}Z`,
      hour: d.getUTCHours(),
      letter,
      dir,
      spd: s,
      vis,
      visTxt,
      cloud,
      ceil,
      t,
      dp,
      qnh: q,
      rwy,
      xw,
      tw,
      app,
      tags,
      wind,
      raw:
        `RKSS ATIS INFO ${letter} ${hh}${mm}Z. ${app} APCH RWY ${rwy.replace('/', ' AND ')}. ` +
        `WIND ${wind}. VIS ${visTxt}. ${cloud}. T${t}/DP${dp}. QNH ${q}HPA. TRL 140. ACK INFO ${letter}.`,
    });
  }

  cache.set(range, recs);
  return recs;
}

/** 최근 7일 × 24시간 기상 이벤트 히트맵 (목데이터) */
let heatCache: HeatRow[] | null = null;

export function getHeatRows(): HeatRow[] {
  if (heatCache) return heatCache;
  const rnd = lcg(7);
  const days = ['08-09', '08-10', '08-11', '08-12', '08-13', '08-14', '08-15'];
  const COLOR = { fog: '#c8871c', rain: '#6b8cae', rwy: '#7f0d00' } as const;
  const NAME = { fog: '시정 저하', rain: '강수', rwy: '활주로 전환' } as const;
  type Ev = keyof typeof COLOR;

  heatCache = days.map((day, di) => {
    const fog = rnd() < 0.6;
    const rain = di === 1 || di === 4;
    const cells = [];
    for (let h = 0; h < 24; h++) {
      const ev: Ev[] = [];
      if (fog && h >= 3 && h <= 6) ev.push('fog');
      if (rain && h >= 13 && h <= 16) ev.push('rain');
      if (rnd() < (ev.length ? 0.3 : 0.05)) ev.push('rwy'); // 전환은 기상 이벤트 시간대에 몰림
      const label = `${day} ${pad2(h)}시 · `;
      if (!ev.length) cells.push({ bg: 'rgba(50,30,20,0.05)', title: label + '정상' });
      else if (ev.length === 1) cells.push({ bg: COLOR[ev[0]], title: label + NAME[ev[0]] });
      else
        cells.push({
          bg: `linear-gradient(90deg, ${COLOR[ev[0]]} 0 50%, ${COLOR[ev[1]]} 50% 100%)`,
          title: label + ev.map((e) => NAME[e]).join(' + '),
        });
    }
    return { day, cells };
  });
  return heatCache;
}

export const IMPORTED_FILES: ImportedFile[] = [
  { name: 'rkss_atis_20260815.log', count: 22, at: '오늘 14:02' },
  { name: 'rkss_atis_20260814.log', count: 48, at: '어제 23:58' },
  { name: 'rkss_atis_20260813.log', count: 48, at: '08-13 23:59' },
  { name: 'rkss_atis_202608_backfill.csv', count: 1296, at: '08-12 09:14' },
];

export const WATCH_FOLDER = '~/Documents/ATIS/RKSS';
