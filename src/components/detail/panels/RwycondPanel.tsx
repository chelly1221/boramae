import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur, UNIT_LABEL } from '../../../data/detail/agg';
import { computeRwycondDetail, condBucketTitle, countAxisMax, RWYCC_CAUTION, RWYCC_DANGER, type BrakingRow, type CondReportRow, type CondRun, type RwyRow } from '../../../data/detail/rwycond';
import { BRAKING_LABEL, brakingRank, rwyccColor } from '../../../data/stats';
import { BarChart, HOUR_LABELS, TimeSeriesChart } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_CODE = '#6b8cae';
const C_CAUTION = '#b8770a';
const C_DANGER = '#c8422e';
const intFmt = (v: number) => String(Math.round(v));

/** RWYCC 코드 배지 — "5/5/5" 각 자리를 등급색으로 */
function Codes({ codes }: { codes: number[] | null }) {
  if (!codes) return <span style={{ color: 'var(--ink-muted-45)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
      {codes.map((c, i) => (
        <span key={i} style={{ color: rwyccColor(c) }}>
          {c}
          {i < codes.length - 1 ? <span style={{ color: 'var(--ink-muted-45)' }}>/</span> : null}
        </span>
      ))}
    </span>
  );
}

/** 제동작용 등급 색 (나쁜 순 진하게) */
const brakingColor = (g: string) => {
  const r = brakingRank(g);
  return r === 0 ? '#7f0d00' : r === 1 ? C_DANGER : r === 2 ? '#e08a35' : r === 3 ? '#d9b83a' : r === 4 ? '#8fb84e' : '#8c7a6e';
};
const brakingLabel = (g: string) => BRAKING_LABEL[g.toUpperCase()] ?? g;

/** 활주로 표면 상태 상세 — RWYCC 추이 · 활주로별/오염 상태/제동작용 분포 · 보고 구간 · 보고 목록 */
export function RwycondPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeRwycondDetail(recs, win), [recs, win]);
  const has = d.reportN > 0;
  const hasCodes = d.minCode != null;

  const rwyCols: Column<RwyRow>[] = [
    { key: 'rwy', label: '활주로', mono: true, render: (r) => (r.rwy === '미상' ? '미상' : `RWY${r.rwy}`) },
    { key: 'n', label: '보고', align: 'right', mono: true, render: (r) => `${r.n}건` },
    { key: 'min', label: '최저 RWYCC', align: 'right', render: (r) => (r.minCode != null ? <Codes codes={[r.minCode]} /> : '—') },
    { key: 'ba', label: '제동작용 보고', align: 'right', mono: true, render: (r) => `${r.brakingN}건` },
  ];
  const brakeCols: Column<BrakingRow>[] = [
    { key: 'g', label: '등급', render: (b) => <b style={{ color: brakingColor(b.grade) }}>{b.grade}</b> },
    { key: 'l', label: '설명', render: (b) => brakingLabel(b.grade) },
    { key: 'n', label: '보고', align: 'right', mono: true, render: (b) => `${b.n}건` },
    { key: 'by', label: '보고 기체', mono: true, render: (b) => b.by.join(', ') || '—' },
  ];
  const runCols: Column<CondRun>[] = [
    { key: 'start', label: '시작', mono: true, render: (r) => fmtDT(r.startTs) },
    { key: 'end', label: '종료', mono: true, render: (r) => (r.n > 1 ? fmtDT(r.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (r) => (r.n > 1 ? `${fmtDur(r.durMs)} · ${r.n}건` : '단발 (1건)') },
    { key: 'rwys', label: '활주로', mono: true, render: (r) => r.rwys.map((x) => `RWY${x}`).join(' ') || '—' },
    { key: 'min', label: '구간 최저 RWYCC', align: 'right', render: (r) => (r.minCode != null ? <Codes codes={[r.minCode]} /> : '—') },
    { key: 'ba', label: '최악 제동작용', render: (r) => (r.worstBraking ? <span style={{ color: brakingColor(r.worstBraking), fontWeight: 700 }}>{r.worstBraking}</span> : '—') },
  ];
  const repCols: Column<CondReportRow>[] = [
    { key: 'time', label: '시각', mono: true, render: (r) => fmtDT(r.ts) },
    { key: 'info', label: 'INFO', mono: true, render: (r) => r.letter },
    { key: 'rwy', label: '활주로', mono: true, render: (r) => (r.cond.rwy ? `RWY${r.cond.rwy}` : '—') },
    { key: 'at', label: '보고 시각', mono: true, render: (r) => (r.cond.at ? `${r.cond.at}Z` : '—') },
    { key: 'codes', label: 'RWYCC', render: (r) => <Codes codes={r.cond.codes} /> },
    { key: 'note', label: '비고', mono: true, render: (r) => r.cond.note || '—' },
    { key: 'parts', label: '구간 상태', render: (r) => (r.cond.parts.length ? <span style={{ fontSize: 11.5 }}>{r.cond.parts.join(' · ')}</span> : '—') },
    { key: 'ba', label: '제동작용', render: (r) => (r.cond.braking ? <span style={{ color: brakingColor(r.cond.braking), fontWeight: 700 }}>{r.cond.braking}</span> : '—') },
    { key: 'by', label: '보고 기체', mono: true, render: (r) => r.cond.reportedBy ?? '—' },
    { key: 'extra', label: '기타', render: (r) => (r.cond.extra.length ? <span style={{ fontSize: 11.5 }}>{r.cond.extra.join(' · ')}</span> : '—') },
  ];

  return (
    <>
      <StatTiles
        tiles={[
          { label: '상태 보고 전문', value: `${d.reportN.toLocaleString()}건`, sub: `전문 ${d.n.toLocaleString()}건 중 ${d.reportPct}% · 보고 ${d.totalReports.toLocaleString()}건`, accent: true },
          {
            label: '최저 RWYCC',
            value: d.minCode != null ? String(d.minCode) : '—',
            sub: d.minCode != null ? `${d.minCodeRwy ? `RWY${d.minCodeRwy} · ` : ''}${d.minCodeTs != null ? fmtDayHM(d.minCodeTs) : ''}` : '코드 보고 없음',
            color: d.minCode != null ? rwyccColor(d.minCode) : undefined,
          },
          {
            label: '제동작용 보고',
            value: `${d.brakingN}건`,
            sub: d.worstBraking ? `최악 ${d.worstBraking} (${brakingLabel(d.worstBraking)})` : '제동작용 보고 없음',
            color: d.worstBraking ? brakingColor(d.worstBraking) : undefined,
          },
          { label: '보고 구간', value: `${d.runs.length}회`, sub: d.longestRun ? `최장 ${d.longestRun.n > 1 ? fmtDur(d.longestRun.durMs) : '단발'} · ${fmtDayHM(d.longestRun.startTs)}~` : undefined },
          { label: '마지막 보고', value: d.last ? fmtDayHM(d.last.ts) : '—', sub: d.last ? `INFO ${d.last.letter}${d.last.cond.rwy ? ` · RWY${d.last.cond.rwy}` : ''}${d.last.cond.codes ? ` · ${d.last.cond.codes.join('/')}` : ''}` : '기간 내 상태 보고 없음' },
        ]}
      />

      <Section
        title="RWYCC 추이"
        sub={`해상도 ${UNIT_LABEL[d.unit]} · 구간 최저 코드 · 점 클릭 → 원문`}
        right={
          <>
            <Legend color={C_CODE} label="최저 RWYCC" />
            <Legend kind="dash" color={C_CAUTION} label={`주의 ≤${RWYCC_CAUTION}`} />
            <Legend kind="dash" color={C_DANGER} label={`위험 ≤${RWYCC_DANGER}`} />
          </>
        }
      >
        {hasCodes ? (
          <>
            <TimeSeriesChart
              xs={d.xs}
              xDomain={[win.from, win.to]}
              series={[
                { name: '최저 RWYCC', color: C_CODE, values: d.values, step: true, width: 2, format: intFmt },
                { name: '단발', color: C_CODE, values: d.isolated, dots: true, hideTip: true },
              ]}
              yMin={0}
              yMax={6}
              yTicks={6}
              yFormat={intFmt}
              unit="RWYCC"
              height={220}
              thresholds={[
                { y: RWYCC_CAUTION, color: C_CAUTION, dash: true },
                { y: RWYCC_DANGER, color: C_DANGER, dash: true },
              ]}
              titleFormat={(ts) => condBucketTitle(ts, d.unit)}
              tooltip={(i) => {
                const t = d.tips[i];
                return (
                  <>
                    <div>{condBucketTitle(d.xs[i], d.unit)}</div>
                    {t.n ? (
                      <>
                        <div>
                          최저 RWYCC <b style={{ color: t.code != null ? rwyccColor(t.code) : undefined }}>{t.code ?? '—'}</b> · 보고 전문 {t.n}건
                        </div>
                        <div style={{ opacity: 0.75 }}>{t.summary}</div>
                      </>
                    ) : (
                      <div style={{ opacity: 0.7 }}>상태 보고 없음</div>
                    )}
                  </>
                );
              }}
              onPointClick={(i) => {
                const idx = d.tips[i]?.index;
                if (idx != null) onOpenRaw(idx);
              }}
            />
            <span className="dsection__note">RWYCC 6 = 건조, 5 = 젖음/약간의 오염, 3 이하 = 미끄러움 주의, 1 이하 = 결빙 수준. 보고가 없는 구간은 선이 끊깁니다.</span>
          </>
        ) : (
          <Empty>{has ? '기간 내 RWYCC 코드 보고가 없습니다 (제동작용·상태 문장만 보고됨).' : '기간 내 활주로 표면 상태 보고가 없습니다.'}</Empty>
        )}
      </Section>

      <div className="dgrid-2">
        <Section title="활주로별 보고" sub="보고 건수 · 최저 RWYCC · 클릭 → 마지막 보고 원문">
          {has ? (
            <>
              <div style={{ maxWidth: Math.max(240, d.byRwy.length * 80 + 60) }}>
                <BarChart
                  items={d.byRwy.map((r) => ({
                    label: r.rwy === '미상' ? '미상' : `RWY${r.rwy}`,
                    value: r.n,
                    color: r.minCode != null ? rwyccColor(r.minCode) : '#8c7a6e',
                    title: r.rwy === '미상' ? '활주로 미상' : `RWY${r.rwy}`,
                    note: `보고 ${r.n}건 · 최저 RWYCC ${r.minCode ?? '—'} · 제동작용 ${r.brakingN}건`,
                  }))}
                  yMax={countAxisMax(Math.max(...d.byRwy.map((r) => r.n)))}
                  yFormat={intFmt}
                  unit="건"
                  height={180}
                  showValues
                  onBarClick={(i) => {
                    const idx = d.byRwy[i]?.lastIdx;
                    if (idx != null) onOpenRaw(idx);
                  }}
                />
              </div>
              <DetailTable columns={rwyCols} rows={d.byRwy} rowKey={(r) => r.rwy} onRowClick={(r) => r.lastIdx != null && onOpenRaw(r.lastIdx)} maxHeight={200} />
            </>
          ) : (
            <Empty>기간 내 상태 보고 없음</Empty>
          )}
        </Section>
        <Section title="오염 상태 키워드" sub="보고 문장에 등장한 상태 · 전문 수 · 클릭 → 마지막 원문">
          {d.contam.length ? (
            <>
              <BarChart
                items={d.contam.map((c) => ({ label: c.key, value: c.n, color: C_CODE, title: `${c.key} · ${c.label}`, note: `${c.n}건` }))}
                yMax={countAxisMax(Math.max(...d.contam.map((c) => c.n)))}
                yFormat={intFmt}
                unit="건"
                height={180}
                showValues
                labelMinPx={60}
                onBarClick={(i) => {
                  const idx = d.contam[i]?.lastIdx;
                  if (idx != null) onOpenRaw(idx);
                }}
              />
              <span className="dsection__note">{d.contam.map((c) => `${c.key} ${c.label}`).join(' · ')}</span>
            </>
          ) : (
            <Empty>기간 내 오염 상태 문장 없음</Empty>
          )}
        </Section>
      </div>

      <div className="dgrid-2">
        <Section title="제동작용 보고" sub="등급별 건수 (나쁜 순) · 보고 기체">
          {d.braking.length ? (
            <>
              <div style={{ maxWidth: Math.max(240, d.braking.length * 96 + 60) }}>
                <BarChart
                  items={d.braking.map((b) => ({ label: b.grade, value: b.n, color: brakingColor(b.grade), title: `${b.grade} · ${brakingLabel(b.grade)}`, note: `${b.n}건 · ${b.by.join(', ') || '기체 미상'}` }))}
                  yMax={countAxisMax(Math.max(...d.braking.map((b) => b.n)))}
                  yFormat={intFmt}
                  unit="건"
                  height={170}
                  showValues
                  labelMinPx={80}
                  onBarClick={(i) => {
                    const idx = d.braking[i]?.lastIdx;
                    if (idx != null) onOpenRaw(idx);
                  }}
                />
              </div>
              <DetailTable columns={brakeCols} rows={d.braking} rowKey={(b) => b.grade} onRowClick={(b) => b.lastIdx != null && onOpenRaw(b.lastIdx)} maxHeight={200} />
            </>
          ) : (
            <Empty>기간 내 제동작용 보고 없음</Empty>
          )}
        </Section>
        <Section title="시간대별 상태 보고" sub="UTC 시각별 보고 전문 수">
          {has ? (
            <BarChart
              items={HOUR_LABELS.map((h, i) => ({ label: h, value: d.hourN[i], title: `${h}:00Z ~ ${h}:59Z`, note: `${d.hourN[i]}건` }))}
              yMax={countAxisMax(Math.max(...d.hourN))}
              yFormat={intFmt}
              unit="건"
              height={200}
              labelEvery={3}
              color={C_CODE}
            />
          ) : (
            <Empty>기간 내 상태 보고 없음</Empty>
          )}
        </Section>
      </div>

      <Section title="보고 구간" sub={`연속 보고 병합 (공백 3시간 초과 시 분리) · ${d.runs.length}건 · 클릭 → 구간 최저 코드 원문`}>
        <DetailTable columns={runCols} rows={d.runs} rowKey={(r) => r.start} onRowClick={(r) => onOpenRaw(r.minIdx ?? r.start)} emptyText="기간 내 상태 보고 구간이 없습니다." />
      </Section>

      <Section title="상태 보고 목록" sub={`보고 ${d.reports.length.toLocaleString()}건 · 시각순 · 클릭 → 원문`}>
        <DetailTable columns={repCols} rows={d.reports} rowKey={(r, i) => `${r.index}-${i}`} onRowClick={(r) => onOpenRaw(r.index)} emptyText="기간 내 활주로 표면 상태 보고가 없습니다." />
        <span className="dsection__note">
          정의: 상태 보고 전문 = "RWY.. CONDITION REPORT"(RWYCC 코드·구간별 오염 상태) 또는 제동작용 보고("BRAKING ACTION …")가 포함된 전문. 최저 RWYCC는 보고된 3분할 코드의 최솟값, 제동작용은 GOOD → GOOD TO MEDIUM → MEDIUM → MEDIUM TO POOR → POOR 순으로 나빠집니다.
          보고 구간은 상태 보고가 연속 전문에서 이어지는 범위이며 지속 시간은 시작·종료 전문의 시각 차입니다(정기 발행 간격 1시간 단위 근사). 활주로가 명시되지 않은 보고는 '미상'으로 집계합니다. 기간 전체 최저 코드를 보고한 전문은{' '}
          {d.minCodeIdx != null ? (
            <span className="dtable__more-btn" onClick={() => onOpenRaw(d.minCodeIdx as number)}>
              여기
            </span>
          ) : (
            '없습니다'
          )}
          .
        </span>
      </Section>
    </>
  );
}
