import { useEffect, useState } from 'react';
import { isTauri } from '../tauri';

type TauriWindow = import('@tauri-apps/api/window').Window;

/**
 * 현재 Tauri 창 핸들 + 포커스/최대화 상태.
 * 브라우저(vite dev)에서는 win=null이고 상태는 기본값(포커스됨, 비최대화)으로 고정.
 */
function useTauriWindow() {
  const [win, setWin] = useState<TauriWindow | null>(null);
  const [focused, setFocused] = useState(true);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: (() => void)[] = [];

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      if (disposed) return;
      setWin(w);
      const [f, m] = await Promise.all([w.isFocused(), w.isMaximized()]);
      setFocused(f);
      setMaximized(m);
      const offFocus = await w.onFocusChanged(({ payload }) => setFocused(payload));
      if (disposed) return offFocus();
      unlisten.push(offFocus);
      const offResize = await w.onResized(() => void w.isMaximized().then(setMaximized));
      if (disposed) return offResize();
      unlisten.push(offResize);
    })();

    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  return { win, focused, maximized };
}

/** macOS 창 제어 글리프 (12×12, hover 시에만 표시) */
const GlyphClose = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M3.3 3.3l5.4 5.4M8.7 3.3L3.3 8.7" />
  </svg>
);
const GlyphMinimize = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2.8 6h6.4" />
  </svg>
);
/** 확대(바깥쪽 화살촉) / 복원(안쪽 화살촉) */
const GlyphZoom = ({ restore }: { restore: boolean }) => (
  <svg viewBox="0 0 12 12" fill="currentColor" stroke="none">
    {restore ? <path d="M6.3 5.7h3.2L6.3 2.5zM5.7 6.3H2.5l3.2 3.2z" /> : <path d="M6.3 2.5h3.2v3.2zM5.7 9.5H2.5V6.3z" />}
  </svg>
);

/**
 * macOS 스타일 신호등(닫기·최소화·확대) 창 제어 버튼.
 * Tauri 창에서만 동작하며, 브라우저 미리보기에서는 장식으로만 표시된다.
 */
export function TrafficLights() {
  const { win, focused, maximized } = useTauriWindow();
  return (
    <div className={`lights${focused ? '' : ' lights--blur'}`} data-tauri-drag-region="false">
      <button type="button" tabIndex={-1} className="lights__btn lights__btn--close" aria-label="닫기" onClick={() => void win?.close()}>
        <GlyphClose />
      </button>
      <button type="button" tabIndex={-1} className="lights__btn lights__btn--min" aria-label="최소화" onClick={() => void win?.minimize()}>
        <GlyphMinimize />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="lights__btn lights__btn--zoom"
        aria-label={maximized ? '이전 크기로' : '최대화'}
        onClick={() => void win?.toggleMaximize()}
      >
        <GlyphZoom restore={maximized} />
      </button>
    </div>
  );
}
