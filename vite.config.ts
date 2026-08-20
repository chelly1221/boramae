import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * 개발용 ATIS 폴더 공급 미들웨어 — 브라우저(vite dev)에서도 실제 전문 폴더를 읽을 수 있게 한다 (Tauri에서는 Rust 커맨드 사용).
 *   GET /__atis/files?dir=D:\&since=<epoch ms>  → [{ name, mtime, text }] (since 이후 수정된 *.TXT만, 없으면 전체)
 */
function atisDevSource(): Plugin {
  /** 서버 수명 동안의 파일 캐시 (폴더 → 이름 → 파일). 전문 파일은 한 번 쓰이면 바뀌지 않으므로 이름으로 캐시하고, 최근 파일 몇 개만 다시 stat 한다 */
  const cache = new Map<string, Map<string, { name: string; mtime: number; text: string }>>();
  const RECHECK_NEWEST = 40;
  let busy: Promise<void> | null = null;
  return {
    name: "atis-dev-source",
    configureServer(server) {
      server.middlewares.use("/__atis/files", async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const dir = url.searchParams.get("dir") ?? "";
        const since = Number(url.searchParams.get("since") ?? 0) || 0;
        // 느린 매체에서 폴링 요청이 겹치지 않도록 직렬화
        while (busy) await busy;
        let done!: () => void;
        busy = new Promise<void>((r) => (done = r));
        try {
          const names = (await fs.readdir(dir)).filter((n) => /\.txt$/i.test(n)).sort();
          let files = cache.get(dir);
          if (!files) {
            files = new Map();
            cache.set(dir, files);
          }
          const recheckFrom = Math.max(0, names.length - RECHECK_NEWEST);
          for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const hit = files.get(name);
            if (hit && i < recheckFrom) continue;
            const p = path.join(dir, name);
            const st = await fs.stat(p);
            if (!st.isFile()) continue;
            const mtime = Math.round(st.mtimeMs);
            if (hit && hit.mtime === mtime) continue;
            files.set(name, { name, mtime, text: await fs.readFile(p, "latin1") });
          }
          const present = new Set(names);
          for (const k of [...files.keys()]) if (!present.has(k)) files.delete(k);
          const out = [...files.values()].filter((f) => f.mtime > since);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(out));
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e instanceof Error ? e.message : e));
        } finally {
          busy = null;
          done();
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), atisDevSource()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
