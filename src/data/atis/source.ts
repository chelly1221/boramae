import { isTauri } from '../../tauri';
import type { AtisFile } from '../types';

/*
 * ATIS 파일 공급원.
 * - Tauri: Rust가 SQLite(exe 옆 atis.sqlite)에 파일을 **파일명 기준으로 폴더 경로와 무관하게** 누적 보관한다. 시작 시 `load_atis_db`로 DB 전체를 즉시 적재하고,
 *   `start_atis_watch`가 60초마다 폴더의 **파일 변경시각(mtime)**을 스캔해 바뀐/새 파일만 읽어 DB에 저장한 뒤
 *   `atis-files`(파일 묶음) / `atis-scan`(스캔 상태) 이벤트로 알려 준다. `scan_atis_now`는 즉시 1회 스캔.
 * - 브라우저(vite dev): vite.config.ts의 개발용 미들웨어 `/__atis/files?dir=…&since=…` 를 주기적으로 폴링 (DB 없음)
 */

/** 기본 감시 폴더 (설정 화면에서 변경, localStorage에 보존) */
export const DEFAULT_DIR = 'D:\\';
const LS_KEY = 'boramae.atisDir';
/** 브라우저 폴링 간격 (ms) — Tauri 쪽 스캔 간격(60초)과 맞춤 */
const POLL_MS = 60000;

/** 스캔 1회 상태 (Rust `ScanStatus`) */
export interface ScanStatus {
  dir: string;
  /** 스캔 완료 시각 (epoch ms) */
  at: number;
  /** 폴더의 *.txt 수 */
  in_dir: number;
  /** 이번 스캔에서 저장한 파일 수 */
  changed: number;
  took_ms: number;
  error: string | null;
}

function lsGet(): string {
  try {
    return localStorage.getItem(LS_KEY) || '';
  } catch {
    return '';
  }
}

/** 감시 폴더 설정 — Tauri는 DB settings 테이블(exe 폴더와 함께 이동), 없으면 localStorage, 없으면 기본값 */
export async function loadDirSetting(): Promise<string> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const v = await invoke<string | null>('atis_get_setting', { key: 'dir' });
      if (v) return v;
    } catch {
      /* DB 못 열면 아래 폴백 */
    }
  }
  return lsGet() || DEFAULT_DIR;
}
export async function saveDirSetting(dir: string): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, dir);
  } catch {
    /* ignore */
  }
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('atis_set_setting', { key: 'dir', value: dir }).catch(() => undefined);
  }
}

/** 초기 적재 — Tauri는 DB 전체(폴더를 읽지 않음, 어느 폴더에서 왔든 합쳐서), 브라우저는 폴더 전체 */
export async function readDir(dir: string): Promise<AtisFile[]> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AtisFile[]>('load_atis_db');
  }
  const res = await fetch(`/__atis/files?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (await res.json()) as AtisFile[];
}

/** DB 정보 (Tauri 전용) — 브라우저는 null */
export async function dbInfo(): Promise<{ path: string; count: number } | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const [path, count] = await Promise.all([invoke<string>('atis_db_path'), invoke<number>('atis_db_count')]);
  return { path, count };
}

/**
 * 파일 변경 감시 — 바뀐/새 파일이 생기면 onFiles(files), 스캔이 끝날 때마다 onScan(status). 반환값은 구독 해제 함수.
 * Tauri는 Rust 스캐너(즉시 1회 + 60초 주기), 브라우저는 mtime 폴링.
 */
export async function watchDir(dir: string, onFiles: (files: AtisFile[]) => void, onScan: (s: ScanStatus) => void): Promise<() => void> {
  if (isTauri()) {
    const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
    const unFiles = await listen<AtisFile[]>('atis-files', (e) => {
      if (e.payload.length) onFiles(e.payload);
    });
    const unScan = await listen<ScanStatus>('atis-scan', (e) => onScan(e.payload));
    await invoke('start_atis_watch', { dir });
    return () => {
      unFiles();
      unScan();
      void invoke('stop_atis_watch').catch(() => undefined);
    };
  }
  let since = Date.now() - POLL_MS;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const t0 = Date.now();
    try {
      const res = await fetch(`/__atis/files?dir=${encodeURIComponent(dir)}&since=${since - 2000}`);
      if (!res.ok) throw new Error(await res.text());
      const files = (await res.json()) as AtisFile[];
      if (files.length) {
        since = Math.max(since, ...files.map((f) => f.mtime));
        onFiles(files);
      }
      onScan({ dir, at: Date.now(), in_dir: -1, changed: files.length, took_ms: Date.now() - t0, error: null });
    } catch (e) {
      onScan({ dir, at: Date.now(), in_dir: -1, changed: 0, took_ms: Date.now() - t0, error: String(e instanceof Error ? e.message : e) });
    }
  };
  const id = setInterval(() => void tick(), POLL_MS);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

/** 즉시 1회 스캔 (Tauri). 변경분은 `atis-files` 이벤트로 온다. 브라우저는 아무것도 하지 않고 null */
export async function scanNow(dir: string): Promise<ScanStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ScanStatus>('scan_atis_now', { dir });
}

/** 폴더 선택 — Tauri 다이얼로그 / 브라우저 prompt. 취소하면 null */
export async function pickDir(current: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false, defaultPath: current, title: 'ATIS 전문 폴더 선택' });
    return typeof r === 'string' ? r : null;
  }
  const r = window.prompt('ATIS 전문 폴더 경로', current);
  return r && r.trim() ? r.trim() : null;
}
