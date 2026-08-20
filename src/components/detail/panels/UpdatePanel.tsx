import { useMemo } from 'react';
import { fmtDay, fmtDayHM, fmtDT, fmtDur, fmtHM, fmtNum, UNIT_LABEL } from '../../../data/detail/agg';
import { computeUpdateDetail, GAP_MIN, REGULAR_PER_HOUR, type AdhocItem, type GapItem } from '../../../data/detail/update';
import { BarChart, HOUR_LABELS } from '../charts';
import { DetailTable, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

/* 카드(정보문자 갱신 빈도)와 동일 색: 정기 rgba(127,13,0,0.4), 임시 #b4451c */
const C_REG = 'rgba(127,13,0,0.4)';
const C_ADHOC = '#b4451c';
const C_GAP = '#b8770a';
const C_INT = 'rgba(127,13,0,0.6)';

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 건수 축 눈금 — 정수만 표기 (0.5 단위 눈금은 선만 남기고 라벨 생략). 막대 값·툴팁은 정수라 영향 없음 */
const intTick = (v: number) => (Number.isInteger(v) ? String(v) : '');
/** "08-08 12:00–12:30Z" (같은 날) / "08-08 23:30Z – 08-09 01:00Z" */
const gapLabel = (g: GapItem) => (fmtDay(g.fromTs) === fmtDay(g.toTs) ? `${fmtDayHM(g.fromTs).replace('Z', '')}–${fmtHM(g.toTs)}` : `${fmtDayHM(g.fromTs)} – ${fmtDayHM(g.toTs)}`);

/** 정보문자 갱신 빈도 상세 — 발행 건수 추이 · 시간대별 일평균 · 간격 분포 · 임시 갱신/공백 목록 */
export function UpdatePanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeUpdateDetail(recs, win), [recs, win]);
  const openBucket = (i: number) => {
    const idx = d.items[i]?.firstIdx;
    if (idx != null) onOpenRaw(idx);
  };

  const adhocCols: Column<AdhocItem>[] = [
    { key: 'ts', label: '시각', mono: true, width: 150, render: (a) => fmtDT(a.ts) },
    { key: 'letter', label: '레터', mono: true, align: 'center', width: 50, render: (a) => <b>{a.letter}</b> },
    { key: 'gap', label: '직전 간격', align: 'right', mono: true, width: 80, render: (a) => (a.gapMin == null ? '—' : `${fmtNum(a.gapMin, 0)}분`) },
    {
      key: 'chg',
      label: '직전 대비 변경 내용 (추정)',
      render: (a) => (
        <span style={{ whiteSpace: 'normal', display: 'inline-flex', flexWrap: 'wrap', gap: '4px 10px' }}>
          {a.changes.map((c, i) => (
            <span key={i} style={{ fontWeight: /^활주로|^기상|^공지/.test(c) ? 700 : 500, color: /^활주로/.test(c) ? '#7f0d00' : undefined }}>
              {c}
            </span>
          ))}
        </span>
      ),
    },
  ];

  const gapCols: Column<GapItem>[] = [
    { key: 'from', label: '공백 시작 (마지막 전문)', mono: true, render: (g) => fmtDT(g.fromTs) },
    { key: 'to', label: '공백 종료 (다음 전문)', mono: true, render: (g) => fmtDT(g.toTs) },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (g) => <span style={{ color: C_GAP, fontWeight: 700 }}>{fmtDur(g.durMs)}</span> },
    { key: 'letters', label: '레터', mono: true, align: 'center', render: (g) => `${g.fromLetter} → ${g.toLetter}` },
  ];

  const hasInterval = Number.isFinite(d.meanInterval);
  const totalIntervals = d.intervalBins.reduce((a, b) => a + b.count, 0);

  return (
    <>
      <StatTiles
        tiles={[
          { label: '총 발행 건수', value: `${d.n.toLocaleString()}건`, sub: `정기 ${d.regularN.toLocaleString()} · 임시 ${d.adhocN.toLocaleString()}`, accent: true },
          { label: '일평균 건수', value: `${fmtNum(d.perDay)}건`, sub: `${fmtNum(d.days)}일 기준` },
          { label: '평균 발행 간격', value: hasInterval ? `${fmtNum(d.meanInterval)}분` : '—', sub: hasInterval ? `연속 전문 ${(d.n - 1).toLocaleString()}쌍` : '전문 1건' },
          { label: '중앙값 간격', value: hasInterval ? `${fmtNum(d.medianInterval)}분` : '—' },
          { label: '임시 갱신', value: `${d.adhocN.toLocaleString()}건`, sub: `전체의 ${d.adhocPct}%`, color: d.adhocN > 0 ? C_ADHOC : undefined },
          { label: '최다 발행 시간대', value: `${pad2(d.peakHour)}Z`, sub: `일평균 ${fmtNum(d.peakHourAvg)}회 · 총 ${d.peakHourCount}건` },
          {
            label: '최장 공백',
            value: d.maxGap ? fmtDur(d.maxGap.durMs) : '—',
            sub: d.maxGap ? gapLabel(d.maxGap) : undefined,
            color: d.maxGap && d.maxGap.durMs >= GAP_MIN * 60000 ? C_GAP : undefined,
          },
        ]}
      />

      <Section
        title="발행 건수 추이"
        sub={`${d.unit === 'day' ? '일별' : '시간당'} 건수 · 해상도 ${UNIT_LABEL[d.unit]}`}
        right={
          <>
            <Legend kind="sq" color={C_REG} label="정기 발행 (:00 정각)" />
            <Legend kind="sq" color={C_ADHOC} label="임시 갱신" />
          </>
        }
      >
        <BarChart
          items={d.items.map((it) => ({
            label: it.label,
            title: it.title,
            stack: [
              { name: '정기', value: it.regular, color: C_REG },
              { name: '임시', value: it.adhoc, color: C_ADHOC },
            ],
            note: `총 ${it.regular + it.adhoc}건`,
          }))}
          unit="건"
          yMax={d.yMax}
          yFormat={intTick}
          height={240}
          labelEvery={d.labelEvery}
          onBarClick={openBucket}
        />
        <span className="dsection__note">막대를 클릭하면 해당 구간의 첫 전문 원문을 엽니다. 창 양끝 구간은 부분 집계일 수 있습니다.</span>
      </Section>

      <div className="dgrid-2">
        <Section title="시간대별 발행 횟수" sub={`UTC 시각별 일평균 (${fmtNum(d.days)}일)`} right={<Legend kind="dash" label={`정기 ${REGULAR_PER_HOUR}회/시`} />}>
          <BarChart
            items={d.hourly.map((h) => ({
              label: HOUR_LABELS[h.hour],
              title: `${HOUR_LABELS[h.hour]}:00Z – ${pad2((h.hour + 1) % 24)}:00Z`,
              stack: [
                { name: '정기', value: h.regularAvg, color: C_REG },
                { name: '임시', value: h.adhocAvg, color: C_ADHOC },
              ],
              note: `총 ${h.regular + h.adhoc}건 (정기 ${h.regular} · 임시 ${h.adhoc})`,
            }))}
            unit="회/일"
            yMax={d.hourYMax}
            yFormat={(v) => fmtNum(v)}
            thresholds={[{ y: REGULAR_PER_HOUR }]}
            height={200}
            labelEvery={3}
          />
        </Section>
        <Section title="발행 간격 분포" sub={`연속 전문 간 간격(분) · ${totalIntervals.toLocaleString()}쌍`}>
          <BarChart
            items={d.intervalBins.map((b) => ({
              label: b.label,
              title: b.title,
              value: b.count,
              color: b.gap ? C_GAP : C_INT,
              note: totalIntervals ? `전체의 ${Math.round((b.count / totalIntervals) * 100)}%` : undefined,
            }))}
            unit="건"
            yMax={d.binYMax}
            yFormat={intTick}
            height={200}
            showValues
          />
        </Section>
      </div>

      <Section title="임시 갱신 목록" sub={`정기(:00 정각) 외 시각에 발행된 전문 ${d.adhocN.toLocaleString()}건 · 클릭 → 원문`}>
        <DetailTable columns={adhocCols} rows={d.adhocs} rowKey={(a) => a.index} onRowClick={(a) => onOpenRaw(a.index)} emptyText="기간 내 임시 갱신이 없습니다." />
      </Section>

      <Section title="발행 공백" sub={`발행 간격 ≥ ${GAP_MIN}분 · 클릭 → 공백 이후 첫 전문`}>
        <DetailTable columns={gapCols} rows={d.gaps} rowKey={(g) => g.index} onRowClick={(g) => onOpenRaw(g.index)} emptyText={`기간 내 ${GAP_MIN}분 이상 공백이 없습니다.`} />
        <span className="dsection__note">
          정기 발행 = 발행 분이 :00(매시 정각)인 전문, 임시 갱신 = 그 외 시각의 전문(상태 변화 시 발행). 발행 간격 = 연속 전문의 발행 시각 차(정상 ≈ 60분), 공백 = 간격 ≥ {GAP_MIN}분(정기 발행 누락). 시간대별 일평균의 일수는 첫~마지막 전문 시각 차(최소 1일)로 통계 카드와 같은 정의이며, 변경 내용은 직전 전문과의 활주로 배치(ARR/DEP)·구름·현재기상·시정·활주로 상태 보고·운영 공지·바람 비교로 추정한 값입니다.
        </span>
      </Section>
    </>
  );
}
