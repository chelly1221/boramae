import type { ReactElement } from 'react';
import type { AtisRecord, DetailKey, TimeWindow } from '../../../data/types';

/** 상세 패널 공통 props — 기간 창 안의 레코드(ts 오름차순)와 원문 열기 콜백 */
export interface PanelProps {
  /** 조회 창 안의 레코드 (ts 오름차순). 비어 있을 수 있음 */
  recs: AtisRecord[];
  win: TimeWindow;
  /** 측풍 한계 (KT) */
  xwLimit: number;
  /** recs 인덱스의 원문 모달 열기 */
  onOpenRaw: (index: number) => void;
}

export interface PanelDef {
  key: DetailKey;
  /** 툴바/헤더 제목 */
  title: string;
  /** 부제 (툴바 보조 텍스트) */
  sub: string;
  Component: (p: PanelProps) => ReactElement;
}
