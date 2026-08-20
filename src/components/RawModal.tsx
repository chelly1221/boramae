import { useEffect } from 'react';
import type { AtisRecord } from '../data/types';
import { IconChevronLeft, IconChevronRight, IconClose } from './icons';

interface Props {
  rec: AtisRecord;
  /** 1-based 위치 */
  pos: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** 원문 전문 모달 — ← → 이전·다음, ESC 닫기 */
export function RawModal({ rec, pos, total, onPrev, onNext, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext, onClose]);

  const chips = [
    `WIND ${rec.wind}${rec.varFrom != null ? ` V${String(rec.varFrom).padStart(3, '0')}-${String(rec.varTo).padStart(3, '0')}` : ''}`,
    `VIS ${rec.visTxt}`,
    ...(rec.wxTxt ? [rec.wxTxt] : []),
    ...(rec.rvr.length ? [`RVR ${rec.rvr.map((x) => `${x.pos}${x.m}`).join(' ')}`] : []),
    rec.cloud,
    `T${rec.t}° / DP${rec.dp}°`,
    `QNH ${rec.qnh}`,
    `ARR ${rec.arrRwy ?? '—'} · DEP ${rec.depRwy ?? '—'}`,
    `${rec.appName} APCH`,
    ...(rec.trend ? [`TREND ${rec.trend}`] : []),
    ...(rec.rwyCond.length ? ['RWY 상태 보고'] : []),
    ...rec.notices.filter((n) => n.kind !== 'BIRDS' && n.kind !== 'GPS').map((n) => n.kind),
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="modal__badge">{rec.letter}</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="modal__title">원문 전문 · INFO {rec.letter}</span>
            <span className="modal__sub">
              {rec.time} · {pos} / {total} · {rec.file}
            </span>
          </div>
          <div className="modal__spacer" />
          <div className="icon-btn" onClick={onPrev} title="이전 (←)">
            <IconChevronLeft />
          </div>
          <div className="icon-btn" onClick={onNext} title="다음 (→)">
            <IconChevronRight />
          </div>
          <div className="icon-btn" onClick={onClose} title="닫기 (ESC)">
            <IconClose />
          </div>
        </div>
        <div className="chips">
          {chips.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
        <div className="raw">{rec.raw}</div>
        <span className="modal__hint">← → 이전·다음 · ESC 닫기</span>
      </div>
    </div>
  );
}
