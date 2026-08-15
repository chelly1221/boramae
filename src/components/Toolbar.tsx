import type { Range, View } from '../data/types';
import { IconAerial, IconChevronLeft, IconDownload, IconRefresh, IconWind } from './icons';

interface Props {
  view: View;
  range: Range;
  onRange: (r: Range) => void;
  /** 상세 페이지가 열려 있으면 제목/부제 — 뒤로가기 버튼 표시, 기간 세그먼트 숨김 */
  detailTitle?: string;
  detailSub?: string;
  onBack: () => void;
  windViz: boolean;
  onToggleWindViz: () => void;
  aerial: boolean;
  onToggleAerial: () => void;
  onExportCsv: () => void;
  onRefresh: () => void;
}

const TITLES: Record<View, string> = { stats: '통계 분석', map: '지도', import: '설정' };
const RANGES: { key: Range; label: string }[] = [
  { key: '24h', label: '24시간' },
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
];

export function Toolbar({ view, range, onRange, detailTitle, detailSub, onBack, windViz, onToggleWindViz, aerial, onToggleAerial, onExportCsv, onRefresh }: Props) {
  const inDetail = detailTitle != null;
  return (
    // 툴바는 창 드래그 영역(더블클릭 → 최대화 토글). 컨트롤 묶음만 드래그에서 제외.
    <header className="toolbar" data-tauri-drag-region="deep">
      {inDetail ? (
        <>
          <div className="toolbar__back" data-tauri-drag-region="false" onClick={onBack} title="통계 분석으로 (ESC)">
            <IconChevronLeft />
            <span>통계 분석</span>
          </div>
          <div className="toolbar__title">{detailTitle}</div>
          <div className="toolbar__sub">{detailSub}</div>
        </>
      ) : (
        <>
          <div className="toolbar__title">{TITLES[view]}</div>
          <div className="toolbar__sub">김포국제공항 · RKSS</div>
        </>
      )}
      <div className="toolbar__spacer" />

      <div className="toolbar__actions" data-tauri-drag-region="false">
        {view === 'map' && (
          <>
            <div className={`toggle-pill${aerial ? ' toggle-pill--on' : ''}`} onClick={onToggleAerial} title="2023 김포공항 항공사진 오버레이">
              <IconAerial />
              <span>항공사진</span>
              <span className="switch">
                <span className="switch__knob" />
              </span>
            </div>
            <div className={`toggle-pill${windViz ? ' toggle-pill--on' : ''}`} onClick={onToggleWindViz}>
              <IconWind />
              <span>바람 시각화</span>
              <span className="switch">
                <span className="switch__knob" />
              </span>
            </div>
          </>
        )}

        {!inDetail && (
          <div className="segment">
            {RANGES.map(({ key, label }) => (
              <div key={key} className={`segment__item${range === key ? ' segment__item--active' : ''}`} onClick={() => onRange(key)}>
                {label}
              </div>
            ))}
          </div>
        )}

        <div className="btn" onClick={onExportCsv}>
          <IconDownload />
          <span>CSV</span>
        </div>
        <div className="btn btn--icon" onClick={onRefresh} title="새로고침">
          <IconRefresh />
        </div>
      </div>
    </header>
  );
}
