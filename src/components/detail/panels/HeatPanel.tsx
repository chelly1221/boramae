import { useMemo } from 'react';
import { fmtDate, fmtHM, niceTicks, pct } from '../../../data/detail/agg';
import { computeHeatDetail, FOG_PEAK_SHARE, HEAT_COLOR, HEAT_KINDS, HEAT_NAME, type HeatDay, type HeatKind, type HeatKindCount } from '../../../data/detail/heat';
import { BarChart, HOUR_LABELS } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const HOUR_AXIS = ['00Z', '06Z', '12Z', '18Z', '23Z'];
const hz = (h: number) => `${HOUR_LABELS[h]}Z`;
const stackOf = (c: HeatKindCount) =>
  HEAT_KINDS.map((k) => ({
    name: HEAT_NAME[k],
    value: c[k],
    color: HEAT_COLOR[k],
  }));
const SHORT: Record<HeatKind, string> = {
  fog: '시정',
  rain: '강수',
  rwy: '전환',
};
/** 타일 보조 문구용 종류별 요약 — 한 종류면 "시정 저하 24시간", 여럿이면 "시정19·강수5·전환2" (타일 폭에 맞춰 압축) */
function kindSummary(c: HeatKindCount): string {
  const ks = HEAT_KINDS.filter((k) => c[k] > 0);
  if (ks.length === 1) return `${HEAT_NAME[ks[0]]} ${c[ks[0]]}시간`;
  return ks.map((k) => `${SHORT[k]}${c[k]}`).join('·');
}
/** 건수 막대 y 상한 — 정수 눈금이 나오도록 4 이상으로 올리고, 최상단 눈금이 축 단위 라벨과 겹치지 않게 살짝 여유 */
function countMax(vals: number[]): number {
  const m = vals.reduce((a, v) => (v > a ? v : a), 0);
  const hi = Math.max(4, Math.ceil(m * 1.08));
  const t = niceTicks(0, hi, 4);
  const step = t.length > 1 ? t[1] - t[0] : 1;
  const last = t[t.length - 1];
  return hi - last < step * 0.4 ? last + step * 0.45 : hi;
}

/** 기상 히트맵 상세 — 기간 전체 일 × 24시간(UTC) 이벤트 그리드 · 종류별 집계 · 시간대/일별 분포 · 이벤트 일 목록 */
export function HeatPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeHeatDetail(recs, win), [recs, win]);
  const openDay = (day: HeatDay | undefined) => {
    if (day?.firstEvIndex != null) onOpenRaw(day.firstEvIndex);
  };

  const legend = (
    <>
      <Legend kind="sq" color={HEAT_COLOR.fog} label="시정 저하 / 안개" />
      <Legend kind="sq" color={HEAT_COLOR.rain} label="강수" />
      <Legend kind="sq" color={HEAT_COLOR.rwy} label="활주로 전환" />
    </>
  );

  const dayCols: Column<HeatDay>[] = [
    {
      key: 'day',
      label: '일자 (UTC)',
      mono: true,
      render: (x) => fmtDate(x.ts),
    },
    {
      key: 'any',
      label: '이벤트 시간',
      align: 'right',
      mono: true,
      render: (x) => <b>{x.any}</b>,
    },
    {
      key: 'fog',
      label: '시정 저하',
      align: 'right',
      mono: true,
      render: (x) => (x.fog ? <span style={{ color: HEAT_COLOR.fog, fontWeight: 700 }}>{x.fog}</span> : '—'),
    },
    {
      key: 'rain',
      label: '강수',
      align: 'right',
      mono: true,
      render: (x) => (x.rain ? <span style={{ color: HEAT_COLOR.rain, fontWeight: 700 }}>{x.rain}</span> : '—'),
    },
    {
      key: 'rwy',
      label: '활주로 전환 (시간 / 횟수)',
      align: 'right',
      mono: true,
      render: (x) => (x.rwy ? <span style={{ color: HEAT_COLOR.rwy, fontWeight: 700 }}>{`${x.rwy} / ${x.rwyChanges}회`}</span> : '—'),
    },
    {
      key: 'first',
      label: '첫 이벤트',
      mono: true,
      render: (x) => (x.firstEvTs != null ? fmtHM(x.firstEvTs) : '—'),
    },
    {
      key: 'n',
      label: '전문 수',
      align: 'right',
      mono: true,
      render: (x) => `${x.n}건`,
    },
  ];

  const topDay = d.topDay;
  const fogNote = d.fogTopHour
    ? ` 시정 저하는 ${hz(d.fogTopHour.hour)} 시간대에 가장 잦음(${d.fogTopHour.count}시간)` +
      (d.fogPeak && d.fogPeak.share >= FOG_PEAK_SHARE ? ` — ${hz(d.fogPeak.h0)}–${hz(d.fogPeak.h1)} 구간에 ${d.fogPeak.share}% 집중, 반복 안개 패턴.` : '.')
    : '';

  return (
    <>
      <StatTiles
        tiles={[
          {
            label: '시정 저하 시간',
            value: `${d.cells.fog}시간`,
            sub: `관측 ${d.dataCells}시간 중 ${pct(d.cells.fog, d.dataCells)}%`,
            accent: true,
          },
          {
            label: '강수 시간',
            value: `${d.cells.rain}시간`,
            sub: `관측 ${d.dataCells}시간 중 ${pct(d.cells.rain, d.dataCells)}%`,
            color: HEAT_COLOR.rain,
          },
          {
            label: '전환 발생 시간',
            value: `${d.cells.rwy}시간`,
            sub: `활주로 전환 ${d.rwyChanges}회`,
          },
          {
            label: '이벤트 없는 날',
            value: `${d.quietDays}일`,
            sub: `관측 ${d.dataDays}일 중 ${pct(d.quietDays, d.dataDays)}%`,
          },
          {
            label: '이벤트 최다 시간대',
            value: d.topHour ? hz(d.topHour.hour) : '—',
            sub: d.topHour ? `${d.topHour.count}시간(셀)${d.topHour.ties > 1 ? ` · 동률 ${d.topHour.ties}개` : ''}` : '이벤트 없음',
          },
          {
            label: '이벤트 최다 일',
            value: topDay ? topDay.label : '—',
            sub: !topDay ? '이벤트 없음' : d.topDayTies > 1 ? `${topDay.any}시간(셀) · 동률 ${d.topDayTies}일` : kindSummary(topDay),
          },
        ]}
      />

      <Section title="기간 전체 히트맵" sub={`일 × 24시간 (UTC) · ${d.rows.length}일 · 해상도 1시간(셀) · 셀 클릭 → 원문`} right={legend}>
        <div
          style={
            d.scroll
              ? {
                  maxHeight: 420,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  paddingRight: 4,
                }
              : undefined
          }
        >
          <div className="heat">
            {d.rows.map((row) => (
              <div key={row.dayTs} className="heat__row">
                <span className="heat__day" title={fmtDate(row.dayTs)}>
                  {row.day}
                </span>
                {row.cells.map((c) => (
                  <div
                    key={c.ts}
                    className="heat__cell"
                    title={c.title}
                    style={{
                      background: c.bg,
                      height: d.cellH,
                      cursor: c.index != null ? 'pointer' : 'default',
                    }}
                    onClick={c.index != null ? () => onOpenRaw(c.index as number) : undefined}
                  />
                ))}
              </div>
            ))}
            <div
              className="heat__axis"
              style={
                d.scroll
                  ? {
                      position: 'sticky',
                      bottom: 0,
                      background: 'var(--surface)',
                    }
                  : undefined
              }
            >
              <span className="heat__day" />
              <div className="axis-labels">
                {HOUR_AXIS.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <span className="dsection__note">
          셀 = UTC 1시간. 시정 저하 = 시정 10KM 미만(강수 제외), 강수 = RA·SN 태그, 활주로 전환 = 직전 전문과 사용 활주로가 다름 — 통계 카드와 같은 정의. 복합 이벤트 셀은 50/50 분할 색, 옅은 회색은 이벤트 없음(더 옅은
          회색은 기간 외).
          {fogNote}
        </span>
      </Section>

      <div className="dgrid-2">
        <Section title="시간대별 이벤트 분포" sub="UTC 시각별 이벤트 셀 수 · 종류별 누적(복합 셀 중복)">
          {!d.cells.any ? (
            <Empty>기간 내 이벤트가 없습니다.</Empty>
          ) : (
            <BarChart
              items={d.hourStack.map((c, h) => ({
                label: HOUR_LABELS[h],
                stack: stackOf(c),
                title: `${hz(h)} 시간대`,
                note: `이벤트 셀 ${c.any}개`,
              }))}
              yMax={countMax(d.hourStack.map((c) => c.fog + c.rain + c.rwy))}
              unit="시간"
              yFormat={(v) => String(Math.round(v))}
              height={200}
              labelEvery={3}
            />
          )}
        </Section>
        <Section title="일별 이벤트 시간 수" sub="하루 중 이벤트 셀 수 · 종류별 누적 · 막대 클릭 → 그날 첫 이벤트 원문">
          {!d.cells.any ? (
            <Empty>기간 내 이벤트가 없습니다.</Empty>
          ) : (
            <BarChart
              items={d.daily.map((x) => ({
                label: x.label,
                stack: stackOf(x),
                title: fmtDate(x.ts),
                note: x.n ? `이벤트 셀 ${x.any}개 · 전환 ${x.rwyChanges}회 · 전문 ${x.n}건` : '전문 없음',
              }))}
              yMax={countMax(d.daily.map((c) => c.fog + c.rain + c.rwy))}
              unit="시간"
              yFormat={(v) => String(Math.round(v))}
              height={200}
              onBarClick={(i) => openDay(d.daily[i])}
            />
          )}
        </Section>
      </div>

      <Section title="이벤트 일 목록" sub="이벤트 셀 수 내림차순 · 클릭 → 그날 첫 이벤트 원문">
        <DetailTable columns={dayCols} rows={d.eventDays} rowKey={(x) => x.ts} onRowClick={(x) => openDay(x)} emptyText="기간 내 이벤트가 없습니다." />
      </Section>
    </>
  );
}
