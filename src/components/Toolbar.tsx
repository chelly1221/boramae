import type { Range, View } from '../data/types';
import { IconAerial, IconDownload, IconRefresh, IconWind } from './icons';

interface Props {
  view: View;
  range: Range;
  onRange: (r: Range) => void;
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

export function Toolbar({ view, range, onRange, windViz, onToggleWindViz, aerial, onToggleAerial, onExportCsv, onRefresh }: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar__title">{TITLES[view]}</div>
      <div className="toolbar__sub">김포국제공항 · RKSS</div>
      <div className="toolbar__spacer" />

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

      <div className="segment">
        {RANGES.map(({ key, label }) => (
          <div key={key} className={`segment__item${range === key ? ' segment__item--active' : ''}`} onClick={() => onRange(key)}>
            {label}
          </div>
        ))}
      </div>

      <div className="btn" onClick={onExportCsv}>
        <IconDownload />
        <span>CSV</span>
      </div>
      <div className="btn btn--icon" onClick={onRefresh} title="새로고침">
        <IconRefresh />
      </div>
    </header>
  );
}
