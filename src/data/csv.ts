import { isTauri } from '../tauri';
import type { AtisRecord, Range } from './types';

const HEADER = [
  'time',
  'info',
  'wind',
  'gust_kt',
  'var_from',
  'var_to',
  'vis_km',
  'cavok',
  'rvr',
  'wx',
  'cloud',
  'ceiling_ft',
  'temp_c',
  'dewpoint_c',
  'qnh_hpa',
  'arr_rwy',
  'dep_rwy',
  'apch',
  'trend',
  'trend_txt',
  'rwy_cond',
  'notices',
  'birds',
  'file',
  'raw',
];

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 레코드 배열 → CSV 텍스트 (BOM 포함 UTF-8, Excel 호환) */
export function toCsv(recs: AtisRecord[]): string {
  const rows = recs.map((r) =>
    [
      r.time,
      r.letter,
      r.wind,
      r.gust ?? '',
      r.varFrom ?? '',
      r.varTo ?? '',
      r.vis,
      r.cavok ? 1 : 0,
      r.rvr.map((x) => `${x.rwy} ${x.pos} ${x.m}`).join('; '),
      r.wxTxt,
      r.cloud,
      r.ceil ?? '',
      r.t,
      r.dp,
      r.qnh,
      r.arrRwy ?? '',
      r.depRwy ?? '',
      r.appName,
      r.trend ?? '',
      r.trendTxt,
      r.rwyCond.map((c) => [c.rwy && `RWY${c.rwy}`, c.codes?.join('/'), c.note, ...c.parts, c.braking && `BA ${c.braking}`, ...c.extra].filter(Boolean).join(' ')).join('; '),
      r.notices.map((n) => `${n.kind}: ${n.text}`).join('; '),
      r.birds.map((b) => `${b.kind} ${b.nm}NM ${b.dir}`).join('; '),
      r.file,
      r.raw,
    ]
      .map(csvField)
      .join(','),
  );
  return '\ufeff' + [HEADER.join(','), ...rows].join('\n');
}

/**
 * CSV 내보내기.
 * - Tauri: 저장 다이얼로그 → Rust `save_text_file` 커맨드
 * - 브라우저(vite dev): Blob 다운로드
 */
export async function exportCsv(recs: AtisRecord[], suffix: Range | string): Promise<void> {
  const filename = `rkss_atis_${suffix}.csv`;
  const contents = toCsv(recs);

  if (isTauri()) {
    const [{ save }, { invoke }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core')]);
    const path = await save({ defaultPath: filename, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!path) return;
    await invoke('save_text_file', { path, contents });
    return;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
