import type { DetailKey } from '../../../data/types';
import { BirdPanel } from './BirdPanel';
import { CloudPanel } from './CloudPanel';
import { HeatPanel } from './HeatPanel';
import { NoticePanel } from './NoticePanel';
import { QnhPanel } from './QnhPanel';
import { RunwayPanel } from './RunwayPanel';
import { RwycondPanel } from './RwycondPanel';
import { TagsPanel } from './TagsPanel';
import { TempPanel } from './TempPanel';
import type { PanelDef } from './types';
import { UpdatePanel } from './UpdatePanel';
import { VisPanel } from './VisPanel';
import { WindPanel } from './WindPanel';
import { XwindPanel } from './XwindPanel';

/** 상세 페이지 레지스트리 — 통계 카드 키 → 제목/부제/패널 컴포넌트 */
export const PANELS: Record<DetailKey, PanelDef> = {
  temp: { key: 'temp', title: '온도 / 노점', sub: '기온·노점·스프레드 추이', Component: TempPanel },
  wind: { key: 'wind', title: '바람', sub: '풍향·풍속 추이 및 바람', Component: WindPanel },
  xwind: { key: 'xwind', title: '측풍 / 배풍', sub: '사용 활주로 기준 성분 · 한계 초과', Component: XwindPanel },
  runway: { key: 'runway', title: '활주로 사용', sub: '사용 비율 · 전환 이벤트', Component: RunwayPanel },
  heat: { key: 'heat', title: '기상 히트맵', sub: '일 × 시간대 이벤트 분포', Component: HeatPanel },
  update: { key: 'update', title: '정보문자 갱신 빈도', sub: '발행 건수 · 발행 간격', Component: UpdatePanel },
  cloud: { key: 'cloud', title: '구름 / 접근방식', sub: '실링·운량 · 접근 방식 비율', Component: CloudPanel },
  qnh: { key: 'qnh', title: 'QNH', sub: '해면기압 추이 · 변화율', Component: QnhPanel },
  vis: { key: 'vis', title: '시정 / 특이기상', sub: '시정 추이 · 저시정 이벤트 · TS', Component: VisPanel },
  tags: { key: 'tags', title: '기상현상 태그', sub: '태그 빈도 · 시간대 분포', Component: TagsPanel },
  rwycond: { key: 'rwycond', title: '활주로 표면 상태', sub: 'RWYCC · 오염 상태 · 제동작용 보고', Component: RwycondPanel },
  notice: { key: 'notice', title: '운영 공지', sub: 'GPS·흐름관리·윈드시어 등 remarks 빈도', Component: NoticePanel },
  bird: { key: 'bird', title: '조류 활동', sub: '보고 추이 · 방위/거리/시간대 분포 · 활동 구간', Component: BirdPanel },
};

export const PANEL_KEYS = Object.keys(PANELS) as DetailKey[];
