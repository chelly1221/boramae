#!/usr/bin/env node
/**
 * CARTO 래스터 베이스맵 타일을 한 줌 레벨만 bbox 범위로 내려받아 오프라인용으로 저장한다.
 *
 *   npm run tiles                # tiles.config.json 설정대로
 *   npm run tiles -- --force     # 이미 있는 파일도 다시 받기
 *
 * 출력: <outDir>/{z}/{x}/{y}.png + <outDir>/manifest.json
 * 스타일: voyager | voyager_nolabels | light_all(Positron) | dark_all 등 (https://github.com/CartoDB/basemap-styles)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'tiles.config.json'), 'utf8'));
const force = process.argv.includes('--force');

const { style, zoom: z, scale, bbox } = cfg;
const outDir = join(root, cfg.outDir);
const suffix = scale === 2 ? '@2x' : '';
const CONCURRENCY = 6;
const SUBDOMAINS = ['a', 'b', 'c', 'd'];

/* ---- 슬리피 맵 타일 좌표 ---- */
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const x0 = lon2x(bbox.minLon, z);
const x1 = lon2x(bbox.maxLon, z);
const y0 = lat2y(bbox.maxLat, z); // 북쪽이 y 작음
const y1 = lat2y(bbox.minLat, z);

const jobs = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ x, y });

console.log(`style=${style} zoom=${z} scale=${scale}x  x:${x0}-${x1} y:${y0}-${y1}  → ${jobs.length} tiles → ${cfg.outDir}`);

let done = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

async function fetchTile({ x, y }, attempt = 0) {
  const file = join(outDir, String(z), String(x), `${y}.png`);
  if (!force && existsSync(file)) {
    skipped++;
    return;
  }
  const s = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  const url = `https://${s}.basemaps.cartocdn.com/rastertiles/${style}/${z}/${x}/${y}${suffix}.png`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'boramae-atis-analyzer/0.1 (offline tile cache)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    bytes += buf.length;
    done++;
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return fetchTile({ x, y }, attempt + 1);
    }
    failed++;
    console.error(`FAIL ${z}/${x}/${y}: ${e.message}`);
  }
}

// 간단한 워커 풀
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    await fetchTile(job);
    const n = done + skipped + failed;
    if (n % 25 === 0 || n === jobs.length) process.stdout.write(process.stdout.isTTY ? `\r${n}/${jobs.length}` : `${n}/${jobs.length}\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (process.stdout.isTTY) process.stdout.write('\n');

writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      style,
      zoom: z,
      scale,
      bbox,
      tiles: { x: [x0, x1], y: [y0, y1], count: jobs.length },
      fetchedAt: new Date().toISOString(),
      attribution: '© OpenStreetMap contributors © CARTO',
    },
    null,
    2,
  ) + '\n',
);

console.log(`downloaded ${done}, skipped ${skipped}, failed ${failed}, ${(bytes / 1024 / 1024).toFixed(1)} MB new`);
if (failed) process.exit(1);
