import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur } from '../../../data/detail/agg';
import { computeTagsDetail, countAxisMax, TAGS_HOUR_UNIT_MAX_DAYS, TAGS_UNIT_LABEL, type TagRun, type TagSummary, type TrendItem } from '../../../data/detail/tags';
import { BarChart, HOUR_LABELS, withAlpha, type StackPart } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_TS = '#c8422e';
const C_BECMG = '#b4451c';
const C_TEMPO = '#b8770a';
const HOUR_AXIS = ['00시', '06시', '12시', '18시', '23시'];
/** 강도 분포 "FBL 12 · MOD 3 · HVY 1" (0은 생략) */
const intensityText = (x: [number, number, number]) =>
  [
    ['FBL', x[0]],
    ['MOD', x[1]],
    ['HVY', x[2]],
  ]
    .filter(([, n]) => (n as number) > 0)
    .map(([l, n]) => `${l} ${n}`)
    .join(' · ') || '—';

/** 태그 코드 배지 (색 점 + 모노 코드) */
function TagCode({ tag, color }: { tag: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
      <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
        {tag}
      </span>
    </span>
  );
}

const durText = (r: TagRun) => (r.n > 1 ? `${fmtDur(r.durMs)} · ${r.n}건` : '단발 (1건)');

/** 기상현상 태그 상세 — 태그 빈도 · 해상도별 누적 · 시간대 분포 · 태그별 요약 · 이벤트 구간 */
export function TagsPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeTagsDetail(recs, win), [recs, win]);
  const hasTags = d.total > 0;

  const legend = d.chips.map((c) => <Legend key={c.tag} kind="sq" color={c.color} label={`${c.tag} ${c.desc}`} />);

  const stackOf = (counts: number[]): StackPart[] =>
    d.chips.map((c, k) => ({ name: `${c.tag} ${c.desc}`, value: counts[k], color: c.color })).filter((p) => p.value > 0);

  const yMaxOf = countAxisMax;
  const intFmt = (v: number) => String(Math.round(v));
  const cellH = Math.max(12, Math.min(26, Math.floor(160 / Math.max(1, d.chips.length))));

  const sumCols: Column<TagSummary>[] = [
    { key: 'tag', label: '태그', render: (s) => <TagCode tag={s.tag} color={s.color} /> },
    { key: 'desc', label: '설명', render: (s) => s.desc },
    { key: 'n', label: '건수', align: 'right', mono: true, render: (s) => <b>{s.n.toLocaleString()}</b> },
    { key: 'ratio', label: '전문 대비', align: 'right', mono: true, render: (s) => `${s.ratioText}%` },
    { key: 'runs', label: '구간 수', align: 'right', mono: true, render: (s) => s.runCount },
    { key: 'int', label: '강도 (FBL/MOD/HVY)', mono: true, render: (s) => intensityText(s.intensity) },
    { key: 'first', label: '첫 발생', mono: true, render: (s) => fmtDT(s.firstTs) },
    { key: 'last', label: '마지막 발생', mono: true, render: (s) => fmtDT(s.lastTs) },
    {
      key: 'longest',
      label: '최장 연속 구간',
      mono: true,
      render: (s) => (s.longest ? `${fmtDayHM(s.longest.startTs)} ~ ${fmtDayHM(s.longest.endTs)} (${durText(s.longest)})` : '—'),
    },
  ];

  const evCols: Column<TagRun>[] = [
    { key: 'tag', label: '태그', render: (r) => <TagCode tag={r.tag} color={r.color} /> },
    { key: 'start', label: '시작', mono: true, render: (r) => fmtDT(r.startTs) },
    { key: 'end', label: '종료', mono: true, render: (r) => (r.n > 1 ? fmtDT(r.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (r) => durText(r) },
    { key: 'vis', label: '당시 시정 (최저)', align: 'right', mono: true, render: (r) => minVisText(recs, r) },
    { key: 'wind', label: '시작 시 바람', mono: true, render: (r) => recs[r.start]?.wind ?? '—' },
  ];

  const trendCols: Column<TrendItem>[] = [
    { key: 'ts', label: '시각', mono: true, render: (t) => fmtDT(t.ts) },
    { key: 'letter', label: '레터', mono: true, align: 'center', render: (t) => <b>{t.letter}</b> },
    { key: 'trend', label: 'TREND', mono: true, render: (t) => <span style={{ fontWeight: 700, color: t.trend === 'BECMG' ? C_BECMG : C_TEMPO }}>{t.trend}</span> },
    { key: 'txt', label: '예보 내용 (원문)', mono: true, render: (t) => <span style={{ whiteSpace: 'normal' }}>{t.trendTxt.replace(/^(BECMG|TEMPO)\.?\s*/, '') || '—'}</span> },
    { key: 'vis', label: '당시 시정', align: 'right', mono: true, render: (t) => t.visTxt },
    { key: 'wx', label: '당시 현재기상', mono: true, render: (t) => t.wxTxt || '—' },
  ];
  const codeList = d.chips.map((c) => `${c.tag} ${c.desc}`).join(' · ');

  return (
    <>
      <StatTiles
        tiles={[
          { label: '태그 보고 총 건수', value: `${d.total.toLocaleString()}건`, sub: `전문 ${d.n.toLocaleString()}건 중`, accent: true },
          { label: '태그 포함 전문 비율', value: `${d.taggedPct}%`, sub: `${d.tagged.toLocaleString()} / ${d.n.toLocaleString()}건` },
          { label: '최다 태그', value: d.top ? d.top.tag : '—', sub: d.top ? `${d.top.n.toLocaleString()}건 · ${d.top.desc}` : '기간 내 태그 없음', color: d.top?.color },
          { label: '태그 종류', value: `${d.chips.length}종`, sub: d.chips.length ? d.chips.map((c) => c.tag).join('·') : undefined },
          { label: '최다 태그 일', value: d.topDay ? d.topDay.label : '—', sub: d.topDay ? `${d.topDay.n}건${d.topDay.topTag ? ` · 주로 ${d.topDay.topTag}` : ''}` : undefined },
          { label: 'TS 보고', value: `${d.tsCount}건`, sub: d.tsLastTs != null ? `마지막 ${fmtDayHM(d.tsLastTs)}` : '뇌전 보고 없음', color: d.tsCount ? C_TS : undefined },
          {
            label: '최장 연속 구간',
            value: d.longestRun ? (d.longestRun.n > 1 ? fmtDur(d.longestRun.durMs) : '단발') : '—',
            sub: d.longestRun ? `${d.longestRun.tag} · ${fmtDayHM(d.longestRun.startTs)}~` : undefined,
            color: d.longestRun?.color,
          },
        ]}
      />

      <Section title="태그 빈도" sub="전문 기상현상 토큰 · 건수 내림차순 · 클릭 → 마지막 발생 원문">
        {hasTags ? (
          <div className="tags">
            {d.summaries.map((s) => (
              <div key={s.tag} className="tag" style={{ cursor: 'pointer' }} title={`${s.tag} ${s.desc} · 마지막 ${fmtDT(s.lastTs)}`} onClick={() => s.lastIdx >= 0 && onOpenRaw(s.lastIdx)}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0 }} />
                <span className="tag__code">{s.tag}</span>
                <span className="tag__desc">{s.desc}</span>
                <span className="tag__n">{s.n.toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>기간 내 특이기상 태그 없음</Empty>
        )}
      </Section>

      <Section title="태그별 건수 추이" sub={`해상도 ${TAGS_UNIT_LABEL[d.unit]} · 누적 막대`} right={hasTags ? <>{legend}</> : undefined}>
        {hasTags ? (
          <>
            {/* 버킷이 적으면(짧은 창) 막대가 과도하게 넓어지지 않도록 차트 폭을 버킷 수에 비례해 제한 */}
            <div style={{ maxWidth: d.items.length < 12 ? Math.max(280, d.items.length * 64 + 60) : undefined }}>
              <BarChart
                items={d.items.map((it) => ({ label: it.label, title: it.title, stack: stackOf(it.counts), note: it.total ? `합계 ${it.total}건` : '태그 없음' }))}
                yMax={yMaxOf(d.maxBucketTotal)}
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
            <span className="dsection__note">
              막대를 클릭하면 해당 구간의 태그가 있는 첫 전문을 엽니다. 조회 기간이 {TAGS_HOUR_UNIT_MAX_DAYS}일 이하면 1시간, 초과면 1일 단위로 집계합니다.
            </span>
          </>
        ) : (
          <Empty>기간 내 태그 보고가 없어 추이를 표시할 수 없습니다.</Empty>
        )}
      </Section>

      <div className="dgrid-2">
        <Section title="시간대별 태그 건수" sub="UTC 시각별 · 태그 누적">
          {hasTags ? (
            <BarChart
              items={HOUR_LABELS.map((h, i) => ({ label: h, title: `${h}:00Z ~ ${h}:59Z`, stack: stackOf(d.hourCounts.map((row) => row[i])), note: d.hourTotals[i] ? `합계 ${d.hourTotals[i]}건` : '태그 없음' }))}
              yMax={yMaxOf(d.maxHourTotal)}
              yFormat={intFmt}
              unit="건"
              height={210}
              labelEvery={3}
            />
          ) : (
            <Empty>기간 내 태그 보고 없음</Empty>
          )}
          {d.topHour && (
            <span className="dsection__note">
              {d.topHour.ties > 3
                ? `시간대별 최다 ${d.topHour.n}건 (${d.topHour.ties}개 시간대 동률)`
                : `태그 최다 시간대 ${HOUR_LABELS[d.topHour.hour]}Z${d.topHour.ties > 1 ? ` 외 ${d.topHour.ties - 1}곳 (각 ${d.topHour.n}건)` : ` (${d.topHour.n}건)`}`}
              {d.fog.pattern ? ` · BR/FG ${d.fog.total}건 중 ${d.fog.night}건이 03–06Z — 새벽 안개 패턴` : ''}
            </span>
          )}
        </Section>
        <Section title="태그 × 시간대" sub="행: 태그 · 열: UTC 시각 · 농도 = 건수 · 셀 클릭 → 원문">
          {hasTags ? (
            <div className="heat">
              {d.chips.map((c, k) => (
                <div key={c.tag} className="heat__row">
                  <span className="heat__day mono" style={{ fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: c.color, flexShrink: 0 }} />
                    {c.tag}
                  </span>
                  {d.grid[k].map((cell, h) => (
                    <div
                      key={h}
                      className="heat__cell"
                      style={{
                        height: cellH,
                        background: cell.n ? withAlpha(c.color, 0.18 + 0.82 * Math.min(1, cell.n / Math.max(1, d.maxCell))) : 'rgba(50,30,20,0.04)',
                        cursor: cell.idx != null ? 'pointer' : 'default',
                      }}
                      title={`${c.tag} ${c.desc} · ${HOUR_LABELS[h]}Z · ${cell.n}건`}
                      onClick={() => cell.idx != null && onOpenRaw(cell.idx)}
                    />
                  ))}
                </div>
              ))}
              <div className="heat__axis">
                <span className="heat__day" />
                <div className="axis-labels">
                  {HOUR_AXIS.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <Empty>기간 내 태그 보고 없음</Empty>
          )}
          {hasTags && <span className="dsection__note">전체 셀 최대 {d.maxCell}건 기준으로 농도를 정규화합니다.</span>}
        </Section>
      </div>

      <Section title="TREND 변화 예보" sub={`BECMG/TEMPO 전문 ${d.trendItems.length.toLocaleString()}건 · 클릭 → 원문`}>
        <StatTiles
          cols={4}
          tiles={[
            { label: 'BECMG', value: `${d.becmgN}건`, sub: '점진 변화 예보', color: d.becmgN ? C_BECMG : undefined },
            { label: 'TEMPO', value: `${d.tempoN}건`, sub: '일시 변화 예보', color: d.tempoN ? C_TEMPO : undefined },
            { label: 'NOSIG', value: `${(d.n - d.becmgN - d.tempoN - d.trendNullN).toLocaleString()}건`, sub: d.trendNullN ? `TREND 없음 ${d.trendNullN}건` : '유의미한 변화 없음' },
            { label: '최근기상 (RE)', value: `${d.recentN}건`, sub: d.recentCodes.length ? d.recentCodes.map((c) => `RE ${c.code} ${c.n}`).join(' · ') : '보고 없음' },
          ]}
        />
        <DetailTable columns={trendCols} rows={[...d.trendItems].reverse()} rowKey={(t) => t.index} onRowClick={(t) => onOpenRaw(t.index)} emptyText="기간 내 BECMG/TEMPO 예보가 없습니다 (전부 NOSIG)." />
      </Section>

      <Section title="태그별 요약" sub="건수 내림차순 · 클릭 → 마지막 발생 원문">
        <DetailTable columns={sumCols} rows={d.summaries} rowKey={(s) => s.tag} onRowClick={(s) => s.lastIdx >= 0 && onOpenRaw(s.lastIdx)} emptyText="기간 내 특이기상 태그가 없습니다." />
      </Section>

      <Section title="태그 이벤트 구간" sub={`연속 보고 구간 병합 · 시작 시각순 · ${d.events.length.toLocaleString()}건 · 클릭 → 시작 원문`}>
        <DetailTable columns={evCols} rows={d.events} rowKey={(r) => `${r.tag}-${r.start}`} onRowClick={(r) => onOpenRaw(r.start)} emptyText="기간 내 태그 이벤트가 없습니다." />
        <span className="dsection__note">
          정의: 태그 = 전문 현재기상 문장("WITH FBL TS RA BR")의 2글자 현상·기술자 코드(강도 FBL/MOD/HVY 제외, 전문당 중복 제거). 태그 건수는 전문 1건 × 태그 1개를 1건으로 셉니다(통계 카드와 동일). 이벤트 구간은 같은 태그가 연속 전문에서 이어지는
          범위이며, 지속 시간은 시작·종료 전문의 시각 차입니다(정기 발행 간격 1시간 단위 근사). 강도는 전문당 해당 코드의 가장 센 강도로 1회 셉니다. {codeList ? `기간 내 태그: ${codeList}.` : ''}
        </span>
      </Section>
    </>
  );
}

/** 구간 내 최저 시정 텍스트 (km/m) */
function minVisText(recs: PanelProps['recs'], r: TagRun): string {
  let v = Infinity;
  for (let i = r.start; i <= r.end; i++) if (recs[i] && recs[i].vis < v) v = recs[i].vis;
  if (!Number.isFinite(v)) return '—';
  return v >= 10 ? '10KM+' : v >= 1 ? `${v}KM` : `${Math.round(v * 1000)}M`;
}
