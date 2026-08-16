#!/usr/bin/env node
/**
 * BRA SUITE 항공사진 타일(image_tiles_Gimpo_2023, XYZ jpg)을 tiles.config.json `aerial`의 줌 범위만
 * 앱 public 폴더로 가공해 넣는다.
 *
 *   npm run tiles:aerial
 *
 * 원본 타일에는 실제 촬영 범위(공항 중심 원 + 활주로 방향 띠) 밖이 검정(래스터 범위 밖) / 흰색(nodata)으로
 * 구워져 있어 그대로 얹으면 지도에 검은 테두리·흰 여백이 보인다. 여기서는
 *   1. z14(MASK_Z) 모자이크에서 "실제 영상" 마스크를 만들고 안쪽으로 몇 px 침식해 '핵심 영역'을 정한다
 *   2. 각 타일 픽셀이 핵심 영역이면 무조건 불투명, 경계 띠에서는 순수 흰색/검정만 투명(색 키잉)으로 처리한다
 *      → 영상 안쪽의 흰 지붕·짙은 그림자는 건드리지 않고, 경계는 실제 픽셀대로 정확히 잘린다
 *   3. 전부 투명인 타일은 만들지 않고(누락 → 앱에서 errorTileUrl 투명), 나머지는 WebP로 저장한다
 *      (알파 필요 타일은 RGBA, 온전한 타일은 RGB — 확장자를 통일하려고 전부 WebP)
 *
 * 원본 폴더가 없으면 건너뛴다 (에러 아님) — 항공사진 레이어는 선택 기능.
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'tiles.config.json'), 'utf8')).aerial;
const outDir = join(root, cfg.outDir);
const T = 256; // 타일 크기(px)

if (!existsSync(cfg.source)) {
  console.warn(`원본 없음: ${cfg.source} — 항공사진 타일 가공 건너뜀`);
  process.exit(0);
}

// ── 파라미터 ─────────────────────────────────────────────────────────────
const MASK_Z = Math.min(14, cfg.maxZoom); // 마스크를 만들 줌 (z16 기준 1px ≈ 1.9m → z14 1px ≈ 7.6m)
const ERODE = 3;                           // 마스크 침식 반경(MASK_Z px) → 안쪽 경계 띠 폭 ≈ 23m
const SLACK = 4;                           // 침식된 핵심에서 바깥으로 ERODE+SLACK px까지만 색 키잉, 그 밖은 무조건 투명
const WHITE_LO = 240, WHITE_HI = 250;      // min(r,g,b) ≥ HI → 투명, ≤ LO → 불투명, 사이는 램프
const BLACK_HI = 12, BLACK_LO = 4;         // max(r,g,b) ≤ LO → 투명, ≥ HI → 불투명
const WEBP = { quality: 86, alphaQuality: 90, effort: 4 };
const CONCURRENCY = 16;

const tileList = (dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const xs of readdirSync(dir)) {
    const x = Number(xs);
    if (!Number.isInteger(x)) continue;
    for (const f of readdirSync(join(dir, xs))) {
      const m = /^(\d+)\.(jpg|jpeg|png)$/i.exec(f);
      if (m) out.push({ x, y: Number(m[1]), file: join(dir, xs, f) });
    }
  }
  return out;
};

const readRgb = async (file) => {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== T || info.height !== T || info.channels !== 3) throw new Error(`unexpected tile ${file}: ${info.width}x${info.height}x${info.channels}`);
  return data;
};

// ── 1) 마스크: MASK_Z 모자이크에서 실제 영상 영역 → 침식 ─────────────────────
const maskTiles = tileList(join(cfg.source, String(MASK_Z)));
if (!maskTiles.length) {
  console.error(`z${MASK_Z} 타일이 없어 마스크를 만들 수 없음`);
  process.exit(1);
}
const mx0 = Math.min(...maskTiles.map((t) => t.x)), mx1 = Math.max(...maskTiles.map((t) => t.x));
const my0 = Math.min(...maskTiles.map((t) => t.y)), my1 = Math.max(...maskTiles.map((t) => t.y));
const MW = (mx1 - mx0 + 1) * T, MH = (my1 - my0 + 1) * T;
const mask = new Uint8Array(MW * MH); // 1 = 실제 영상
console.log(`mask z${MASK_Z}: ${maskTiles.length} tiles, ${MW}x${MH}px`);
for (const t of maskTiles) {
  const rgb = await readRgb(t.file);
  const ox = (t.x - mx0) * T, oy = (t.y - my0) * T;
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const i = (py * T + px) * 3;
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      const mn = Math.min(r, g, b), mxc = Math.max(r, g, b);
      // 마스크는 느슨하게(밝거나 어두우면 일단 비영상) — 띠가 넓어질 뿐 영상이 지워지진 않는다
      if (!(mn >= WHITE_LO || mxc <= BLACK_HI)) mask[(oy + py) * MW + ox + px] = 1;
    }
  }
}
// 구멍 채우기: 모자이크 바깥과 이어진 비영상만 진짜 여백. 안쪽에 고립된 흰 지붕·검은 그림자 덩어리는 영상으로 되돌린다
{
  const seen = new Uint8Array(MW * MH);
  const stack = new Int32Array(MW * MH);
  let sp = 0;
  const push = (i) => { if (!seen[i] && !mask[i]) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < MW; x++) { push(x); push((MH - 1) * MW + x); }
  for (let y = 0; y < MH; y++) { push(y * MW); push(y * MW + MW - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % MW, y = (i - x) / MW;
    if (x > 0) push(i - 1);
    if (x < MW - 1) push(i + 1);
    if (y > 0) push(i - MW);
    if (y < MH - 1) push(i + MW);
  }
  let filled = 0;
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !seen[i]) { mask[i] = 1; filled++; }
  console.log(`mask holes filled: ${filled} px`);
}
// 분리형 min/max 필터 (침식/팽창). 모자이크 밖은 비영상 취급
const filter1D = (src, dst, w, h, horizontal, radius, wantMax) => {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const stop = wantMax ? 1 : 0;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      let v = wantMax ? 0 : 1;
      for (let d = -radius; d <= radius; d++) {
        const j = i + d;
        const s = j < 0 || j >= len ? 0 : horizontal ? src[l * w + j] : src[j * w + l];
        if (s === stop) { v = stop; break; }
      }
      if (horizontal) dst[l * w + i] = v; else dst[i * w + l] = v;
    }
  }
};
const morph = (src, radius, wantMax) => {
  const t = new Uint8Array(MW * MH), out = new Uint8Array(MW * MH);
  filter1D(src, t, MW, MH, true, radius, wantMax);
  filter1D(t, out, MW, MH, false, radius, wantMax);
  return out;
};
// core = 침식(얇은 선·점 제거 + 경계에서 ERODE 만큼 안쪽) → 무조건 불투명
// outer = core를 다시 ERODE+SLACK 팽창 → 그 안쪽 띠에서만 색 키잉, 바깥은 무조건 투명
//   (검정↔흰색 nodata끼리의 경계에 생기는 회색 전이 픽셀이 영상에서 멀리 떨어져 살아남는 것을 막는다)
const core = morph(mask, ERODE, false);
const outer = morph(core, ERODE + SLACK, true);
let coreCnt = 0, outerCnt = 0;
for (let i = 0; i < core.length; i++) { coreCnt += core[i]; outerCnt += outer[i]; }
console.log(`core ${(coreCnt / core.length * 100).toFixed(1)}%, band ${((outerCnt - coreCnt) / core.length * 100).toFixed(1)}% of mask area`);

// ── 2) 타일 가공 ────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const alpha = new Float32Array(T * T), alphaE = new Uint8Array(T * T), rgba = Buffer.alloc(T * T * 4);

const processTile = async (z, x, y, rgb, outFile) => {
  const scale = 2 ** (MASK_Z - z); // 타일 픽셀 → 마스크 픽셀 배율
  let anyOpaque = false, anyClear = false;
  for (let py = 0; py < T; py++) {
    const my = Math.floor((y * T + py + 0.5) * scale) - my0 * T;
    for (let px = 0; px < T; px++) {
      const mx = Math.floor((x * T + px + 0.5) * scale) - mx0 * T;
      const inside = mx >= 0 && my >= 0 && mx < MW && my < MH;
      const zone = !inside ? 0 : core[my * MW + mx] ? 2 : outer[my * MW + mx]; // 2 핵심 / 1 띠 / 0 바깥
      let a = zone === 2 ? 1 : 0;
      if (zone !== 2) {
        const i = (py * T + px) * 3;
        const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
        const mn = Math.min(r, g, b), mxc = Math.max(r, g, b);
        const key = Math.min(clamp01((WHITE_HI - mn) / (WHITE_HI - WHITE_LO)), clamp01((mxc - BLACK_LO) / (BLACK_HI - BLACK_LO)));
        if (zone === 1) a = key;
        else if (key === 1 && !(r === g && g === b)) forcedOut++; // 바깥 구역에서 버려진 '컬러' 픽셀 — 많으면 마스크 범위 의심
      }
      alpha[py * T + px] = a;
    }
  }
  // 1px 침식(3×3 min): 경계의 JPEG 링잉·밝은 테두리 제거
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      let a = alpha[py * T + px];
      if (a > 0) {
        for (let dy = -1; dy <= 1 && a > 0; dy++) {
          const yy = py + dy; if (yy < 0 || yy >= T) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx; if (xx < 0 || xx >= T) continue;
            const n = alpha[yy * T + xx]; if (n < a) a = n;
          }
        }
      }
      const a8 = Math.round(a * 255);
      alphaE[py * T + px] = a8;
      if (a8 === 255) anyOpaque = true; else anyClear = true;
    }
  }
  if (!anyOpaque) return 'skip';          // 전부 여백 → 타일 없음
  mkdirSync(dirname(outFile), { recursive: true });
  if (!anyClear) {                        // 온전한 타일 → RGB
    await sharp(rgb, { raw: { width: T, height: T, channels: 3 } }).webp(WEBP).toFile(outFile);
    return 'full';
  }
  for (let i = 0, j = 0; i < T * T; i++, j += 4) {
    rgba[j] = rgb[i * 3]; rgba[j + 1] = rgb[i * 3 + 1]; rgba[j + 2] = rgb[i * 3 + 2]; rgba[j + 3] = alphaE[i];
  }
  await sharp(rgba, { raw: { width: T, height: T, channels: 4 } }).webp(WEBP).toFile(outFile);
  return 'edge';
};

// 이전 산출물 정리 (줌 폴더만; manifest는 아래서 다시 씀)
if (existsSync(outDir)) for (const e of readdirSync(outDir)) if (/^\d+$/.test(e)) rmSync(join(outDir, e), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const stats = { full: 0, edge: 0, skip: 0 };
let bytes = 0, forcedOut = 0;
for (let z = cfg.minZoom; z <= cfg.maxZoom; z++) {
  const tiles = tileList(join(cfg.source, String(z)));
  if (!tiles.length) { console.warn(`z${z} 없음, 건너뜀`); continue; }
  const zs = { full: 0, edge: 0, skip: 0 };
  // 디코딩은 배치 병렬, 마스킹은 공용 버퍼를 쓰므로 순차
  for (let i = 0; i < tiles.length; i += CONCURRENCY) {
    const batch = tiles.slice(i, i + CONCURRENCY);
    const rgbs = await Promise.all(batch.map((t) => readRgb(t.file)));
    for (let k = 0; k < batch.length; k++) {
      const t = batch[k];
      const outFile = join(outDir, String(z), String(t.x), `${t.y}.webp`);
      const r = await processTile(z, t.x, t.y, rgbs[k], outFile);
      zs[r]++; stats[r]++;
      if (r !== 'skip') bytes += statSync(outFile).size;
    }
  }
  console.log(`z${z}: ${tiles.length} src → full ${zs.full}, edge ${zs.edge}, skipped ${zs.skip}, forced-out color px ${forcedOut}`);
  forcedOut = 0;
}

const total = stats.full + stats.edge;
writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ source: 'BRA SUITE image_tiles_Gimpo_2023 (2023 항공사진)', zoom: [cfg.minZoom, cfg.maxZoom], bbox: cfg.bbox, tiles: total, edgeTiles: stats.edge, format: 'webp', builtAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`total ${total} tiles (${stats.edge} with alpha, ${stats.skip} empty dropped), ${(bytes / 1024 / 1024).toFixed(1)} MB → ${cfg.outDir}`);
