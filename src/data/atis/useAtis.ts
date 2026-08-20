import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '../../tauri';
import { dbInfo, loadDirSetting, pickDir, readDir, saveDirSetting, scanNow, watchDir, type ScanStatus } from './source';
import { buildStore, EMPTY_STORE, mergeFiles, type AtisStore } from './store';

export type AtisStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AtisState {
  dir: string;
  status: AtisStatus;
  /** 적재 오류 메시지 (status === 'error') */
  error: string;
  /** 감시(스캐너) 구독 중 */
  watching: boolean;
  /** 마지막 스캔 상태 (없으면 null) — 오류는 scan.error */
  scan: ScanStatus | null;
  /** 즉시 스캔 진행 중 */
  scanning: boolean;
  /** 마지막 적재/수신 시각 (epoch ms, 로컬) */
  loadedAt: number | null;
  /** SQLite 정보 (Tauri) — 브라우저는 null */
  db: { path: string; count: number } | null;
  store: AtisStore;
}

/**
 * ATIS 적재·감시 훅.
 * - 마운트 시 저장된 폴더를 적재(Tauri: DB에서 즉시)하고 파일 변경시각 감시를 건다 (Rust 스캐너가 즉시 1회 + 60초마다 스캔)
 * - reload(): 즉시 스캔(Tauri) / 전체 재적재(브라우저), reloadAll(): DB에서 전체 재적재, changeDir(): 폴더 선택 → 저장 → 재적재, setPaused(): 감시 일시중지
 */
export function useAtis() {
  const [state, setState] = useState<AtisState>(() => ({
    dir: '',
    status: 'idle',
    error: '',
    watching: false,
    scan: null,
    scanning: false,
    loadedAt: null,
    db: null,
    store: EMPTY_STORE,
  }));
  const [paused, setPaused] = useState(false);
  const gen = useRef(0);

  const refreshDb = useCallback((dir: string) => {
    void dbInfo()
      .then((db) => setState((s) => (s.dir === dir ? { ...s, db } : s)))
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (dir: string) => {
      const g = ++gen.current;
      setState((s) => ({ ...s, dir, status: 'loading', error: '', scan: null }));
      try {
        const files = await readDir(dir);
        if (g !== gen.current) return;
        setState((s) => ({ ...s, dir, status: 'ready', error: '', loadedAt: Date.now(), store: buildStore(files) }));
        refreshDb(dir);
      } catch (e) {
        if (g !== gen.current) return;
        setState((s) => ({ ...s, dir, status: 'error', error: String(e instanceof Error ? e.message : e), store: EMPTY_STORE }));
      }
    },
    [refreshDb],
  );

  // 최초 적재 — 저장된 폴더 설정(DB → localStorage → 기본값)을 읽어 자동 적재
  useEffect(() => {
    void loadDirSetting().then((dir) => load(dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 감시 구독 (폴더·일시중지 상태가 바뀌면 다시). 적재 오류여도 감시는 걸어 폴더가 살아나면 스캔이 채운다
  useEffect(() => {
    if (paused || state.status === 'idle' || state.status === 'loading') {
      setState((s) => (s.watching ? { ...s, watching: false } : s));
      return;
    }
    const dir = state.dir;
    let stop: (() => void) | null = null;
    let cancelled = false;
    watchDir(
      dir,
      (incoming) => setState((s) => ({ ...s, status: 'ready', store: mergeFiles(s.store, incoming), loadedAt: Date.now() })),
      (scan) => {
        setState((s) => ({ ...s, scan }));
        if (scan.changed > 0) refreshDb(dir);
      },
    )
      .then((fn) => {
        if (cancelled) fn();
        else {
          stop = fn;
          setState((s) => ({ ...s, watching: true }));
        }
      })
      .catch((e) => setState((s) => ({ ...s, scan: { dir, at: Date.now(), in_dir: -1, changed: 0, took_ms: 0, error: String(e) }, watching: false })));
    return () => {
      cancelled = true;
      if (stop) stop();
      setState((s) => ({ ...s, watching: false }));
    };
  }, [state.dir, state.status, paused, refreshDb]);

  /** 새로고침 — Tauri는 즉시 스캔(변경분은 이벤트로 도착), 브라우저는 전체 재적재 */
  const reload = useCallback(async () => {
    if (!isTauri()) return load(state.dir);
    setState((s) => ({ ...s, scanning: true }));
    try {
      const scan = await scanNow(state.dir);
      if (scan) setState((s) => ({ ...s, scan }));
    } catch (e) {
      setState((s) => ({ ...s, scan: { dir: s.dir, at: Date.now(), in_dir: -1, changed: 0, took_ms: 0, error: String(e) } }));
    } finally {
      setState((s) => ({ ...s, scanning: false }));
    }
  }, [load, state.dir]);

  /** DB에서 전체 다시 적재 (파서를 바꿨거나 상태가 꼬였을 때) */
  const reloadAll = useCallback(() => load(state.dir), [load, state.dir]);

  const changeDir = useCallback(async () => {
    const dir = await pickDir(state.dir);
    if (!dir || dir === state.dir) return;
    await saveDirSetting(dir);
    await load(dir);
  }, [load, state.dir]);

  return { ...state, paused, setPaused, reload, reloadAll, changeDir };
}
