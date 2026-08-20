import type { AtisFile, AtisRecord, ImportedFile, Range, TimeWindow } from '../types';
import { parseAtis, toRecord } from './parse';

/*
 * 파싱된 레코드 보관소 — 파일 목록을 받아 레코드 배열(ts 오름차순)로 유지하고 기간 조회를 제공한다.
 * 같은 (발행 시각, 레터)의 전문이 여러 파일로 저장된 경우(재저장·정정) 파일명 시각이 가장 늦은 것만 남긴다.
 * 감시 이벤트로 들어온 파일은 그 파일만 다시 파싱하고 배열을 재구성한다.
 */

const DAY = 86400000;
const RANGE_MS: Record<Range, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

interface Entry {
  file: ImportedFile;
  rec: AtisRecord | null;
}

export interface AtisStore {
  /** ts 오름차순 (동일 ts는 파일명 순), 중복 제거됨 */
  records: AtisRecord[];
  /** 파일별 파싱 결과 (파일명 순) */
  files: ImportedFile[];
  /** 레코드를 만들지 못한 파일 수 */
  rejected: number;
  /** 파일명 → 파싱 결과 (증분 병합용) */
  entries: Map<string, Entry>;
}

export const EMPTY_STORE: AtisStore = { records: [], files: [], rejected: 0, entries: new Map() };

const recKey = (r: AtisRecord) => `${r.ts}|${r.letter}`;

function parseEntry(f: AtisFile): Entry {
  const r = parseAtis(f.text, f.name, f.mtime);
  if (!r.rec) return { file: { name: f.name, ok: false, reason: r.reason, ts: null, mtime: f.mtime }, rec: null };
  const rec = toRecord(r.rec);
  return { file: { name: f.name, ok: true, reason: r.unknown.length ? `미인식 ${r.unknown.length}줄` : '', ts: rec.ts, mtime: f.mtime }, rec };
}

/** 파싱 결과 맵 → 보관소 (정렬·중복 제거) */
function assemble(entries: Map<string, Entry>): AtisStore {
  const names = [...entries.keys()].sort();
  const byKey = new Map<string, AtisRecord>();
  const files: ImportedFile[] = [];
  let rejected = 0;
  for (const name of names) {
    const e = entries.get(name) as Entry;
    files.push(e.file);
    if (!e.rec) {
      rejected++;
      continue;
    }
    byKey.set(recKey(e.rec), e.rec); // 뒤(파일명 시각이 늦은 쪽)가 이긴다
  }
  const records = [...byKey.values()].sort((a, b) => a.ts - b.ts || (a.file < b.file ? -1 : 1));
  return { records, files, rejected, entries };
}

/** 파일 목록 → 보관소 (전체 재구성) */
export function buildStore(files: AtisFile[]): AtisStore {
  const entries = new Map<string, Entry>();
  for (const f of files) entries.set(f.name, parseEntry(f));
  return assemble(entries);
}

/** 새 파일(감시 이벤트)을 보관소에 합친다 — 같은 이름이면 교체. 들어온 파일만 다시 파싱 */
export function mergeFiles(store: AtisStore, incoming: AtisFile[]): AtisStore {
  const entries = new Map(store.entries);
  for (const f of incoming) entries.set(f.name, parseEntry(f));
  return assemble(entries);
}

/* ---------- 조회 ---------- */

/** ts >= t 인 첫 인덱스 */
function lowerBound(recs: AtisRecord[], t: number): number {
  let lo = 0;
  let hi = recs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (recs[mid].ts < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** [from, to] 구간 레코드 (ts 오름차순, 원본 배열의 슬라이스) */
export function recordsBetween(recs: AtisRecord[], from: number, to: number): AtisRecord[] {
  if (!recs.length || !(to >= from)) return [];
  return recs.slice(lowerBound(recs, from), lowerBound(recs, to + 1));
}

/** 기간 기준점 — 마지막 전문 시각 (실시간 수집 중이면 현재와 거의 같고, 보관 데이터만 있으면 그 끝) */
export function anchorOf(recs: AtisRecord[]): number {
  return recs.length ? recs[recs.length - 1].ts : Date.now();
}

/** 툴바 기간(24h/7d/30d) → 조회 창 (기준점에서 거슬러 올라감) */
export function rangeWindow(range: Range, anchor: number): TimeWindow {
  return { from: anchor - RANGE_MS[range], to: anchor };
}

/** 데이터 보유 시작 (기간 선택 하한) — 레코드가 없으면 1년 전 */
export function dataStart(recs: AtisRecord[]): number {
  return recs.length ? Math.floor(recs[0].ts / DAY) * DAY : Date.now() - 365 * DAY;
}
