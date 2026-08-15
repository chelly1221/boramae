/** Tauri 웹뷰 안에서 실행 중인지 (vite dev 브라우저와 구분). */
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
