import { useMemo } from 'react';
import { autoUnit } from '../../data/detail/agg';
import type { AtisRecord, DetailKey, TimeWindow } from '../../data/types';
import { PANELS } from './panels';
import { PeriodPicker } from './PeriodPicker';
import { Empty } from './primitives';

interface Props {
  detailKey: DetailKey;
  recs: AtisRecord[];
  win: TimeWindow;
  onWindow: (w: TimeWindow) => void;
  now: number;
  minTs: number;
  xwLimit: number;
  onOpenRaw: (index: number) => void;
}

/** 통계 카드 상세 페이지 — 기간 지정 + 항목별 패널 */
export function DetailView({ detailKey, recs, win, onWindow, now, minTs, xwLimit, onOpenRaw }: Props) {
  const def = PANELS[detailKey];
  const unit = useMemo(() => autoUnit(recs, win), [recs, win]);
  const Panel = def.Component;
  return (
    <div className="detail">
      <PeriodPicker win={win} onChange={onWindow} now={now} minTs={minTs} count={recs.length} unit={unit} />
      {recs.length ? (
        <Panel recs={recs} win={win} xwLimit={xwLimit} onOpenRaw={onOpenRaw} />
      ) : (
        <div className="card">
          <Empty>선택한 기간에 수신된 전문이 없습니다. 기간을 조정하세요.</Empty>
        </div>
      )}
    </div>
  );
}
