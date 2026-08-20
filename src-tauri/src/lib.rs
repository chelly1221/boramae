use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/*
 * ATIS 파일 수집 백엔드.
 * - 전문 파일은 1시간마다 폴더에 새로 쓰인다. 폴더 이벤트 대신 **파일 변경시각(mtime) 폴링**으로 감시한다
 *   (네트워크/이동식 매체에서도 동작). 주기마다 폴더의 이름+mtime을 훑어 DB와 다른 파일만 읽어 SQLite에 저장하고
 *   프론트로 `atis-files` 이벤트를 보낸다.
 * - SQLite(exe 옆 `atis.sqlite`, 테이블 atis_files — **파일명 기준, 폴더 경로와 무관하게 합쳐 보관**)가 보관소다.
 *   앱 시작 시 느린 매체를 다시 읽지 않고 DB에서 적재하며, 폴더에서 사라진 파일도 DB에는 남는다(누적 보관).
 *   저널 모드는 DELETE(단일 파일) — 쓰기가 드물어 WAL이 필요 없고, `atis.sqlite` 하나만 복사하면 되게 한다.
 *   파싱은 프론트(src/data/atis/parse.ts)에서 한다.
 */

/// 전문 파일 1개 (프론트 `AtisFile`과 동일한 모양)
#[derive(Serialize, Clone)]
pub struct AtisFile {
    name: String,
    /// 수정 시각 (epoch ms)
    mtime: u64,
    text: String,
}

/// 스캔 1회 결과 (프론트 `atis-scan` 이벤트)
#[derive(Serialize, Clone)]
pub struct ScanStatus {
    dir: String,
    /// 스캔 완료 시각 (epoch ms)
    at: u64,
    /// 폴더에 있는 *.txt 수
    in_dir: usize,
    /// 이번 스캔에서 새로/변경되어 저장한 파일 수
    changed: usize,
    /// 스캔에 걸린 시간 (ms)
    took_ms: u64,
    /// 오류 (있으면)
    error: Option<String>,
}

/// 감시 스레드 핸들
struct Watch {
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct WatchState(Mutex<Option<Watch>>);

/// 감시 폴링 간격 (초)
const SCAN_INTERVAL_SECS: u64 = 60;
/// 한 번에 프론트로 보내는 파일 수 (초기 수천 건을 나눠 보냄)
const EMIT_CHUNK: usize = 500;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn is_txt(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("txt"))
        .unwrap_or(false)
}

/// 폴더 키 — 대소문자·끝 구분자 차이를 무시
fn dir_key(dir: &str) -> String {
    dir.trim().trim_end_matches(['\\', '/']).to_lowercase()
}

/* ---------- DB ---------- */

/// 폴더에 쓸 수 있는지 (프로브 파일 생성·삭제)
fn writable(dir: &Path) -> bool {
    let probe = dir.join(".boramae-write-test");
    let ok = fs::OpenOptions::new().create(true).append(true).open(&probe).is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

/// DB 위치 — **exe와 같은 폴더**(포터블 배포: exe 폴더째 복사하면 DB·설정이 따라감). 그 폴더에 쓸 수 없으면(Program Files 설치 등) 앱 데이터 폴더.
fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        if writable(&dir) {
            return Ok(dir.join("atis.sqlite"));
        }
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&base).map_err(|e| format!("{}: {e}", base.display()))?;
    Ok(base.join("atis.sqlite"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    conn.execute_batch(
        "PRAGMA journal_mode = DELETE;
         PRAGMA synchronous = FULL;
         CREATE TABLE IF NOT EXISTS atis_files (
           name    TEXT    PRIMARY KEY,
           mtime   INTEGER NOT NULL,
           size    INTEGER NOT NULL,
           text    TEXT    NOT NULL,
           seen_at INTEGER NOT NULL,
           src_dir TEXT    NOT NULL
         );
         CREATE TABLE IF NOT EXISTS settings (
           key   TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    migrate_legacy(&conn)?;
    Ok(conn)
}

/// 예전 스키마(files: 폴더 경로별 PRIMARY KEY (dir, name))가 있으면 파일명 기준으로 합쳐 옮기고 지운다 (같은 이름이면 나중에 본 것이 남음)
fn migrate_legacy(conn: &Connection) -> Result<(), String> {
    let legacy: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'files'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if legacy == 0 {
        return Ok(());
    }
    conn.execute_batch(
        "INSERT INTO atis_files (name, mtime, size, text, seen_at, src_dir)
           SELECT name, mtime, size, text, seen_at, dir FROM files ORDER BY seen_at ASC
           ON CONFLICT(name) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, text = excluded.text, seen_at = excluded.seen_at, src_dir = excluded.src_dir;
         DROP TABLE files;",
    )
    .map_err(|e| format!("legacy migrate: {e}"))
}

fn db_load_all(conn: &Connection) -> Result<Vec<AtisFile>, String> {
    let mut st = conn.prepare("SELECT name, mtime, text FROM atis_files ORDER BY name").map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| Ok(AtisFile { name: r.get(0)?, mtime: r.get::<_, i64>(1)? as u64, text: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn db_known_mtimes(conn: &Connection) -> Result<HashMap<String, u64>, String> {
    let mut st = conn.prepare("SELECT name, mtime FROM atis_files").map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashMap<_, _>, _>>().map_err(|e| e.to_string())
}

fn db_upsert(conn: &mut Connection, dir: &str, files: &[(AtisFile, u64)]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut st = tx
            .prepare(
                "INSERT INTO atis_files (name, mtime, size, text, seen_at, src_dir) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(name) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, text = excluded.text, seen_at = excluded.seen_at, src_dir = excluded.src_dir",
            )
            .map_err(|e| e.to_string())?;
        let now = now_ms() as i64;
        for (f, size) in files {
            st.execute(params![f.name, f.mtime as i64, *size as i64, f.text, now, dir_key(dir)]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/* ---------- 폴더 스캔 ---------- */

/// 폴더의 *.txt 중 DB(known)와 이름·mtime이 다른 파일을 읽는다. (읽은 파일, 폴더 내 파일 수)
fn scan_changed(dir: &str, known: &HashMap<String, u64>) -> Result<(Vec<(AtisFile, u64)>, usize), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("{dir}: {e}"))?;
    let mut changed = Vec::new();
    let mut total = 0usize;
    for entry in rd.flatten() {
        let p = entry.path();
        if !is_txt(&p) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        total += 1;
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        if known.get(&name) == Some(&mtime) {
            continue;
        }
        // 쓰는 중인 파일(방금 바뀐 것)은 다음 스캔에 — 수정 후 2초는 기다린다
        if now_ms().saturating_sub(mtime) < 2000 {
            continue;
        }
        if let Ok(bytes) = fs::read(&p) {
            changed.push((AtisFile { name, mtime, text: String::from_utf8_lossy(&bytes).into_owned() }, meta.len()));
        }
    }
    changed.sort_by(|a, b| a.0.name.cmp(&b.0.name));
    Ok((changed, total))
}

/// 스캔 1회: 변경 파일을 DB에 저장하고 이벤트로 보낸다
fn scan_once(app: &AppHandle, conn: &mut Connection, dir: &str, known: &mut HashMap<String, u64>) -> ScanStatus {
    let t0 = Instant::now();
    let mut status = ScanStatus { dir: dir.to_string(), at: 0, in_dir: 0, changed: 0, took_ms: 0, error: None };
    match scan_changed(dir, known) {
        Ok((changed, total)) => {
            status.in_dir = total;
            status.changed = changed.len();
            if !changed.is_empty() {
                if let Err(e) = db_upsert(conn, dir, &changed) {
                    status.error = Some(e);
                } else {
                    for (f, _) in &changed {
                        known.insert(f.name.clone(), f.mtime);
                    }
                    for chunk in changed.chunks(EMIT_CHUNK) {
                        let files: Vec<AtisFile> = chunk.iter().map(|(f, _)| f.clone()).collect();
                        let _ = app.emit("atis-files", files);
                    }
                }
            }
        }
        Err(e) => status.error = Some(e),
    }
    status.at = now_ms();
    status.took_ms = t0.elapsed().as_millis() as u64;
    let _ = app.emit("atis-scan", status.clone());
    status
}

/* ---------- 커맨드 ---------- */

/// 프론트에서 만든 텍스트(CSV 등)를 사용자가 고른 경로에 저장한다.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// DB에 보관된 전문 파일 전부 — 어느 폴더에서 왔든 합쳐서 (앱 시작 시 적재, 폴더를 읽지 않아 즉시 반환)
#[tauri::command]
fn load_atis_db(app: AppHandle) -> Result<Vec<AtisFile>, String> {
    let conn = open_db(&app)?;
    db_load_all(&conn)
}

/// DB 파일 경로 (설정 화면 표시용)
#[tauri::command]
fn atis_db_path(app: AppHandle) -> Result<String, String> {
    Ok(db_path(&app)?.display().to_string())
}

/// 파일 변경시각 감시 시작 — 즉시 1회 스캔 후 SCAN_INTERVAL_SECS 마다 반복. 이미 돌고 있으면 교체.
#[tauri::command]
fn start_atis_watch(app: AppHandle, state: State<'_, WatchState>, dir: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(w) = guard.take() {
        w.stop.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut conn = match open_db(&handle) {
            Ok(c) => c,
            Err(e) => {
                let _ = handle.emit("atis-scan", ScanStatus { dir: dir.clone(), at: now_ms(), in_dir: 0, changed: 0, took_ms: 0, error: Some(e) });
                return;
            }
        };
        let mut known = db_known_mtimes(&conn).unwrap_or_default();
        loop {
            if stop2.load(Ordering::Relaxed) {
                return;
            }
            scan_once(&handle, &mut conn, &dir, &mut known);
            // 1초 단위로 중지 플래그를 확인하며 대기
            for _ in 0..SCAN_INTERVAL_SECS {
                if stop2.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    });
    *guard = Some(Watch { stop });
    Ok(())
}

/// 감시 중지
#[tauri::command]
fn stop_atis_watch(state: State<'_, WatchState>) -> Result<(), String> {
    if let Some(w) = state.0.lock().map_err(|e| e.to_string())?.take() {
        w.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// 지금 즉시 1회 스캔 (툴바 새로고침 / 설정 '다시 읽기') — 감시 스레드와 별개로 동기 실행
#[tauri::command]
fn scan_atis_now(app: AppHandle, dir: String) -> Result<ScanStatus, String> {
    let mut conn = open_db(&app)?;
    let mut known = db_known_mtimes(&conn)?;
    Ok(scan_once(&app, &mut conn, &dir, &mut known))
}

/// 설정값 읽기 (DB settings 테이블 — 감시 폴더 등, exe 폴더와 함께 이동)
#[tauri::command]
fn atis_get_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())
}

/// 설정값 저장
#[tauri::command]
fn atis_set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// DB에 보관된 파일 수 (설정 화면)
#[tauri::command]
fn atis_db_count(app: AppHandle) -> Result<i64, String> {
    let conn = open_db(&app)?;
    conn.query_row("SELECT COUNT(*) FROM atis_files", [], |r| r.get::<_, i64>(0))
        .optional()
        .map(|v| v.unwrap_or(0))
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(WatchState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_text_file,
            load_atis_db,
            atis_db_path,
            atis_db_count,
            atis_get_setting,
            atis_set_setting,
            start_atis_watch,
            stop_atis_watch,
            scan_atis_now
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
