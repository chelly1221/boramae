import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/*
 * 상세 페이지 공용 UI 프리미티브 — 패널(panels/*)은 가급적 이 컴포넌트들로 구성한다.
 * 스타일은 styles.css의 "Detail view" 섹션 (.dsection / .dtiles / .tchart / .bchart / .dtable ...).
 */

/* ---------- 컨테이너 폭 측정 ---------- */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------- 섹션 카드 ---------- */

export function Section({
  title,
  sub,
  right,
  children,
  className,
  style,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** 헤더 우측 (범례 등) */
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`card dsection${className ? ' ' + className : ''}`} style={style}>
      <div className="card__head">
        <span className="card__title">
          {title}
          {sub && <small> · {sub}</small>}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** 범례 항목 (선/사각/대시) */
export function Legend({ color, label, kind = 'line' }: { color?: string; label: ReactNode; kind?: 'line' | 'sq' | 'dash' }) {
  return (
    <span className="legend">
      {kind === 'dash' ? <span className="legend__dash" style={color ? { borderTopColor: color } : undefined} /> : <span className={kind === 'sq' ? 'legend__sq' : 'legend__line'} style={{ background: color }} />}
      {label}
    </span>
  );
}

/* ---------- 요약 타일 ---------- */

export interface Tile {
  label: string;
  value: ReactNode;
  /** 값 아래 보조 텍스트 */
  sub?: ReactNode;
  color?: string;
  /** 강조 (primary 색 값) */
  accent?: boolean;
}

export function StatTiles({ tiles, cols }: { tiles: Tile[]; cols?: number }) {
  return (
    <div className="dtiles" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {tiles.map((t, i) => (
        <div key={i} className={`dtile${t.accent ? ' dtile--accent' : ''}`}>
          <span className="dtile__label">{t.label}</span>
          <span className="dtile__value" style={t.color ? { color: t.color } : undefined}>
            {t.value}
          </span>
          {t.sub && <span className="dtile__sub">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------- 빈 상태 ---------- */

export function Empty({ children = '선택한 기간에 데이터가 없습니다.' }: { children?: ReactNode }) {
  return <div className="dempty">{children}</div>;
}

/* ---------- 테이블 ---------- */

export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T, i: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  mono?: boolean;
}

export function DetailTable<T>({
  columns,
  rows,
  onRowClick,
  maxRows = 300,
  maxHeight = 360,
  rowKey,
  emptyText,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T, i: number) => void;
  /** 초과분은 잘라내고 안내 문구 */
  maxRows?: number;
  maxHeight?: number;
  rowKey?: (row: T, i: number) => string | number;
  emptyText?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [rows]);
  if (!rows.length) return <Empty>{emptyText ?? '해당 항목이 없습니다.'}</Empty>;
  const shown = showAll ? rows : rows.slice(0, maxRows);
  return (
    <div className="dtable-wrap">
      <div className="dtable" style={{ maxHeight }}>
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align ?? 'left', width: c.width }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={rowKey ? rowKey(row, i) : i} className={onRowClick ? 'dtable__row--link' : undefined} onClick={onRowClick ? () => onRowClick(row, i) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.mono ? 'mono' : undefined} style={{ textAlign: c.align ?? 'left' }}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && !showAll && (
        <div className="dtable__more">
          {rows.length.toLocaleString()}건 중 {maxRows}건 표시 ·{' '}
          <span className="dtable__more-btn" onClick={() => setShowAll(true)}>
            전체 보기
          </span>
        </div>
      )}
    </div>
  );
}
