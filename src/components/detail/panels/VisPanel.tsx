import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur, fmtHM, UNIT_LABEL } from '../../../data/detail/agg';
import { computeVisDetail, DAWN_HOURS, DAWN_PATTERN_PCT, fmtVis, GRADE_UNIT_LABEL, LOW_VIS_KM, VIS_GRADE_COLOR, VIS_GRADE_LABEL, VIS_TH_1, VIS_TH_5, type TsReport, type VisRun } from '../../../data/detail/vis';
import { BarChart, HOUR_LABELS, TimeSeriesChart } from '../charts';
import { DetailTable, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_VIS = '#c8871c';
const C_AMBER = '#b8770a';
const C_DANGER = '#c8422e';
const C_TS_BAND = 'rgba(200,66,46,0.16)';
const C_HOUR_LABEL = HOUR_LABELS.map((h) => `${h}:00Z`);

/** 시정 값 색 — 등급이 낮을수록 진하게 */
const visColor = (v: number) => (v < VIS_TH_1 ? C_DANGER : v < VIS_TH_5 ? C_VIS : v < LOW_VIS_KM ? C_AMBER : undefined);

/** 시정 / 특이기상 상세 — 추이 · 등급 구성 · 시간대별 저하 · 저시정 이벤트 · TS 보고 */
export function VisPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeVisDetail(recs, win), [recs, win]);
  const openBucket = (i: number) => {
    const b = d.buckets[i];
    if (!b || !b.recs.length) return;
    // 집계 버킷이면 최저 시정 전문을, 원본이면 그 전문을 연다
    let best = 0;
    b.recs.forEach((r, k) => {
      if (r.vis < b.recs[best].vis) best = k;
    });
    onOpenRaw(b.idx[best]);
  };

  const tip = (i: number) => {
    const b = d.buckets[i];
    if (!b || !b.recs.length) return <div className="tchart__tip-row">전문 없음</div>;
    if (d.unit === 'raw') {
      const r = b.recs[0];
      return (
        <>
          <Row name="시정" val={fmtVis(r.vis)} color={C_VIS} />
          <Row name="태그" val={r.tags.length ? r.tags.join(' ') : '—'} />
          <Row name="구름" val={r.cloud} />
          <Row name="바람" val={r.wind} />
        </>
      );
    }
    let mn = Infinity;
    let low = 0;
    const tags: string[] = [];
    b.recs.forEach((r) => {
      if (r.vis < mn) mn = r.vis;
      if (r.vis < LOW_VIS_KM) low++;
      r.tags.forEach((t) => {
        if (!tags.includes(t)) tags.push(t);
      });
    });
    return (
      <>
        <Row name="최저 시정" val={fmtVis(mn)} color={C_VIS} />
        <Row name="시정 저하" val={`${low}/${b.recs.length}건`} />
        <Row name="태그" val={tags.length ? tags.join(' ') : '—'} />
      </>
    );
  };

  const runCols: Column<VisRun>[] = [
    { key: 'start', label: '시작', mono: true, render: (r) => fmtDT(r.startTs) },
    { key: 'end', label: '종료', mono: true, render: (r) => (r.n > 1 ? fmtDayHM(r.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (r) => (r.n > 1 ? fmtDur(r.durMs) : `1건`) },
    {
      key: 'min',
      label: '최저 시정',
      align: 'right',
      mono: true,
      render: (r) => (
        <span style={{ color: visColor(r.minVis), fontWeight: 700 }}>
          {fmtVis(r.minVis)}
          <span style={{ fontWeight: 400, opacity: 0.7 }}> {fmtHM(r.minTs)}</span>
        </span>
      ),
    },
    { key: 'tags', label: '태그', mono: true, render: (r) => (r.tags.length ? r.tags.join(' ') : '—') },
    { key: 'cloud', label: '구름', mono: true, render: (r) => r.cloud },
    { key: 'n', label: '전문', align: 'right', mono: true, render: (r) => `${r.n}건` },
  ];

  const tsCols: Column<TsReport>[] = [
    { key: 'ts', label: '시각', mono: true, render: (r) => fmtDT(r.ts) },
    { key: 'letter', label: 'INFO', mono: true, align: 'center', render: (r) => r.letter },
    { key: 'wind', label: '바람', mono: true, render: (r) => r.wind },
    { key: 'vis', label: '시정', mono: true, align: 'right', render: (r) => <span style={{ color: visColor(r.vis) }}>{fmtVis(r.vis)}</span> },
    { key: 'cloud', label: '구름', mono: true, render: (r) => r.cloud },
    { key: 'tags', label: '태그', mono: true, render: (r) => r.tags.join(' ') },
  ];

  const gradeTitle = d.gradeUnit === 'hour' ? '시간별 시정 등급 구성' : d.gradeUnit === 'day' ? '일별 시정 등급 구성' : '주별 시정 등급 구성';
  const dawnLabel = `${HOUR_LABELS[DAWN_HOURS[0]]}–${HOUR_LABELS[DAWN_HOURS[1]]}Z`;
  // 시정 시계열: 점이 1개면 step 선이 보이지 않으므로 점 마커 시리즈를 겹친다
  const visSeries = [{ name: '시정', color: C_VIS, values: d.values, step: true, format: fmtVis }, ...(d.xs.length <= 2 ? [{ name: '시정·점', color: C_VIS, values: d.values, dots: true, hideTip: true }] : [])];

  return (
    <>
      <StatTiles
        tiles={[
          { label: '시정 저하', value: `${d.lowCount.toLocaleString()}건`, sub: `전체 ${d.total.toLocaleString()}건 중 ${d.lowPct}%`, accent: true },
          {
            label: '최저 시정',
            value: fmtVis(d.minVis),
            sub: d.lowCount ? fmtDayHM(d.minAt) : '시정 저하 없음',
            color: visColor(d.minVis),
          },
          {
            label: '저시정 구간',
            value: `${d.lowRuns.length}회`,
            sub: d.lowRuns.length ? `누적 ${fmtDur(d.lowRunTotalMs)}` : '—',
          },
          { label: 'TS 보고', value: `${d.tsCount}건`, color: d.tsCount ? C_AMBER : undefined, sub: d.tsCount ? `마지막 ${fmtDayHM(d.tsReports[d.tsReports.length - 1].ts)}` : '뇌전 보고 없음' },
          { label: '시정 <5KM', value: `${d.under5Count}건`, sub: `이 중 <1KM ${d.under1Count}건`, color: d.under5Count ? C_VIS : undefined },
          { label: '안개 (FG/BR)', value: `${d.fogCount}건`, sub: `FG ${d.fgCount}건 · BR ${d.brCount}건` },
          {
            label: '최장 저시정 구간',
            value: d.longestRun && d.longestRun.n > 1 ? fmtDur(d.longestRun.durMs) : d.longestRun ? '1건' : '—',
            sub: d.longestRun ? `${fmtDayHM(d.longestRun.startTs)} 시작` : undefined,
          },
        ]}
      />

      <Section
        title="시정 추이"
        sub={`KM · 해상도 ${UNIT_LABEL[d.unit]}${d.unit !== 'raw' ? ' (구간 최저값)' : ''}`}
        right={
          <>
            <Legend color={C_VIS} label="시정" />
            <Legend kind="dash" label={`한계 ${VIS_TH_5}KM / ${VIS_TH_1}KM`} />
            <Legend kind="sq" color={C_TS_BAND} label="TS 보고 구간" />
          </>
        }
      >
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={visSeries}
          thresholds={[
            { y: VIS_TH_5, color: C_AMBER, label: `${VIS_TH_5}KM` },
            { y: VIS_TH_1, color: C_DANGER, label: `${VIS_TH_1}KM` },
          ]}
          bands={d.tsBands.map((b) => ({ ...b, color: C_TS_BAND, label: 'TS' }))}
          yMin={0}
          yMax={11}
          yFormat={(v) => String(v)}
          unit=" KM"
          height={240}
          tooltip={tip}
          onPointClick={openBucket}
        />
        <span className="dsection__note">10KM는 "10KM 이상"을 뜻합니다. 점을 클릭하면 해당 시각 원문을 엽니다{d.unit !== 'raw' ? ' (집계 구간의 최저 시정 전문)' : ''}.</span>
      </Section>

      <div className="dgrid-2">
        <Section
          title={gradeTitle}
          sub={`해상도 ${GRADE_UNIT_LABEL[d.gradeUnit]}`}
          right={
            <>
              {VIS_GRADE_LABEL.map((l, g) => (
                <Legend key={l} kind="sq" color={VIS_GRADE_COLOR[g]} label={l} />
              ))}
            </>
          }
        >
          <BarChart
            items={d.gradeBuckets.map((b) => ({
              label: b.label,
              title: b.title,
              stack: b.counts.map((c, g) => ({ name: VIS_GRADE_LABEL[g], value: c, color: VIS_GRADE_COLOR[g] })),
              note: b.n ? `${b.n}건 · 시정 저하 ${b.counts[1] + b.counts[2] + b.counts[3]}건` : '전문 없음',
            }))}
            unit="건"
            height={200}
            yMax={d.gradeYMax}
            yFormat={(v) => String(Math.round(v))}
            onBarClick={(i) => {
              const idx = d.gradeBuckets[i]?.minIdx;
              if (idx != null) onOpenRaw(idx);
            }}
          />
          <span className="dsection__note">막대를 클릭하면 구간 내 최저 시정 전문을 엽니다.</span>
        </Section>
        <Section
          title="시간대별 시정 저하"
          sub="UTC · <10KM 건수"
          right={
            <>
              {[1, 2, 3].map((g) => (
                <Legend key={g} kind="sq" color={VIS_GRADE_COLOR[g]} label={VIS_GRADE_LABEL[g]} />
              ))}
            </>
          }
        >
          <BarChart
            items={d.hourLow.map((s, h) => ({
              label: HOUR_LABELS[h],
              title: C_HOUR_LABEL[h],
              stack: s.map((c, k) => ({ name: VIS_GRADE_LABEL[k + 1], value: c, color: VIS_GRADE_COLOR[k + 1] })),
              note: `시정 저하 ${d.hourLowTotal[h]}건`,
            }))}
            unit="건"
            height={200}
            labelEvery={3}
            yMax={d.hourYMax}
            yFormat={(v) => String(Math.round(v))}
          />
          <span className="dsection__note">
            {d.peakHour != null ? (
              <>
                시정 저하 최다 시간대 <b>{HOUR_LABELS[d.peakHour]}Z</b> ({d.peakHourCount}건)
                {d.dawnPct >= DAWN_PATTERN_PCT ? ` — 새벽 ${dawnLabel}에 저하의 ${d.dawnPct}% 집중 (안개 패턴)` : ` · 새벽 ${dawnLabel} 비중 ${d.dawnPct}%`}
              </>
            ) : (
              '기간 내 시정 저하 전문이 없습니다.'
            )}
          </span>
        </Section>
      </div>

      <Section title="저시정 이벤트" sub={`시정 <${LOW_VIS_KM}KM 연속 구간 ${d.lowRuns.length}회 · 클릭 → 최저 시정 원문`}>
        <DetailTable columns={runCols} rows={d.lowRuns} rowKey={(r) => r.start} onRowClick={(r) => onOpenRaw(r.minIdx)} emptyText="기간 내 저시정 이벤트가 없습니다." />
      </Section>
      <Section title="TS 보고" sub={`뇌전(TS) 태그 전문 ${d.tsCount}건 · 클릭 → 원문`}>
        <DetailTable columns={tsCols} rows={d.tsReports} rowKey={(r) => r.index} onRowClick={(r) => onOpenRaw(r.index)} maxHeight={280} emptyText="기간 내 TS 보고가 없습니다." />
      </Section>

      <span className="dsection__note">
        시정 저하 = 시정 {LOW_VIS_KM}KM 미만 (통계 카드와 동일) · 등급 ≥10 / 5–&lt;10 / 1–&lt;5 / &lt;1 KM · 지속 시간 = 구간 첫 전문 ~ 마지막 전문 시각 차 (한 건이면 표시 안 함) · TS = 전문 태그 'TS', 안개 = FG/BR 태그 ·
        시각은 UTC(Z)
      </span>
    </>
  );
}

function Row({ name, val, color }: { name: string; val: string; color?: string }) {
  return (
    <div className="tchart__tip-row">
      {color ? <span className="tchart__tip-sw" style={{ background: color }} /> : <span className="tchart__tip-sw" style={{ background: 'transparent' }} />}
      <span className="tchart__tip-name">{name}</span>
      <span className="tchart__tip-val">{val}</span>
    </div>
  );
}
