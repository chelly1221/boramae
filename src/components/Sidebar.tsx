import logo from '../assets/boramae.png';
import type { ReactElement } from 'react';
import type { View } from '../data/types';
import { IconMap, IconSettings, IconStats } from './icons';
import { TrafficLights } from './TrafficLights';

interface Props {
  view: View;
  onChange: (v: View) => void;
  lastTime: string;
  total: number;
}

const NAV: { key: View; label: string; icon: () => ReactElement }[] = [
  { key: 'stats', label: '통계 분석', icon: IconStats },
  { key: 'map', label: '지도', icon: IconMap },
  { key: 'import', label: '설정', icon: IconSettings },
];

export function Sidebar({ view, onChange, lastTime, total }: Props) {
  return (
    // 사이드바 전체가 창 드래그 영역 (macOS 사이드바 창처럼). 클릭 가능한 항목은 개별로 제외.
    <aside className="sidebar" data-tauri-drag-region="deep">
      <TrafficLights />
      <div className="sidebar__brand">
        <img src={logo} alt="KAC 보라매" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="sidebar__brand-name">KAC 보라매</span>
          <span className="sidebar__brand-sub">ATIS 통계·분석</span>
        </div>
      </div>

      <div className="sidebar__section">공항</div>
      <div className="airport" data-tauri-drag-region="false">
        <span className="airport__dot" />
        <span className="airport__name">RKSS 김포</span>
        <span className="airport__badge">감시 중</span>
      </div>

      <div className="sidebar__section sidebar__section--views">보기</div>
      <nav className="nav" data-tauri-drag-region="false">
        {NAV.map(({ key, label, icon: Icon }) => (
          <div key={key} className={`nav__item${view === key ? ' nav__item--active' : ''}`} onClick={() => onChange(key)}>
            <Icon />
            <span>{label}</span>
          </div>
        ))}
      </nav>

      <div className="sidebar__spacer" />
      <div className="sidebar__status">
        <span>폴더 감시 · 정상</span>
        <span>
          최종 수신 {lastTime} · {total}건
        </span>
      </div>
    </aside>
  );
}
