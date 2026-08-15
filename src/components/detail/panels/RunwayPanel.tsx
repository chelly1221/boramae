import { useMemo } from 'react';
import { DAY, fmtDayHM, fmtDT, fmtDur, fmtNum, niceTicks } from '../../../data/detail/agg';
import { bucketLabel, computeRunwayDetail, DIR8_LABELS, RWY_32, rwyPrefix, type RwyChange } from '../../../data/detail/runway';
import { BarChart, HOUR_LABELS } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C32 = '#7f0d00';
const C14 = '#8c7a6e';

/** 정수 눈금만 표시 (건수 축) */
const intTick = (v: number) => (Number.isInteger(v) ? String(v) : '');
/** 비율 축 — 라벨에 % 포함 (BarChart unit 라벨이 최상단 눈금과 겹치는 것을 피함) */
const pctTick = (v: number) => `${Math.round(v)}%`;
/**
 * 건수 축 상한 — 최소 4, 여유 10%. BarChart의 unit 라벨(최상단 좌측)이 최상단 nice 눈금 라벨과 겹치지 않도록
 * 최상단 눈금이 상한의 6% 이내로 붙으면 반 눈금만큼 더 올린다 (눈금은 항상 정수).
 */
function countAxis(xs: number[]): number {
  let m = 0;
  for (const v of xs) if (v > m) m = v;
  let yMax = Math.max(4, m) * 1.1;
  const t = niceTicks(0, yMax, 4);
  const top = t[t.length - 1];
  const step = t.length > 1 ? t[1] - t[0] : 1;
  if ((yMax - top) / yMax < 0.06) yMax = top + step * 0.5;
  return yMax;
}

/** 타일 보조 텍스트 여러 줄 (단어 중간 줄바꿈 방지, 빈 줄은 생략) */
const Sub = ({ lines }: { lines: (string | undefined)[] }) => {
  const ls = lines.filter((l): l is string => !!l);
  return (
    <span style={{ wordBreak: 'keep-all' }}>
      {ls.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {l}
        </span>
      ))}
    </span>
  );
};

/** 전환 라벨 (도착 활주로 색) */
const Transition = ({ e }: { e: RwyChange }) => <span style={{ fontWeight: 700, color: e.to === RWY_32 ? C32 : C14 }}>{e.label}</span>;

/** 활주로 사용 상세 — 사용 비율 · 구간별 32/14 누적 막대 · 전환 프로파일 · 전환 이벤트 전체 목록 */
export function RunwayPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeRunwayDetail(recs, win), [recs, win]);
  const hasEvents = d.events.length > 0;
  /** 최신순 이벤트 목록 */
  const eventsDesc = useMemo(() => [...d.events].reverse(), [d.events]);

  const openBucket = (i: number) => {
    const idx = d.buckets[i]?.index;
    if (idx != null) onOpenRaw(idx);
  };

  const evCols: Column<RwyChange>[] = [
    { key: 'ts', label: '시각', mono: true, render: (e) => fmtDT(e.ts) },
    { key: 'tr', label: '전환', render: (e) => <Transition e={e} /> },
    { key: 'wind', label: '당시 바람', mono: true, render: (e) => e.wind },
    { key: 'twPrev', label: '직전 활주로 배풍', align: 'right', mono: true, render: (e) => `${fmtNum(e.twPrev)} KT` },
    { key: 'twNew', label: '새 활주로 배풍', align: 'right', mono: true, render: (e) => `${fmtNum(e.twNew)} KT` },
    {
      key: 'hold',
      label: '유지 시간',
      align: 'right',
      mono: true,
      render: (e) => (e.ongoing ? <span style={{ color: 'var(--ink-muted-5)' }}>{fmtDur(e.holdMs)} (계속)</span> : fmtDur(e.holdMs)),
    },
  ];

  const completeCount = d.segments.filter((s) => s.complete).length;
  /** 하루 미만 창에서는 회/일 환산이 무의미 */
  const showPerDay = win.to - win.from >= DAY;
  /** 막대가 몇 개뿐인 창(1시간 등)에서 막대가 카드 폭 전체로 퍼지지 않도록 차트 폭 제한 */
  const mainMaxWidth = d.buckets.length <= 8 ? 54 + d.buckets.length * 84 : undefined;

  return (
    <>
      <StatTiles
        tiles={[
          { label: '32L/32R 비율', value: `${d.p32}%`, sub: `${d.n32.toLocaleString()}건 / ${d.n.toLocaleString()}건`, accent: true },
          { label: '14L/14R 비율', value: `${d.p14}%`, sub: `${d.n14.toLocaleString()}건 / ${d.n.toLocaleString()}건` },
          {
            label: '전환 횟수',
            value: `${d.events.length}회`,
            sub: hasEvents ? <Sub lines={[`32→14 ${d.to14} · 14→32 ${d.to32}`, showPerDay ? `${fmtNum(d.perDay)}회/일` : undefined]} /> : <Sub lines={['기간 내 전환 없음', `${d.current} 유지`]} />,
          },
          {
            label: '평균 유지 시간',
            value: Number.isFinite(d.holdMean) ? fmtDur(d.holdMean) : '—',
            sub: Number.isFinite(d.holdMean) ? <Sub lines={[`중앙값 ${fmtDur(d.holdMedian)}`, `전환 간격 · 완전 구간 ${completeCount}개`]} /> : <Sub lines={['완전한 유지 구간 없음', '(전환 2회 이상 필요)']} />,
          },
          {
            label: '최장 유지',
            value: d.longest ? fmtDur(d.longest.durMs) : '—',
            sub: d.longest ? <Sub lines={[`${d.longest.rwy}${d.longest.complete ? '' : ' (기간 경계 포함)'}`, `${fmtDayHM(d.longest.startTs)} ~`, fmtDayHM(d.longest.endTs)]} /> : undefined,
            color: d.longest ? (d.longest.rwy === RWY_32 ? C32 : C14) : undefined,
          },
          {
            label: '마지막 전환',
            value: d.lastChange ? fmtDayHM(d.lastChange.ts) : '—',
            sub: d.lastChange ? <Sub lines={[`${d.lastChange.label} · ${d.lastChange.wind}`, `이후 ${fmtDur(d.currentHoldMs)} 유지`]} /> : <Sub lines={[`${d.current} 유지 중`, fmtDur(d.currentHoldMs)]} />,
          },
        ]}
      />

      <Section
        title="활주로 사용 추이"
        sub={`구간별 32 / 14 사용 비율 · 해상도 ${bucketLabel(d.bucketMs)}`}
        right={
          <>
            <Legend kind="sq" color={C32} label="32L/32R" />
            <Legend kind="sq" color={C14} label="14L/14R" />
          </>
        }
      >
        <div style={mainMaxWidth ? { maxWidth: mainMaxWidth } : undefined}>
          <BarChart
            items={d.buckets.map((b) => {
              const tot = b.n32 + b.n14;
              return {
                label: b.label,
                title: b.title,
                stack: [
                  { name: '32L/32R', value: tot ? (b.n32 / tot) * 100 : 0, color: C32 },
                  { name: '14L/14R', value: tot ? (b.n14 / tot) * 100 : 0, color: C14 },
                ],
                note: tot ? `32: ${b.n32}건 · 14: ${b.n14}건 (총 ${tot}건)` : '전문 없음',
              };
            })}
            yMax={100}
            yFormat={pctTick}
            height={240}
            labelEvery={d.labelAuto ? undefined : 1}
            onBarClick={openBucket}
          />
        </div>
        <span className="dsection__note">각 구간의 전문 수 대비 사용 활주로 비율. 막대를 클릭하면 해당 구간의 첫 전문을 엽니다. 빈 구간은 수신 전문이 없는 시간대입니다.</span>
      </Section>

      <div className="dgrid-2">
        <Section
          title="시간대별 전환 발생"
          sub="UTC 시각별 전환 건수"
          right={
            <>
              <Legend kind="sq" color={C32} label="→ 32" />
              <Legend kind="sq" color={C14} label="→ 14" />
            </>
          }
        >
          {hasEvents ? (
            <BarChart
              items={HOUR_LABELS.map((h, i) => ({
                label: h,
                title: `${h}:00Z ~ ${h}:59Z`,
                stack: [
                  { name: '14 → 32', value: d.hourTo32[i], color: C32 },
                  { name: '32 → 14', value: d.hourTo14[i], color: C14 },
                ],
              }))}
              yMax={countAxis(d.hourTo32.map((v, i) => v + d.hourTo14[i]))}
              yFormat={intTick}
              unit="건"
              height={200}
              labelEvery={3}
            />
          ) : (
            <Empty>기간 내 활주로 전환이 없습니다.</Empty>
          )}
        </Section>
        <Section
          title="전환 시 풍향 분포"
          sub="전환 시점 풍향(8방위)별 건수 · 툴팁에 평균 풍속"
          right={
            <>
              <Legend kind="sq" color={C32} label="→ 32" />
              <Legend kind="sq" color={C14} label="→ 14" />
            </>
          }
        >
          {hasEvents ? (
            <BarChart
              items={DIR8_LABELS.map((lab, i) => ({
                label: lab,
                title: `${lab} (${i * 45}°)`,
                stack: [
                  { name: '14 → 32', value: d.dirTo32[i], color: C32 },
                  { name: '32 → 14', value: d.dirTo14[i], color: C14 },
                ],
                note: d.dirSpd[i] != null ? `평균 풍속 ${fmtNum(d.dirSpd[i] as number)} KT` : undefined,
              }))}
              yMax={countAxis(d.dirTo32.map((v, i) => v + d.dirTo14[i]))}
              yFormat={intTick}
              unit="건"
              height={200}
            />
          ) : (
            <Empty>기간 내 활주로 전환이 없습니다.</Empty>
          )}
        </Section>
      </div>

      <div className="dgrid-2">
        <Section
          title="시간대별 사용 비율"
          sub="UTC 시각별 32 / 14 비율 (전문 수)"
          right={
            <>
              <Legend kind="sq" color={C32} label="32L/32R" />
              <Legend kind="sq" color={C14} label="14L/14R" />
            </>
          }
        >
          <BarChart
            items={HOUR_LABELS.map((h, i) => {
              const tot = d.hourN32[i] + d.hourN14[i];
              return {
                label: h,
                title: `${h}:00Z ~ ${h}:59Z`,
                stack: [
                  { name: '32L/32R', value: tot ? (d.hourN32[i] / tot) * 100 : 0, color: C32 },
                  { name: '14L/14R', value: tot ? (d.hourN14[i] / tot) * 100 : 0, color: C14 },
                ],
                note: tot ? `32: ${d.hourN32[i]}건 · 14: ${d.hourN14[i]}건` : '전문 없음',
              };
            })}
            yMax={100}
            yFormat={pctTick}
            height={200}
            labelEvery={3}
          />
        </Section>
        <Section title="유지 시간 분포" sub="전환과 전환 사이 유지 구간 길이별 개수">
          {completeCount ? (
            <BarChart items={d.holdBins.map((b) => ({ label: b.label, value: b.n, color: 'rgba(127,13,0,0.75)', title: `유지 ${b.label}` }))} yMax={countAxis(d.holdBins.map((b) => b.n))} yFormat={intTick} unit="구간" height={200} />
          ) : (
            <Empty>완전한 유지 구간이 없습니다 (전환 2회 이상 필요).</Empty>
          )}
        </Section>
      </div>

      <Section title="전환 이벤트 전체 목록" sub={`${d.events.length}건 · 최신순 · 클릭 → 원문`}>
        <DetailTable columns={evCols} rows={eventsDesc} rowKey={(e) => e.index} onRowClick={(e) => onOpenRaw(e.index)} emptyText="기간 내 활주로 전환이 없습니다." />
        <span className="dsection__note">
          전환 = 직전 전문과 사용 활주로가 다른 전문 (통계 카드와 동일). 직전 활주로 배풍 = 전환 시 바람을 직전 활주로 진방위(32: 315°, 14: 135°)에 투영한 배풍 성분. 유지 시간 = 해당 전환부터 다음 전환까지 (마지막은 기간 마지막
          전문까지). 사용 비율은 전문 수 기준이며 현재 활주로는 {rwyPrefix(d.current)} 계열입니다.
        </span>
      </Section>
    </>
  );
}
