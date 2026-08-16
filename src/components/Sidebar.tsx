import logo from '../assets/boramae.png';
import type { ReactElement } from 'react';
import type { DetailKey, View } from '../data/types';
import { PANELS, PANEL_KEYS } from './detail/panels';
import { IconMap, IconSettings, IconStats } from './icons';
import { TrafficLights } from './TrafficLights';

interface Props {
  view: View;
  /** 통계 뷰 안에서 열려 있는 상세 페이지 (없으면 null) */
  detail: DetailKey | null;
  onChange: (v: View) => void;
  onOpenDetail: (key: DetailKey) => void;
  lastTime: string;
  total: number;
}

const NAV: { key: View; label: string; icon: () => ReactElement }[] = [
  { key: 'stats', label: '분석', icon: IconStats },
  { key: 'map', label: '지도', icon: IconMap },
  { key: 'import', label: '설정', icon: IconSettings },
];

export function Sidebar({ view, detail, onChange, onOpenDetail, lastTime, total }: Props) {
  const inStats = view === 'stats';
  const inDetail = inStats && detail != null;
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
        {NAV.map(({ key, label, icon: Icon }) => {
          const isStats = key === 'stats';
          // 상세 페이지가 열려 있으면 부모(분석)는 '열림' 톤, 선택 강조는 하위 항목이 가져감
          const active = view === key && !(isStats && inDetail);
          const open = isStats && inDetail;
          const cls = ['nav__item', active ? 'nav__item--active' : '', open ? 'nav__item--open' : ''].filter(Boolean).join(' ');
          return (
            <div key={key}>
              <div className={cls} onClick={() => onChange(key)}>
                <Icon />
                <span>{label}</span>
              </div>
              {isStats && inStats && (
                // 분석 하위: 카드 클릭으로 들어가는 상세 페이지 목록 (PANELS 레지스트리 기준)
                <div className="nav__sub">
                  {PANEL_KEYS.map((k) => (
                    <div
                      key={k}
                      className={`nav__subitem${detail === k ? ' nav__subitem--active' : ''}`}
                      title={PANELS[k].sub}
                      onClick={() => onOpenDetail(k)}
                    >
                      {PANELS[k].title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__spacer" />
      <div className="sidebar__status">
        <span>폴더 감시 · 정상</span>
        <span>
          최종 수신 {lastTime.slice(-5)} · {total.toLocaleString()}건
        </span>
      </div>
    </aside>
  );
}
