import type { AtisRecord, Range } from './types';

const HEADER = ['time', 'info', 'wind', 'vis_km', 'cloud', 'temp_c', 'dewpoint_c', 'qnh_hpa', 'rwy', 'apch', 'wx', 'raw'];

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 레코드 배열 → CSV 텍스트 (BOM 포함 UTF-8, Excel 호환) */
export function toCsv(recs: AtisRecord[]): string {
  const rows = recs.map((r) =>
    [r.time, r.letter, r.wind, r.vis, r.cloud, r.t, r.dp, r.qnh, r.rwy, r.app, r.tags.join(' '), r.raw].map(csvField).join(','),
  );
  return '\ufeff' + [HEADER.join(','), ...rows].join('\n');
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * CSV 내보내기.
 * - Tauri: 저장 다이얼로그 → Rust `save_text_file` 커맨드
 * - 브라우저(vite dev): Blob 다운로드
 */
export async function exportCsv(recs: AtisRecord[], range: Range): Promise<void> {
  const filename = `rkss_atis_${range}.csv`;
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
