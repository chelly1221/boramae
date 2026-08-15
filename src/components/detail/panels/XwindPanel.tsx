import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur, fmtHM, fmtNum, UNIT_LABEL } from '../../../data/detail/agg';
import { computeXwindDetail, type RwyXwSummary, type TwEvent, type XwEvent } from '../../../data/detail/xwind';
import { BarChart, HOUR_LABELS, TimeSeriesChart, withAlpha } from '../charts';
import { DetailTable, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_XW = '#7f0d00';
const C_TW = '#8c7a6e';
const C_LIMIT = '#b8770a';
const C_OVER = '#c8422e';
const C_WARN = '#b4451c';
const BAND = 'rgba(200,66,46,0.14)';
/** 범례 스와치용 (차트 밴드보다 진하게) */
const BAND_LEGEND = 'rgba(200,66,46,0.4)';
const YBAND = 'rgba(184,119,10,0.07)';

const kt = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${fmtNum(v, digits)} KT`);
const rwyShort = (rwy: string) => rwy.slice(0, 2);

/** 측풍/배풍 상세 — 추이·한계 초과 이벤트·일별/시간대별 집계·활주로별 요약 */
export function XwindPanel({ recs, win, xwLimit, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeXwindDetail(recs, win, xwLimit), [recs, win, xwLimit]);
  /** 점 클릭 → 버킷 내 최대 측풍 전문 (raw면 그 전문) */
  const openBucket = (i: number) => {
    const idx = d.xwPeakIdx[i];
    if (idx != null) onOpenRaw(idx);
  };

  const evCols: Column<XwEvent>[] = [
    { key: 'start', label: '시작', mono: true, render: (e) => fmtDT(e.startTs) },
    { key: 'end', label: '종료', mono: true, render: (e) => (e.n > 1 ? fmtDT(e.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (e) => (e.n > 1 ? `${fmtDur(e.durMs)} (${e.n}건)` : '단발 (1건)') },
    { key: 'peak', label: '최대 측풍', align: 'right', mono: true, render: (e) => <span style={{ color: C_OVER, fontWeight: 700 }}>{kt(e.peakXw)}</span> },
    { key: 'tw', label: '당시 배풍', align: 'right', mono: true, render: (e) => kt(e.peakTw) },
    { key: 'rwy', label: '활주로', mono: true, render: (e) => e.peakRwy },
    { key: 'wind', label: '당시 바람', mono: true, render: (e) => e.peakWind },
    { key: 'at', label: '최대 시각', mono: true, render: (e) => fmtDayHM(recs[e.peakIndex].ts) },
  ];

  const twCols: Column<TwEvent>[] = [
    { key: 'start', label: '시작', mono: true, render: (e) => fmtDT(e.startTs) },
    { key: 'end', label: '종료', mono: true, render: (e) => (e.n > 1 ? fmtDT(e.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (e) => (e.n > 1 ? `${fmtDur(e.durMs)} (${e.n}건)` : '단발 (1건)') },
    { key: 'peak', label: '최대 배풍', align: 'right', mono: true, render: (e) => <span style={{ color: C_WARN, fontWeight: 700 }}>{kt(e.peakTw)}</span> },
    { key: 'xw', label: '당시 측풍', align: 'right', mono: true, render: (e) => kt(e.peakXw) },
    { key: 'rwy', label: '활주로', mono: true, render: (e) => e.peakRwy },
    { key: 'wind', label: '당시 바람', mono: true, render: (e) => e.peakWind },
    { key: 'at', label: '최대 시각', mono: true, render: (e) => fmtDayHM(recs[e.peakIndex].ts) },
  ];

  const rwyCols: Column<RwyXwSummary>[] = [
    { key: 'rwy', label: '활주로', render: (r) => <b>{r.rwy}</b> },
    { key: 'n', label: '전문', align: 'right', mono: true, render: (r) => `${r.n.toLocaleString()}건 (${r.pct}%)` },
    { key: 'meanXw', label: '평균 측풍', align: 'right', mono: true, render: (r) => kt(r.meanXw) },
    { key: 'maxXw', label: '최대 측풍', align: 'right', mono: true, render: (r) => (r.n ? <span style={{ color: r.maxXw > xwLimit ? C_OVER : undefined, fontWeight: 700 }}>{kt(r.maxXw)}</span> : '—') },
    { key: 'exceed', label: '한계 초과', align: 'right', mono: true, render: (r) => <span style={{ color: r.exceed > 0 ? C_WARN : undefined }}>{r.n ? `${r.exceed}건 (${r.n ? Math.round((r.exceed / r.n) * 100) : 0}%)` : '—'}</span> },
    { key: 'meanTw', label: '평균 배풍', align: 'right', mono: true, render: (r) => kt(r.meanTw) },
    { key: 'maxTw', label: '최대 배풍', align: 'right', mono: true, render: (r) => kt(r.maxTw) },
    { key: 'twOver', label: `배풍 >${d.twLimit}KT`, align: 'right', mono: true, render: (r) => (r.n ? `${r.twOver}건` : '—') },
  ];

  const maxRec = d.maxXwIndex >= 0 ? recs[d.maxXwIndex] : null;
  const maxTwRec = d.maxTwIndex >= 0 ? recs[d.maxTwIndex] : null;

  return (
    <>
      <StatTiles
        tiles={[
          { label: '최대 측풍', value: kt(d.maxXw), sub: maxRec ? `${fmtDayHM(maxRec.ts)} · RWY ${rwyShort(maxRec.rwy)}` : undefined, accent: true },
          { label: `한계 초과 (>${xwLimit}KT)`, value: `${d.exceedCount.toLocaleString()}건`, sub: `전문의 ${d.exceedPct}%`, color: d.exceedCount > 0 ? C_WARN : undefined },
          { label: '초과 구간', value: `${d.events.length}회`, sub: d.events.length ? `총 ${fmtDur(d.eventsTotalMs)}` : '초과 없음' },
          { label: '최대 배풍', value: kt(d.maxTw), sub: maxTwRec && d.maxTw > 0 ? `${fmtDayHM(maxTwRec.ts)} · RWY ${rwyShort(maxTwRec.rwy)}` : '배풍 성분 없음' },
          { label: `배풍 >${d.twLimit}KT`, value: `${d.twOverCount.toLocaleString()}건`, sub: `전문의 ${d.twOverPct}%`, color: d.twOverCount > 0 ? C_WARN : undefined },
          { label: '평균 측풍', value: kt(d.avgXw), sub: `평균 배풍 ${kt(d.avgTw)} · 마지막 측풍 ${kt(d.lastXw)}` },
        ]}
      />

      <Section
        title="측풍 / 배풍 추이"
        sub={`KT · 해상도 ${UNIT_LABEL[d.unit]}${d.unit !== 'raw' ? ' (구간 최대)' : ''}`}
        right={
          <>
            <Legend color={C_XW} label="측풍" />
            <Legend color={C_TW} label="배풍" />
            <Legend kind="dash" label={`한계 ${xwLimit}KT`} />
            <Legend kind="sq" color={BAND_LEGEND} label="초과 구간" />
          </>
        }
      >
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={[
            { name: '측풍', color: C_XW, values: d.xwValues, area: true, format: (v) => fmtNum(v) },
            { name: '배풍', color: C_TW, values: d.twValues, width: 1.5, format: (v) => fmtNum(v) },
          ]}
          thresholds={[
            { y: xwLimit, color: C_LIMIT, label: `한계 ${xwLimit}KT` },
            { y: d.twLimit, color: C_TW },
          ]}
          yBands={[{ from: xwLimit, to: 1e6, color: YBAND }]}
          bands={d.events.map((e) => ({ from: e.startTs, to: e.bandTo, color: BAND }))}
          yMin={0}
          unit=" KT"
          height={260}
          onPointClick={openBucket}
          tooltip={(i) => {
            const b = d.buckets[i];
            const xw = d.xwValues[i];
            const tw = d.twValues[i];
            const pk = d.xwPeakIdx[i];
            const pr = pk != null ? recs[pk] : undefined;
            return (
              <>
                <div className="tchart__tip-row">
                  <span className="tchart__tip-sw" style={{ background: C_XW }} />
                  <span className="tchart__tip-name">측풍</span>
                  <span className="tchart__tip-val" style={xw != null && xw > xwLimit ? { color: C_OVER } : undefined}>
                    {kt(xw)}
                  </span>
                </div>
                <div className="tchart__tip-row">
                  <span className="tchart__tip-sw" style={{ background: C_TW }} />
                  <span className="tchart__tip-name">배풍</span>
                  <span className="tchart__tip-val">{kt(tw)}</span>
                </div>
                {b && (
                  <div className="tchart__tip-note">
                    {!pr ? '전문 없음' : d.unit === 'raw' ? `RWY ${pr.rwy} · ${pr.wind}` : `${b.recs.length}건 · 구간 최대 ${fmtHM(pr.ts)} RWY ${rwyShort(pr.rwy)} · ${pr.wind}`}
                  </div>
                )}
              </>
            );
          }}
        />
        <span className="dsection__note">
          사용 활주로(진방위 315°/135°) 기준 바람 성분. 붉은 띠는 측풍 한계 초과 구간, 회색 점선은 배풍 기준 {d.twLimit}KT. 점을 클릭하면 해당 시각 원문을 엽니다{d.unit !== 'raw' ? ' (집계 구간의 최대 측풍 전문)' : ''}.
        </span>
      </Section>

      <div className="dgrid-2">
        <Section title={d.dailyUnit === 'day' ? '일별 최대 측풍' : '시간별 최대 측풍'} sub={`KT · 한계 초과 ${d.dailyUnit === 'day' ? '일' : '시간'}은 붉게 · 클릭 → 최대 측풍 원문`} right={<Legend kind="dash" label={`한계 ${xwLimit}KT`} />}>
          <BarChart
            items={d.daily.map((x) => ({
              label: x.label,
              value: x.maxXw ?? 0,
              color: x.exceed > 0 ? C_OVER : 'rgba(127,13,0,0.72)',
              title: d.dailyUnit === 'day' ? x.label : `${x.label}:00Z`,
              note: x.n ? `평균 ${fmtNum(x.meanXw ?? NaN)} KT · 최대 배풍 ${fmtNum(x.maxTw ?? NaN)} KT · 초과 ${x.exceed}건 / ${x.n}건` : '전문 없음',
            }))}
            thresholds={[{ y: xwLimit, color: C_LIMIT }]}
            unit=" KT"
            height={210}
            yMin={0}
            labelEvery={d.dailyUnit === 'hour' && d.daily.length > 12 ? 3 : undefined}
            onBarClick={(i) => {
              const idx = d.daily[i]?.peakIndex;
              if (idx != null) onOpenRaw(idx);
            }}
          />
        </Section>
        <Section title="시간대별 평균 측풍" sub="UTC 시각별 평균 · 붉을수록 한계 초과 많은 시간대">
          <BarChart
            items={d.hourMeanXw.map((v, h) => ({
              label: HOUR_LABELS[h],
              value: v ?? 0,
              color: d.hourExceed[h] > 0 ? withAlpha(C_OVER, 0.4 + 0.55 * (d.hourExceed[h] / (d.hourExceedMax || 1))) : 'rgba(127,13,0,0.55)',
              title: `${HOUR_LABELS[h]}:00Z`,
              note: d.hourN[h] ? `최대 ${fmtNum(d.hourMaxXw[h] ?? NaN)} KT · 한계 초과 ${d.hourExceed[h]}건 / ${d.hourN[h]}건` : '전문 없음',
            }))}
            unit=" KT"
            height={210}
            yMin={0}
            labelEvery={3}
          />
        </Section>
      </div>

      <Section title="한계 초과 이벤트" sub={`측풍 > ${xwLimit}KT 연속 구간 병합 · 클릭 → 최대 측풍 시각 원문`}>
        <DetailTable columns={evCols} rows={d.events} rowKey={(e) => e.start} onRowClick={(e) => onOpenRaw(e.peakIndex)} emptyText={`기간 내 측풍 한계(${xwLimit}KT) 초과가 없습니다.`} />
      </Section>

      <Section title="활주로별 측풍 / 배풍" sub="사용 활주로 기준 요약 · 클릭 → 최대 측풍 원문">
        <DetailTable columns={rwyCols} rows={d.byRwy.filter((r) => r.n > 0)} rowKey={(r) => r.rwy} onRowClick={(r) => r.maxXwIndex >= 0 && onOpenRaw(r.maxXwIndex)} emptyText="데이터가 없습니다." />
        <span className="dsection__note">
          한계 초과 = 측풍 &gt; {xwLimit}KT (통계 카드와 동일 기준), 배풍 기준 {d.twLimit}KT. 성분은 풍향·풍속과 사용 활주로 진방위로 계산하며, 지속시간은 구간 첫 전문 ~ 마지막 전문 시각 차(단발은 1건).
        </span>
      </Section>

      <Section title={`배풍 >${d.twLimit}KT 구간`} sub="연속 구간 병합 · 클릭 → 최대 배풍 시각 원문">
        <DetailTable columns={twCols} rows={d.twEvents} rowKey={(e) => e.start} onRowClick={(e) => onOpenRaw(e.peakIndex)} maxRows={100} maxHeight={260} emptyText={`기간 내 배풍 ${d.twLimit}KT 초과가 없습니다.`} />
      </Section>
    </>
  );
}
