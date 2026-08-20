import { useMemo } from 'react';
import type { ScanStatus } from '../data/atis/source';
import type { AtisStore } from '../data/atis/store';
import type { AtisStatus } from '../data/atis/useAtis';
import { fmtDT } from '../data/detail/agg';
import { IconFolder } from './icons';

interface Props {
  dir: string;
  status: AtisStatus;
  error: string;
  watching: boolean;
  paused: boolean;
  loadedAt: number | null;
  /** 마지막 스캔 상태 */
  scan: ScanStatus | null;
  scanning: boolean;
  /** SQLite 정보 (Tauri) — 브라우저는 null */
  db: { path: string; count: number } | null;
  store: AtisStore;
  onChangeDir: () => void;
  onTogglePause: () => void;
  /** 지금 스캔 (변경된 파일만 읽어 DB 저장) */
  onScanNow: () => void;
  /** DB에서 전체 다시 적재 */
  onReloadAll: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 로컬 시각 "MM-DD HH:MM" */
function fmtLocal(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** 로컬 시각 "HH:MM:SS" */
function fmtLocalS(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 설정 — 감시 폴더·파일 변경 감시 상태·DB·최근 파일·불완전 전문 목록 */
export function SettingsView({ dir, status, error, watching, paused, loadedAt, scan, scanning, db, store, onChangeDir, onTogglePause, onScanNow, onReloadAll }: Props) {
  const recent = useMemo(() => [...store.files].sort((a, b) => b.mtime - a.mtime).slice(0, 12), [store.files]);
  const rejected = useMemo(() => store.files.filter((f) => !f.ok).sort((a, b) => b.mtime - a.mtime), [store.files]);
  const reasonCounts = useMemo(() => {
    const m = new Map<string, number>();
    rejected.forEach((f) => m.set(f.reason, (m.get(f.reason) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rejected]);
  const first = store.records[0];
  const lastRec = store.records[store.records.length - 1];
  const scanErr = scan?.error ?? '';
  const badge =
    status === 'loading' ? ['badge-amber', '적재 중'] : status === 'error' || scanErr ? ['badge-amber', '오류'] : paused ? ['badge-amber', '일시중지'] : watching ? ['badge-green', '감시 중'] : ['badge-amber', '감시 대기'];

  return (
    <div className="settings">
      <div className="card">
        <div className="map-card__between">
          <span className="card__title">감시 폴더</span>
          <span className={badge[0]}>{badge[1]}</span>
        </div>
        <div className="folder">
          <IconFolder />
          <span className="folder__path">{dir}</span>
          <div className="btn-sm" onClick={onChangeDir}>
            폴더 변경
          </div>
          <div className="btn-sm" onClick={onScanNow} title="폴더의 파일 변경시각을 지금 확인해 바뀐 파일만 읽어 DB에 저장">
            {scanning ? '스캔 중…' : '지금 스캔'}
          </div>
          <div className="btn-sm" onClick={onTogglePause}>
            {paused ? '감시 재개' : '일시중지'}
          </div>
        </div>
        {(error || scanErr) && <span style={{ fontSize: 12, color: '#b4451c' }}>{error || scanErr}</span>}
        <div className="folder-meta">
          <span>파일 형식 · *.TXT (파일명 = UTC 시각)</span>
          <span>파싱 규칙 · RKSS 음성 ATIS 문장</span>
          <span>감시 방식 · 파일 변경시각(mtime) 60초 주기 스캔 → 바뀐 파일만 DB 저장</span>
        </div>
        <div className="folder-meta">
          <span>
            마지막 스캔 {scan ? fmtLocalS(scan.at) : '—'}
            {scan && !scan.error ? ` · 폴더 ${scan.in_dir >= 0 ? `${scan.in_dir.toLocaleString()}개` : '—'} · 변경 ${scan.changed}개 · ${(scan.took_ms / 1000).toFixed(1)}초` : ''}
          </span>
          <span>적재 {loadedAt ? fmtLocal(loadedAt) : '—'}</span>
        </div>
      </div>

      <div className="card">
        <div className="map-card__between">
          <span className="card__title">보관 DB</span>
          <div className="btn-sm" onClick={onReloadAll} title="DB의 파일 전체를 다시 파싱해 적재">
            DB에서 다시 적재
          </div>
        </div>
        <div className="folder-meta">
          <span className="folder__path" style={{ flex: 'none' }}>
            {db ? db.path : '브라우저 개발 모드 — DB 없음 (폴더 직접 읽기)'}
          </span>
        </div>
        <div className="folder-meta">
          {db && <span>DB 보관 {db.count.toLocaleString()}개</span>}
          <span>적재 파일 {store.files.length.toLocaleString()}개</span>
          <span>전문 {store.records.length.toLocaleString()}건</span>
          <span>불완전 {store.rejected.toLocaleString()}개</span>
          {first && lastRec && (
            <span>
              보유 기간 {fmtDT(first.ts)} ~ {fmtDT(lastRec.ts)}
            </span>
          )}
        </div>
        <span className="card__note">
          파일명 기준으로 보관하므로 감시 폴더 경로(드라이브 문자)가 바뀌어도 같은 DB에 합쳐집니다. 폴더에서 지워진 파일도 DB에는 남고(누적 보관), 같은 이름의 파일이 다시 바뀌면(변경시각 변경) 새 내용으로 덮어씁니다.
        </span>
      </div>

      <div className="card file-list">
        <div className="file-list__head">최근 파일 · 수정 시각순</div>
        {recent.length ? (
          recent.map((f) => (
            <div key={f.name} className="file-list__row">
              <span className="file-list__name">{f.name}</span>
              <span className="file-list__count" style={f.ok ? undefined : { color: '#b4451c' }}>
                {f.ok ? (f.ts != null ? `전문 ${fmtDT(f.ts)}` : '전문') : `제외 · ${f.reason}`}
              </span>
              <span className="file-list__at">{fmtLocal(f.mtime)}</span>
            </div>
          ))
        ) : (
          <div className="file-list__row">
            <span className="file-list__count">{status === 'loading' ? '읽는 중…' : '파일이 없습니다'}</span>
          </div>
        )}
      </div>

      <div className="card file-list">
        <div className="file-list__head">
          불완전 전문 · {rejected.length.toLocaleString()}개
          {reasonCounts.length > 0 && <span style={{ fontWeight: 500, color: 'var(--ink-muted-55)' }}> · {reasonCounts.map(([r, n]) => `${r} ${n}`).join(' · ')}</span>}
        </div>
        {rejected.slice(0, 30).map((f) => (
          <div key={f.name} className="file-list__row">
            <span className="file-list__name">{f.name}</span>
            <span className="file-list__count">{f.reason}</span>
            <span className="file-list__at">{fmtLocal(f.mtime)}</span>
          </div>
        ))}
        {rejected.length > 30 && (
          <div className="file-list__row">
            <span className="file-list__count">외 {(rejected.length - 30).toLocaleString()}개</span>
          </div>
        )}
        {!rejected.length && (
          <div className="file-list__row">
            <span className="file-list__count">모든 파일이 정상 파싱되었습니다</span>
          </div>
        )}
      </div>
      <span className="card__note">
        필수 항목(바람·시정·기온·노점·QNH·활주로) 중 하나라도 없는 전문은 통계에서 제외하고 여기 사유와 함께 표시합니다. 같은 발행 시각·레터의 전문이 여러 파일에 있으면 가장 나중 파일만 씁니다. 새로 쓰인 파일은 변경시각 기준 2초가 지난 뒤 읽습니다(기록 중 파일 방지).
      </span>
    </div>
  );
}
