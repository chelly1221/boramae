/*
 * ATIS 파서 커버리지 점검 — 폴더의 모든 *.TXT를 파싱해 실패 사유·미인식 줄·필드 분포를 출력한다.
 *   npm run parse:check [-- 폴더]                (기본 D:\ — 느린 매체라면 C:\code\atis-raw 같은 로컬 복사본을 지정)
 *   npm run parse:check -- D:\ --dump 20         파싱된 레코드 20건 샘플 출력
 *   npm run parse:check -- D:\ --verbose         제외된 파일을 한 줄씩 출력
 * Node 22.6+ (타입 스트리핑). 파서(src/data/atis/parse.ts)는 런타임 의존성이 없어 그대로 실행된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAtis, toRecord } from '../src/data/atis/parse.ts';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'D:\\';
const dumpIdx = args.indexOf('--dump');
const dumpN = dumpIdx >= 0 ? Number(args[dumpIdx + 1] ?? 10) : 0;
const verbose = args.includes('--verbose');

const files = fs
  .readdirSync(dir)
  .filter((f) => /\.txt$/i.test(f))
  .sort();

const count = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
const reasons = new Map<string, number>();
const unknown = new Map<string, { n: number; sample: string }>();
const rejectedByMonth = new Map<string, number>();
const rwyCombos = new Map<string, number>();
const apps = new Map<string, number>();
const tags = new Map<string, number>();
const notices = new Map<string, number>();
const trends = new Map<string, number>();
const clouds = new Map<string, number>();
const winds = new Map<string, number>();
const visTxt = new Map<string, number>();
const letters = new Map<string, number>();
const brakings = new Map<string, number>();
const rwycc = new Map<string, number>();
const minutes = new Map<string, number>();
const tsSeen = new Map<number, number>();
let ok = 0;
let rvrN = 0;
let gustN = 0;
let condN = 0;
let vvN = 0;
let cbN = 0;
const recs: ReturnType<typeof toRecord>[] = [];

for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'latin1');
  const mtime = fs.statSync(path.join(dir, f)).mtimeMs;
  const r = parseAtis(text, f, mtime);
  for (const u of r.unknown) {
    const key = u.replace(/\d+/g, 'N');
    const e = unknown.get(key);
    if (e) e.n++;
    else unknown.set(key, { n: 1, sample: `${f}: ${u}` });
  }
  if (!r.rec) {
    count(reasons, r.reason);
    count(rejectedByMonth, f.slice(0, 8));
    if (verbose) console.log('REJECT', f, r.reason);
    continue;
  }
  ok++;
  const rec = toRecord(r.rec);
  recs.push(rec);
  count(tsSeen, rec.ts);
  count(rwyCombos, `${rec.arrRwy ?? '-'}|${rec.depRwy ?? '-'} (${rec.rwy})`);
  count(apps, rec.appName);
  rec.tags.forEach((t) => count(tags, t));
  rec.notices.forEach((n) => count(notices, n.kind + (n.kind === 'FLOW' ? ` ${JSON.stringify(n.flow)}`.slice(0, 40) : '')));
  count(trends, rec.trend ?? 'null');
  count(clouds, rec.cloud.replace(/\d{3}/g, 'NNN'));
  count(winds, rec.wind.replace(/\d+/g, 'N'));
  count(visTxt, rec.visTxt.replace(/\d+(\.\d+)?/g, 'N'));
  count(letters, rec.letter);
  count(minutes, String(new Date(rec.ts).getUTCMinutes()).padStart(2, '0'));
  if (rec.rvr.length) rvrN++;
  if (rec.gust != null) gustN++;
  if (rec.vv != null) vvN++;
  if (rec.clouds.some((c) => c.cb)) cbN++;
  if (rec.rwyCond.length) {
    condN++;
    rec.rwyCond.forEach((c) => {
      if (c.braking) count(brakings, `${c.braking} (${c.reportedBy ?? '?'})`.replace(/\d+/g, 'N'));
      if (c.codes) count(rwycc, c.codes.join('/') + (c.note ? ` ${c.note}` : ''));
    });
  }
}

const show = <K>(title: string, m: Map<K, number>, n = 40) => {
  console.log(`\n## ${title} (${m.size})`);
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .forEach(([k, v]) => console.log(String(v).padStart(7), k));
};

console.log(`files ${files.length} · parsed ${ok} · rejected ${files.length - ok}`);
show('reject reasons', reasons);
show('rejected by month', rejectedByMonth);
console.log(`\n## unknown lines (${unknown.size} patterns, ${[...unknown.values()].reduce((a, b) => a + b.n, 0)} lines)`);
[...unknown.entries()]
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 60)
  .forEach(([k, v]) => console.log(String(v.n).padStart(7), k, '   ←', v.sample.slice(0, 60)));
show('arr|dep combos', rwyCombos);
show('approach names', apps);
show('tags', tags);
show('notices', notices, 30);
show('trend', trends);
show('cloud codes', clouds, 25);
show('wind forms', winds);
show('vis forms', visTxt);
show('letters', letters, 30);
show('issue minute', minutes, 10);
show('braking', brakings, 15);
show('RWYCC', rwycc, 15);
const dupTs = [...tsSeen.values()].filter((v) => v > 1).length;
console.log(`\nRVR ${rvrN} · gust ${gustN} · VV ${vvN} · CB ${cbN} · rwyCond ${condN} · duplicate ts ${dupTs}`);
const t = recs.map((r) => r.t);
const q = recs.map((r) => r.qnh);
const s = recs.map((r) => r.spd);
const v = recs.map((r) => r.vis);
const rng = (xs: number[]) => `${Math.min(...xs)} ~ ${Math.max(...xs)}`;
console.log(`temp ${rng(t)} · qnh ${rng(q)} · spd ${rng(s)} · vis ${rng(v)} · xw max ${Math.max(...recs.map((r) => r.xw)).toFixed(1)}`);
console.log(`first ${new Date(Math.min(...recs.map((r) => r.ts))).toISOString()} · last ${new Date(Math.max(...recs.map((r) => r.ts))).toISOString()}`);

if (dumpN) {
  console.log('\n## sample records');
  const step = Math.max(1, Math.floor(recs.length / dumpN));
  for (let i = 0; i < recs.length; i += step) {
    const { raw: _raw, ...rest } = recs[i];
    console.log(JSON.stringify(rest));
  }
}
