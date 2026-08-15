#!/usr/bin/env node
/**
 * BRA SUITE 항공사진 타일(image_tiles_Gimpo_2023, XYZ jpg)에서 tiles.config.json `aerial`의
 * 줌 범위만 앱 public 폴더로 복사한다.
 *
 *   npm run tiles:aerial
 *
 * 원본 폴더가 없으면 건너뛴다 (에러 아님) — 항공사진 레이어는 선택 기능.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'tiles.config.json'), 'utf8')).aerial;
const outDir = join(root, cfg.outDir);

if (!existsSync(cfg.source)) {
  console.warn(`원본 없음: ${cfg.source} — 항공사진 타일 복사 건너뜀`);
  process.exit(0);
}

const dirSize = (p) => readdirSync(p, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(p, e.name)) : statSync(join(p, e.name)).size), 0);
const countFiles = (p) => readdirSync(p, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(join(p, e.name)) : 1), 0);

mkdirSync(outDir, { recursive: true });
let total = 0;
let bytes = 0;
for (let z = cfg.minZoom; z <= cfg.maxZoom; z++) {
  const src = join(cfg.source, String(z));
  if (!existsSync(src)) {
    console.warn(`z${z} 없음, 건너뜀`);
    continue;
  }
  cpSync(src, join(outDir, String(z)), { recursive: true, force: false, errorOnExist: false });
  const n = countFiles(join(outDir, String(z)));
  const b = dirSize(join(outDir, String(z)));
  total += n;
  bytes += b;
  console.log(`z${z}: ${n} tiles, ${(b / 1024 / 1024).toFixed(1)} MB`);
}

writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ source: 'BRA SUITE image_tiles_Gimpo_2023 (2023 항공사진)', zoom: [cfg.minZoom, cfg.maxZoom], bbox: cfg.bbox, tiles: total, format: 'jpg', copiedAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`total ${total} tiles, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${cfg.outDir}`);
