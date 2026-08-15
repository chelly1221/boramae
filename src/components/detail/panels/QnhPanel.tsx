import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtNum, UNIT_LABEL } from '../../../data/detail/agg';
import { computeQnhDetail, QNH_JUMP_HPA, type QnhJump } from '../../../data/detail/qnh';
import { BarChart, HOUR_LABELS, TimeSeriesChart } from '../charts';
import { DetailTable, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_QNH = '#6b8cae';
const C_UP = '#b4451c';
const C_DOWN = '#5b8bc9';

/** QNH 상세 — 추이 · 일별 범위 · 시간대별 편차 · 3시간 급변 이벤트 */
export function QnhPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeQnhDetail(recs, win), [recs, win]);
  const openBucket = (i: number) => {
    const idx = d.buckets[i]?.idx[0];
    if (idx != null) onOpenRaw(idx);
  };

  const jumpCols: Column<QnhJump>[] = [
    { key: 'ts', label: '시각', render: (j) => fmtDT(j.ts), mono: true },
    { key: 'delta', label: '3시간 변화', align: 'right', mono: true, render: (j) => <span style={{ color: j.delta > 0 ? C_UP : C_DOWN, fontWeight: 700 }}>{(j.delta > 0 ? '+' : '') + fmtNum(j.delta)} hPa</span> },
    { key: 'fromto', label: '기압 (3h 전 → 당시)', align: 'right', mono: true, render: (j) => `${j.from} → ${j.to}` },
    { key: 'dir', label: '경향', render: (j) => (j.delta > 0 ? '급상승' : '급하강') },
    { key: 'span', label: '구간', mono: true, render: (j) => `${fmtDayHM(recs[j.start].ts)} ~ ${fmtDayHM(recs[j.end].ts)}` },
  ];

  return (
    <>
      <StatTiles
        tiles={[
          { label: '평균 QNH', value: `${fmtNum(d.avg)} hPa`, accent: true },
          { label: '최고', value: `${d.maxV} hPa`, sub: fmtDayHM(d.maxAt) },
          { label: '최저', value: `${d.minV} hPa`, sub: fmtDayHM(d.minAt) },
          { label: '변화 폭', value: `${fmtNum(d.range)} hPa` },
          {
            label: '최대 3시간 변화',
            value: d.maxJump ? `${d.maxJump.delta > 0 ? '+' : ''}${fmtNum(d.maxJump.delta)} hPa` : '—',
            sub: d.maxJump ? fmtDayHM(recs[d.maxJump.index].ts) : undefined,
            color: d.maxJump && Math.abs(d.maxJump.delta) >= QNH_JUMP_HPA ? C_UP : undefined,
          },
          { label: '급변 이벤트', value: `${d.jumps.length}건`, sub: `|Δ| ≥ ${QNH_JUMP_HPA} hPa/3h` },
          { label: '기간 마지막', value: `${d.last} hPa` },
        ]}
      />

      <Section title="QNH 추이" sub={`hPa · 해상도 ${UNIT_LABEL[d.unit]}`} right={<><Legend color={C_QNH} label="해면기압" /><Legend kind="dash" label={`평균 ${fmtNum(d.avg)}`} /></>}>
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={[{ name: 'QNH', color: C_QNH, values: d.values, area: true, step: d.unit === 'raw', format: (v) => fmtNum(v) }]}
          thresholds={[{ y: d.avg, color: '#8c7a6e', label: '평균' }]}
          unit=" hPa"
          height={240}
          onPointClick={openBucket}
        />
        <span className="dsection__note">점을 클릭하면 해당 시각 원문을 엽니다{d.unit !== 'raw' ? ' (집계 구간의 첫 전문)' : ''}.</span>
      </Section>

      <div className="dgrid-2">
        <Section title="일별 기압 범위" sub="최저 ~ 최고 (막대) · 평균 (툴팁)">
          <BarChart
            items={d.daily.map((x) => ({ label: x.label, lo: x.min, value: x.max, color: 'rgba(107,140,174,0.75)', title: x.label, note: `평균 ${fmtNum(x.mean)} hPa · ${x.n}건` }))}
            yMin={Math.floor(d.minV - 1)}
            yMax={Math.ceil(d.maxV + 1)}
            unit=" hPa"
            height={200}
          />
        </Section>
        <Section title="시간대별 평균 편차" sub="UTC 시각별 평균 − 기간 평균 (반일주기 확인)">
          <BarChart
            items={d.hourAnomaly.map((v, h) => ({ label: HOUR_LABELS[h], value: v ?? 0, color: (v ?? 0) >= 0 ? 'rgba(180,69,28,0.7)' : 'rgba(91,139,201,0.7)', title: `${HOUR_LABELS[h]}:00Z` }))}
            yFormat={(v) => (v > 0 ? '+' : '') + fmtNum(v)}
            unit=" hPa"
            height={200}
            labelEvery={3}
          />
        </Section>
      </div>

      <Section title="급변 이벤트" sub={`3시간 변화량 |Δ| ≥ ${QNH_JUMP_HPA} hPa · 클릭 → 원문`}>
        <DetailTable columns={jumpCols} rows={d.jumps} rowKey={(j) => j.index} onRowClick={(j) => onOpenRaw(j.index)} emptyText="기간 내 급변 이벤트가 없습니다." />
      </Section>
    </>
  );
}
