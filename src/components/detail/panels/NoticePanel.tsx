import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur, fmtNum } from '../../../data/detail/agg';
import { computeNoticeDetail, NOTICE_HOUR_UNIT_MAX_DAYS, NOTICE_UNIT_LABEL, type FlowDest, type NoticeRun, type NoticeSummary, type OtherText } from '../../../data/detail/notice';
import { countAxisMax } from '../../../data/detail/rwycond';
import { NOTICE_COLOR, NOTICE_LABEL } from '../../../data/stats';
import { BarChart, HOUR_LABELS, type StackPart } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const intFmt = (v: number) => String(Math.round(v));

/** 공지 종류 배지 (색 점 + 라벨) */
function KindBadge({ kind }: { kind: keyof typeof NOTICE_LABEL }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: NOTICE_COLOR[kind], flexShrink: 0 }} />
      <b>{NOTICE_LABEL[kind]}</b>
    </span>
  );
}

const durText = (r: NoticeRun) => (r.n > 1 ? `${fmtDur(r.durMs)} · ${r.n}건` : '단발 (1건)');

/** 운영 공지 상세 — 종류별 빈도 · 해상도별 누적 · 시간대 분포 · 흐름관리 지연 · 종류별 요약 · 이벤트 구간 · 미분류 문장 */
export function NoticePanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeNoticeDetail(recs, win), [recs, win]);
  const has = d.anyN > 0;

  const legend = d.chips.map((c) => <Legend key={c.kind} kind="sq" color={c.color} label={c.label} />);
  const stackOf = (counts: number[]): StackPart[] => d.chips.map((c, k) => ({ name: c.label, value: counts[k], color: c.color })).filter((p) => p.value > 0);

  const sumCols: Column<NoticeSummary>[] = [
    { key: 'kind', label: '종류', render: (s) => <KindBadge kind={s.kind} /> },
    { key: 'n', label: '전문 수', align: 'right', mono: true, render: (s) => <b>{s.n.toLocaleString()}</b> },
    { key: 'pct', label: '전문 대비', align: 'right', mono: true, render: (s) => `${s.pct}%` },
    { key: 'runs', label: '구간 수', align: 'right', mono: true, render: (s) => s.runCount },
    { key: 'first', label: '첫 발생', mono: true, render: (s) => fmtDT(s.firstTs) },
    { key: 'last', label: '마지막 발생', mono: true, render: (s) => fmtDT(s.lastTs) },
    { key: 'longest', label: '최장 연속 구간', mono: true, render: (s) => (s.longest ? `${fmtDayHM(s.longest.startTs)} ~ ${fmtDayHM(s.longest.endTs)} (${durText(s.longest)})` : '—') },
    { key: 'text', label: '대표 문장 (마지막)', render: (s) => <span style={{ fontSize: 11.5, opacity: 0.85 }}>{s.lastText}</span> },
  ];
  const evCols: Column<NoticeRun>[] = [
    { key: 'kind', label: '종류', render: (r) => <KindBadge kind={r.kind} /> },
    { key: 'start', label: '시작', mono: true, render: (r) => fmtDT(r.startTs) },
    { key: 'end', label: '종료', mono: true, render: (r) => (r.n > 1 ? fmtDT(r.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (r) => durText(r) },
    { key: 'text', label: '문장 (시작 전문)', render: (r) => <span style={{ fontSize: 11.5, opacity: 0.85 }}>{r.text}</span> },
  ];
  const flowCols: Column<FlowDest>[] = [
    { key: 'dest', label: '대상', mono: true, render: (f) => <b>{f.dest}</b> },
    { key: 'n', label: '전문 수', align: 'right', mono: true, render: (f) => f.n.toLocaleString() },
    { key: 'mean', label: '평균 지연', align: 'right', mono: true, render: (f) => `${fmtNum(f.meanMin)}분` },
    { key: 'max', label: '최대 지연', align: 'right', mono: true, render: (f) => `${f.maxMin}분` },
  ];
  const otherCols: Column<OtherText>[] = [
    { key: 'text', label: '문장', render: (o) => <span style={{ fontSize: 11.5 }}>{o.text}</span> },
    { key: 'n', label: '전문 수', align: 'right', mono: true, render: (o) => o.n.toLocaleString() },
  ];

  /** 이벤트 구간 — 상시 공지(GPS·조류 일반)는 구간이 매우 길어 목록을 덮으므로 뒤로 보낸다 */
  const events = useMemo(() => {
    const always = new Set(['GPS', 'BIRDS']);
    return [...d.events.filter((e) => !always.has(e.kind)), ...d.events.filter((e) => always.has(e.kind))];
  }, [d.events]);

  return (
    <>
      <StatTiles
        tiles={[
          { label: '공지 포함 전문', value: `${d.anyPct}%`, sub: `${d.anyN.toLocaleString()} / ${d.n.toLocaleString()}건`, accent: true },
          { label: '공지 종류', value: `${d.chips.length}종`, sub: d.chips.length ? d.chips.map((c) => c.label).join(' · ') : '기간 내 공지 없음' },
          { label: '최다 공지', value: d.top ? d.top.label : '—', sub: d.top ? `${d.top.n.toLocaleString()}건 · ${d.top.pct}%` : undefined, color: d.top?.color },
          {
            label: '흐름관리',
            value: `${d.flowN.toLocaleString()}건`,
            sub: d.flowMaxMin != null ? `최대 ${d.flowMaxMin}분 · 평균 ${fmtNum(d.flowMeanMin ?? 0)}분` : '흐름관리 공지 없음',
            color: d.flowN ? NOTICE_COLOR.FLOW : undefined,
          },
          { label: '윈드시어', value: `${d.wsN.toLocaleString()}건`, sub: d.wsN ? '경보·주의보 포함 전문' : '윈드시어 공지 없음', color: d.wsN ? NOTICE_COLOR.WS : undefined },
          { label: '현재 유효 공지', value: d.current.length ? `${d.current.length}종` : '없음', sub: d.current.length ? d.current.map((k) => NOTICE_LABEL[k]).join(' · ') : '마지막 전문 기준' },
        ]}
      />

      <Section title="공지 빈도" sub="종류별 전문 수 · 내림차순 · 클릭 → 마지막 발생 원문">
        {has ? (
          <div className="tags">
            {d.summaries.map((s) => (
              <div key={s.kind} className="tag" style={{ cursor: 'pointer' }} title={`${s.label} · 마지막 ${fmtDT(s.lastTs)}`} onClick={() => s.lastIdx >= 0 && onOpenRaw(s.lastIdx)}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0 }} />
                <span className="tag__code" style={{ fontFamily: 'var(--font-sans)' }}>
                  {s.label}
                </span>
                <span className="tag__desc">{s.pct}%</span>
                <span className="tag__n">{s.n.toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>기간 내 운영 공지 없음</Empty>
        )}
      </Section>

      <Section title="종류별 건수 추이" sub={`해상도 ${NOTICE_UNIT_LABEL[d.unit]} · 누적 막대 (전문 1건 × 종류 1개 = 1건)`} right={has ? <>{legend}</> : undefined}>
        {has ? (
          <>
            <div style={{ maxWidth: d.items.length < 12 ? Math.max(280, d.items.length * 64 + 60) : undefined }}>
              <BarChart
                items={d.items.map((it) => ({ label: it.label, title: it.title, stack: stackOf(it.counts), note: it.total ? `합계 ${it.total}건` : '공지 없음' }))}
                yMax={countAxisMax(d.maxBucketTotal)}
                yFormat={intFmt}
                unit="건"
                height={230}
                labelEvery={d.labelEvery}
                onBarClick={(i) => {
                  const idx = d.items[i]?.idx;
                  if (idx != null) onOpenRaw(idx);
                }}
              />
            </div>
            <span className="dsection__note">막대를 클릭하면 해당 구간의 공지가 있는 첫 전문을 엽니다. 조회 기간이 {NOTICE_HOUR_UNIT_MAX_DAYS}일 이하면 1시간, 초과면 1일 단위로 집계합니다.</span>
          </>
        ) : (
          <Empty>기간 내 공지가 없어 추이를 표시할 수 없습니다.</Empty>
        )}
      </Section>

      <div className="dgrid-2">
        <Section title="시간대별 공지" sub="UTC 시각별 · 종류 누적">
          {has ? (
            <BarChart
              items={HOUR_LABELS.map((h, i) => ({ label: h, title: `${h}:00Z ~ ${h}:59Z`, stack: stackOf(d.hourCounts.map((row) => row[i])), note: d.hourTotals[i] ? `합계 ${d.hourTotals[i]}건` : '공지 없음' }))}
              yMax={countAxisMax(d.maxHourTotal)}
              yFormat={intFmt}
              unit="건"
              height={210}
              labelEvery={3}
            />
          ) : (
            <Empty>기간 내 공지 없음</Empty>
          )}
        </Section>
        <Section title="흐름관리 지연" sub="대상별 전문 수 · 평균/최대 지연(분) · 클릭 → 최대 지연 원문">
          {d.flowDests.length ? (
            <>
              <div style={{ maxWidth: Math.max(240, d.flowDests.length * 80 + 60) }}>
                <BarChart
                  items={d.flowDests.map((f) => ({ label: f.dest, value: f.maxMin, lo: 0, color: NOTICE_COLOR.FLOW, title: f.dest, note: `전문 ${f.n}건 · 평균 ${fmtNum(f.meanMin)}분 · 최대 ${f.maxMin}분` }))}
                  yMax={countAxisMax(Math.max(...d.flowDests.map((f) => f.maxMin)))}
                  yFormat={intFmt}
                  unit="분"
                  height={170}
                  showValues
                  onBarClick={(i) => {
                    const f = d.flowDests[i];
                    if (f) onOpenRaw(f.maxIdx);
                  }}
                />
              </div>
              <DetailTable columns={flowCols} rows={d.flowDests} rowKey={(f) => f.dest} onRowClick={(f) => onOpenRaw(f.maxIdx)} maxHeight={200} />
              <span className="dsection__note">막대 높이는 대상별 최대 지연(분). "FLOW CONTROL IN EFFECT ON RKPC BY 10 MINUTES" 의 대상(RKPC·Y711 등)과 분을 집계합니다.</span>
            </>
          ) : (
            <Empty>기간 내 흐름관리 공지 없음</Empty>
          )}
        </Section>
      </div>

      <Section title="종류별 요약" sub="전문 수 내림차순 · 클릭 → 마지막 발생 원문">
        <DetailTable columns={sumCols} rows={d.summaries} rowKey={(s) => s.kind} onRowClick={(s) => s.lastIdx >= 0 && onOpenRaw(s.lastIdx)} emptyText="기간 내 운영 공지가 없습니다." />
      </Section>

      <Section title="공지 이벤트 구간" sub={`같은 종류의 연속 보고 병합 (공백 3시간 초과 시 분리) · ${d.events.length.toLocaleString()}건 · 클릭 → 시작 원문`}>
        <DetailTable columns={evCols} rows={events} rowKey={(r) => `${r.kind}-${r.start}`} onRowClick={(r) => onOpenRaw(r.start)} emptyText="기간 내 공지 이벤트가 없습니다." />
        <span className="dsection__note">상시 공지(GPS 신호 불량·조류 주의)는 구간이 길어 목록 뒤에 둡니다.</span>
      </Section>

      <Section title="분류되지 않은 문장" sub={`파서 규칙에 없는 remarks (기타) · ${d.others.length}종 · 클릭 → 마지막 원문`}>
        <DetailTable columns={otherCols} rows={d.others} rowKey={(o) => o.text} onRowClick={(o) => onOpenRaw(o.lastIdx)} maxHeight={240} emptyText="기간 내 분류되지 않은 문장이 없습니다." />
        <span className="dsection__note">
          정의: 공지 전문 수는 전문 1건에 같은 종류의 문장이 여러 개여도 1건으로 셉니다(통계 카드와 동일). 종류: GPS 신호 불량 · 흐름관리(FLOW CONTROL) · 윈드시어(WS/WINDSHEAR) · 저시정 절차(CAT-II/III) · 잔디 깎기 · 비행검사 · 자유기구 주의 · GP 운용 중단 · 공사 · 공항 폐쇄 · 조류 주의(일반 "FLOCKS OF BIRDS" 문장)
          · 기타. 이벤트 구간의 지속 시간은 시작·종료 전문의 시각 차입니다(정기 발행 간격 1시간 단위 근사).
        </span>
      </Section>
    </>
  );
}
