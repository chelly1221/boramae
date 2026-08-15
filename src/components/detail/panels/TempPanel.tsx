import { useMemo } from 'react';
import { fmtDayHM, fmtDur, fmtNum, HOUR, UNIT_LABEL } from '../../../data/detail/agg';
import { computeTempDetail, FOG_SPREAD_C, type FogEvent } from '../../../data/detail/temp';
import { BarChart, HOUR_LABELS, TimeSeriesChart } from '../charts';
import { DetailTable, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_TEMP = '#b4451c';
const C_DP = '#8c7a6e';
const C_SPREAD = '#c8871c';
const C_FOG_BAND = 'rgba(200,135,28,0.18)';
/** 집계 해상도의 밴드는 버킷 단위로 넓어지므로 더 옅게 */
const FOG_BAND_ALPHA = { raw: 0.18, hour: 0.13, day: 0.1 } as const;
const C_FOG_TEXT = '#9a6a12';

/** 시간대 프로파일용 x축 — 1970-01-01 00:00Z 기준 h시간 (TimeSeriesChart 축 라벨이 "HH:00Z"로 나옴) */
const HOUR_XS = Array.from({ length: 24 }, (_, h) => h * HOUR);
const hourTitle = (ts: number) => `${HOUR_LABELS[Math.round(ts / HOUR) % 24]}:00Z (UTC 시간대 평균)`;

const fmtC = (v: number, digits = 1) => `${fmtNum(v, digits)}°C`;
/** 건수 축 — 정수 눈금만 표시 */
const fmtInt = (v: number) => (Number.isInteger(v) ? String(v) : '');

/** 온도/노점 상세 — 기온·노점·스프레드 추이 · 안개 위험 구간 · 일별 범위 · 시간대 프로파일 */
export function TempPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeTempDetail(recs, win), [recs, win]);
  const openBucket = (i: number) => {
    const idx = d.buckets[i]?.idx[0];
    if (idx != null) onOpenRaw(idx);
  };
  const isRaw = d.unit === 'raw';
  const fewPts = d.xs.length <= 120;
  const bandColor = `rgba(200,135,28,${FOG_BAND_ALPHA[d.unit]})`;
  const bands = d.bands.map((b) => ({ ...b, color: bandColor }));
  const bandLabel = isRaw ? `안개 위험 구간 (스프레드 ≤ ${FOG_SPREAD_C}°C)` : `안개 위험 전문 포함 구간 (${UNIT_LABEL[d.unit]} 단위)`;

  // 툴팁: 기온 · 노점 · 스프레드 (+ 집계 건수)
  const mainTip = (i: number) => {
    const b = d.buckets[i];
    const rows: { name: string; color: string; v: number | null }[] = [
      { name: '기온', color: C_TEMP, v: d.tVals[i] },
      { name: '노점', color: C_DP, v: d.dpVals[i] },
      { name: isRaw ? '스프레드' : '스프레드(최소)', color: C_SPREAD, v: d.spVals[i] },
    ];
    return (
      <>
        {rows.map((r) => (
          <div key={r.name} className="tchart__tip-row">
            <span className="tchart__tip-sw" style={{ background: r.color }} />
            <span className="tchart__tip-name">{r.name}</span>
            <span className="tchart__tip-val">{r.v == null ? '—' : fmtC(r.v)}</span>
          </div>
        ))}
        {b && !isRaw && <div className="tchart__tip-note">{b.recs.length ? `${b.recs.length}건 평균` : '전문 없음'}</div>}
        {b && isRaw && d.spVals[i] != null && (d.spVals[i] as number) <= FOG_SPREAD_C && <div className="tchart__tip-note" style={{ color: C_FOG_TEXT }}>안개 위험 (스프레드 ≤ {FOG_SPREAD_C}°C)</div>}
      </>
    );
  };

  // 시간대 프로파일 툴팁: 기온 · 노점 · 평균 스프레드 · 건수
  const hourTip = (h: number) => {
    const rows: { name: string; color: string; v: number | null }[] = [
      { name: '평균 기온', color: C_TEMP, v: d.hourT[h] },
      { name: '평균 노점', color: C_DP, v: d.hourDp[h] },
      { name: '평균 스프레드', color: C_SPREAD, v: d.hourSpread[h] },
    ];
    return (
      <>
        {rows.map((r) => (
          <div key={r.name} className="tchart__tip-row">
            <span className="tchart__tip-sw" style={{ background: r.color }} />
            <span className="tchart__tip-name">{r.name}</span>
            <span className="tchart__tip-val">{r.v == null ? '—' : fmtC(r.v)}</span>
          </div>
        ))}
        <div className="tchart__tip-note">{d.hourN[h] ? `${d.hourN[h]}건 · 안개 위험 ${d.hourFog[h]}건` : '전문 없음'}</div>
      </>
    );
  };

  const eventCols: Column<FogEvent>[] = [
    { key: 'span', label: '시작 ~ 종료', mono: true, render: (e) => `${fmtDayHM(e.startTs)} ~ ${fmtDayHM(e.untilTs)}` },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (e) => (e.durMs > 0 ? fmtDur(e.durMs) : '—') },
    { key: 'n', label: '전문', align: 'right', mono: true, render: (e) => `${e.n}건` },
    {
      key: 'sp',
      label: '최소 스프레드',
      align: 'right',
      mono: true,
      render: (e) => (
        <span style={{ color: C_FOG_TEXT, fontWeight: 700 }}>
          {fmtC(e.spreadMin, 0)} <span style={{ color: 'inherit', fontWeight: 500, opacity: 0.75 }}>({e.tAt}/{e.dpAt})</span>
        </span>
      ),
    },
    { key: 'vis', label: '당시 최저 시정', align: 'right', mono: true, render: (e) => e.visTxt },
    {
      key: 'tags',
      label: '기상',
      render: (e) =>
        e.tags.length ? (
          <span className="tags" style={{ gap: 4 }}>
            {e.tags.map((t) => (
              <span key={t} className="tag" style={{ padding: '1px 6px', fontSize: 11 }}>
                {t}
              </span>
            ))}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  const dailyRange = d.daily.map((x) => {
    const same = x.tMax === x.tMin;
    return {
      label: x.label,
      lo: same ? x.tMin - 0.25 : x.tMin,
      value: same ? x.tMax + 0.25 : x.tMax,
      color: 'rgba(180,69,28,0.7)',
      title: `${x.label} · 최저 ${x.tMin}°C ~ 최고 ${x.tMax}°C`,
      note: (
        <>
          평균 기온 {fmtNum(x.tMean)}°C · 평균 노점 {fmtNum(x.dpMean)}°C
          <br />
          최소 스프레드 {x.spreadMin}°C · {x.n}건
        </>
      ),
    };
  });
  const openDailyMax = (i: number) => {
    const x = d.daily[i];
    if (x) onOpenRaw(x.tMaxIndex);
  };
  const openDailySpreadMin = (i: number) => {
    const x = d.daily[i];
    if (x) onOpenRaw(x.spreadMinIndex);
  };
  const hourFogMax = d.hourFog.reduce((m, v) => Math.max(m, v), 0);
  // y 범위: 정수 눈금이 상단 단위 라벨과 겹치지 않도록 상한을 반칸 띄움
  const dailyLo = Math.floor(d.tMin - 1);
  const dailyHi = Math.ceil(d.tMax + 1) + 0.5;

  return (
    <>
      <StatTiles
        tiles={[
          { label: '평균 기온', value: fmtC(d.tAvg), accent: true, sub: `${recs.length.toLocaleString()}건 평균` },
          { label: '최고 기온', value: fmtC(d.tMax, 0), sub: fmtDayHM(d.tMaxAt), color: C_TEMP },
          { label: '최저 기온', value: fmtC(d.tMin, 0), sub: fmtDayHM(d.tMinAt) },
          { label: '평균 노점', value: fmtC(d.dpAvg), sub: `평균 스프레드 ${fmtC(d.spreadAvg)}` },
          { label: '최소 스프레드', value: fmtC(d.spreadMin, 0), sub: fmtDayHM(d.spreadMinAt), color: d.fogRisk ? C_FOG_TEXT : undefined },
          {
            label: '안개 위험 시간',
            value: `${d.fogHours}시간`,
            sub: d.fogCount ? `${d.fogCount}건 (${d.fogPct}%) · ${d.fogEvents.length}구간 · 지속 ${fmtDur(d.fogTotalMs)}` : `스프레드 ≤ ${FOG_SPREAD_C}°C 없음`,
            color: d.fogCount ? C_FOG_TEXT : undefined,
          },
          { label: '현재 스프레드', value: fmtC(d.spreadNow, 0), sub: `마지막 전문 ${fmtDayHM(d.lastTs)}`, color: Number.isFinite(d.spreadNow) && d.spreadNow <= FOG_SPREAD_C ? C_FOG_TEXT : undefined },
        ]}
      />

      <Section
        title="기온 / 노점 추이"
        sub={`°C · 해상도 ${UNIT_LABEL[d.unit]}`}
        right={
          <>
            <Legend color={C_TEMP} label="기온" />
            <Legend color={C_DP} label="노점" />
            <Legend kind="sq" color={C_FOG_BAND} label={bandLabel} />
          </>
        }
      >
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={[
            { name: '기온', color: C_TEMP, values: d.tVals, format: (v) => fmtNum(v) },
            { name: '노점', color: C_DP, values: d.dpVals, format: (v) => fmtNum(v) },
            ...(fewPts
              ? [
                  { name: '기온·', color: C_TEMP, values: d.tVals, dots: true, hideTip: true },
                  { name: '노점·', color: C_DP, values: d.dpVals, dots: true, hideTip: true },
                ]
              : []),
          ]}
          bands={bands}
          unit=" °C"
          height={240}
          onPointClick={openBucket}
          tooltip={mainTip}
        />
        <div className="card__head" style={{ marginTop: 2 }}>
          <span className="card__title" style={{ fontSize: 12.5 }}>
            스프레드 (기온 − 노점)<small> · {isRaw ? '전문별' : '구간 최소'}</small>
          </span>
          <Legend color={C_SPREAD} label="스프레드" />
          <Legend kind="dash" label={`안개 위험 기준 ${FOG_SPREAD_C}°C`} />
        </div>
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={[
            { name: isRaw ? '스프레드' : '스프레드(최소)', color: C_SPREAD, values: d.spVals, area: true, step: isRaw, format: (v) => fmtNum(v) },
            ...(fewPts ? [{ name: '스프레드·', color: C_SPREAD, values: d.spVals, dots: true, hideTip: true }] : []),
          ]}
          thresholds={[{ y: FOG_SPREAD_C, color: '#b8770a' }]}
          bands={bands}
          yMin={0}
          unit=" °C"
          height={150}
          yTicks={4}
          onPointClick={openBucket}
        />
        <span className="dsection__note">
          점을 클릭하면 해당 시각 원문을 엽니다{!isRaw ? ' (집계 구간의 첫 전문)' : ''}. 안개 위험 구간은 스프레드 ≤ {FOG_SPREAD_C}°C인 연속 전문을 병합한 것으로, 통계 카드의 "안개 위험 구간 감지" 배지와 같은 기준입니다.
        </span>
      </Section>

      <div className="dgrid-2">
        <Section title="일별 기온 범위" sub="°C · 최저 ~ 최고 (막대) · 평균·스프레드 (툴팁) · 클릭 → 원문">
          <BarChart items={dailyRange} yMin={dailyLo} yMax={dailyHi} yFormat={(v) => fmtNum(v, 0)} height={200} onBarClick={openDailyMax} />
        </Section>
        <Section
          title="시간대별 평균 기온 · 노점"
          sub="°C · UTC 시각별 평균 (일변화)"
          right={
            <>
              <Legend color={C_TEMP} label="기온" />
              <Legend color={C_DP} label="노점" />
            </>
          }
        >
          <TimeSeriesChart
            xs={HOUR_XS}
            xDomain={[0, 23 * HOUR]}
            series={[
              { name: '기온', color: C_TEMP, values: d.hourT },
              { name: '노점', color: C_DP, values: d.hourDp },
              { name: '기온·', color: C_TEMP, values: d.hourT, dots: true, hideTip: true },
              { name: '노점·', color: C_DP, values: d.hourDp, dots: true, hideTip: true },
            ]}
            height={200}
            titleFormat={hourTitle}
            tooltip={hourTip}
          />
        </Section>
      </div>

      <div className="dgrid-2">
        <Section title="시간대별 안개 위험 건수" sub={`UTC 시각별 스프레드 ≤ ${FOG_SPREAD_C}°C 전문 수`}>
          <BarChart
            items={d.hourFog.map((v, h) => ({ label: HOUR_LABELS[h], value: v, title: `${HOUR_LABELS[h]}:00Z`, note: d.hourN[h] ? `전문 ${d.hourN[h]}건 중 ${v}건 (${Math.round((v / d.hourN[h]) * 100)}%)` : '전문 없음' }))}
            color="rgba(200,135,28,0.8)"
            unit="건"
            yMax={Math.max(hourFogMax, 4) * 1.05}
            yFormat={fmtInt}
            height={180}
            labelEvery={3}
          />
        </Section>
        <Section title="일별 안개 위험 시간" sub={`스프레드 ≤ ${FOG_SPREAD_C}°C 전문이 있던 UTC 시간대 수 · 클릭 → 원문`}>
          <BarChart
            items={d.daily.map((x) => ({ label: x.label, value: x.fogHours, title: x.label, note: `최소 스프레드 ${x.spreadMin}°C · ${x.n}건` }))}
            color="rgba(200,135,28,0.8)"
            unit="시간"
            yMax={d.daily.reduce((m, x) => Math.max(m, x.fogHours), 4) * 1.05}
            yFormat={fmtInt}
            height={180}
            onBarClick={openDailySpreadMin}
          />
        </Section>
      </div>

      <Section title="안개 위험 구간" sub={`스프레드 ≤ ${FOG_SPREAD_C}°C 연속 전문 병합 · 클릭 → 원문`}>
        <DetailTable columns={eventCols} rows={d.fogEvents} rowKey={(e) => e.start} onRowClick={(e) => onOpenRaw(e.spreadMinIndex)} emptyText="기간 내 안개 위험 구간(스프레드 ≤ 2°C)이 없습니다." />
        <span className="dsection__note">
          종료 시각은 구간 마지막 전문의 다음 전문 발행 시각(수신 공백이 길면 최대 +1시간, 다음 전문이 없으면 +30분 또는 창 끝)이며, 지속 시간도 같은 기준입니다. 최소 스프레드 괄호는 당시 기온/노점(°C), 행 클릭 시 최소 스프레드 전문을 엽니다. 스프레드가 작을수록 포화에 가까워 안개·박무 발생 가능성이 높습니다.
        </span>
      </Section>
    </>
  );
}
