import { useMemo } from 'react';
import { DIR8, fmtDayHM, fmtDT, fmtDur, fmtNum, UNIT_LABEL } from '../../../data/detail/agg';
import { argMax, CALM_KT, chartYMax, computeWindDetail, fmtDir, MAX_BANDS, ROSE_BINS, STRONG_KT, type StrongWindEvent } from '../../../data/detail/wind';
import { windColor } from '../../../data/stats';
import { BarChart, HOUR_LABELS, TimeSeriesChart } from '../charts';
import { DetailTable, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_SPD = '#7f0d00';
const C_MAX = '#b4451c';
const C_DIR = '#8c7a6e';
const C_STRONG = '#c8422e';
const C_BAND = 'rgba(200,66,46,0.13)';
/** 풍향 차트 y 눈금(0·90·180·270·360°) 방위 라벨 */
const DIR_Q = ['N', 'E', 'S', 'W'];

/** 풍속 색(windColor) 스와치 — 숫자는 잉크색 유지, 색은 옆 점으로 */
function SpdSwatch({ spd }: { spd: number }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: windColor(spd), marginRight: 6, verticalAlign: '1px' }} />;
}

/** 바람 상세 — 풍속/풍향 추이 · 바람 · 16방위 빈도 · 시간대별 프로파일 · 풍속 등급 · 강풍 이벤트 */
export function WindPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeWindDetail(recs, win), [recs, win]);
  const openBucket = (i: number) => {
    const idx = d.buckets[i]?.idx[0];
    if (idx != null) onOpenRaw(idx);
  };
  const isRaw = d.unit === 'raw';
  const peakHour = argMax(d.hourSpd);
  const topDir16 = d.dir16.reduce((best, x) => (x.count > best.count ? x : best), d.dir16[0]);
  const topTies = topDir16 && topDir16.count > 0 ? d.dir16.filter((x) => x.count === topDir16.count).length : 0;
  // 강풍 띠: 구간이 너무 많으면(장기간) 차트가 붉은 줄무늬가 되므로 생략하고 표로 안내
  const showBands = d.bands.length > 0 && d.bands.length <= MAX_BANDS;
  const bands = showBands ? d.bands.map((b) => ({ from: b.from, to: b.to, color: C_BAND })) : [];

  const evCols: Column<StrongWindEvent>[] = [
    { key: 'start', label: '시작', mono: true, render: (e) => fmtDT(e.startTs) },
    { key: 'end', label: '종료', mono: true, render: (e) => (e.count > 1 ? fmtDT(e.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (e) => (e.count > 1 ? fmtDur(e.durMs) : '단발') },
    { key: 'n', label: '전문 수', align: 'right', mono: true, render: (e) => `${e.count}건` },
    {
      key: 'max',
      label: '최대 풍속',
      align: 'right',
      mono: true,
      render: (e) => (
        <span style={{ fontWeight: 700 }}>
          <SpdSwatch spd={e.maxSpd} />
          {e.maxSpd} KT
        </span>
      ),
    },
    { key: 'maxAt', label: '최대 시각', mono: true, render: (e) => fmtDayHM(e.maxTs) },
    { key: 'dir', label: '최대 시 풍향', mono: true, render: (e) => fmtDir(e.maxDir) },
    { key: 'mdir', label: '구간 평균 풍향', mono: true, render: (e) => fmtDir(e.meanDir) },
  ];

  return (
    <>
      <StatTiles
        tiles={[
          { label: '평균 풍속', value: `${fmtNum(d.avgSpd)} KT`, accent: true, sub: `${d.n.toLocaleString()}건` },
          {
            label: '최대 풍속',
            value: (
              <>
                <SpdSwatch spd={d.maxSpd} />
                {d.maxSpd} KT
              </>
            ),
            sub: `${fmtDayHM(d.maxAt)} · ${fmtDir(d.maxDir)}`,
          },
          { label: '주풍향 (8방위)', value: d.domDir, sub: `${d.domPct}% · 16방위 최다 ${topDir16?.label ?? '—'} ${topDir16?.pct ?? 0}%${topTies > 1 ? ` (${topTies}개 동률)` : ''}` },
          { label: '벡터 평균 풍향', value: fmtDir(d.vecDir), sub: '풍향 벡터 합의 방향' },
          { label: `정온 ≤${CALM_KT}KT`, value: `${d.calmPct}%`, sub: `${d.calmCount.toLocaleString()}건` },
          { label: `강풍 ≥${STRONG_KT}KT`, value: `${d.strongCount.toLocaleString()}건`, sub: `${d.strongPct}% · ${d.events.length}개 구간`, color: d.strongCount ? C_STRONG : undefined },
          { label: '기간 마지막', value: d.last, sub: d.n ? fmtDayHM(recs[d.lastIndex].ts) : undefined },
        ]}
      />

      <Section
        title="풍속 추이"
        sub={`KT · 해상도 ${UNIT_LABEL[d.unit]}`}
        right={
          <>
            <Legend color={C_SPD} label={isRaw ? '풍속' : '평균 풍속'} />
            {!isRaw && <Legend color={C_MAX} label="구간 최대" />}
            <Legend kind="dash" label={`강풍 ${STRONG_KT}KT`} />
            {showBands && <Legend kind="sq" color={C_BAND} label="강풍 구간" />}
          </>
        }
      >
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={[
            ...(!isRaw ? [{ name: '구간 최대', color: C_MAX, values: d.spdMax, dash: true, width: 1.2, format: (v: number) => fmtNum(v, 0) }] : []),
            { name: isRaw ? '풍속' : '평균 풍속', color: C_SPD, values: d.spd, area: true, format: (v: number) => fmtNum(v) },
            // 전문 1–2건이면 선이 안 보이므로 점 오버레이
            ...(isRaw && d.n <= 2 ? [{ name: '풍속(점)', color: C_SPD, values: d.spd, dots: true, hideTip: true }] : []),
          ]}
          thresholds={[{ y: STRONG_KT, color: '#b8770a', label: `강풍 ${STRONG_KT}KT` }]}
          bands={bands}
          yMin={0}
          yMax={d.yMaxSpd}
          unit=" KT"
          height={240}
          onPointClick={openBucket}
        />
        <span className="dsection__note">
          점을 클릭하면 해당 시각 원문을 엽니다{!isRaw ? ' (집계 구간의 첫 전문)' : ''}.{' '}
          {showBands
            ? `붉은 띠는 풍속 ${STRONG_KT}KT 이상이 이어진 구간입니다${!isRaw ? ' (같은 집계 구간의 이벤트는 하나로 병합)' : ''}.`
            : d.events.length > MAX_BANDS
              ? `강풍 구간이 ${d.events.length.toLocaleString()}개로 많아 띠 표시를 생략했습니다 — 아래 강풍 이벤트 표를 참고하세요.`
              : ''}
        </span>
      </Section>

      <Section title="풍향 추이" sub={`도(°) · 세로축 방위 N/E/S/W${!isRaw ? ' · 구간 벡터 평균' : ''}`} right={<Legend kind="sq" color={C_DIR} label="풍향" />}>
        <TimeSeriesChart
          xs={d.xs}
          xDomain={[win.from, win.to]}
          series={[{ name: '풍향', color: C_DIR, values: d.dirQ, dots: true, format: (v) => fmtDir(v * 90) }]}
          yMin={0}
          yMax={4}
          yTicks={4}
          yFormat={(v) => `${Math.round(v * 90)}° ${DIR_Q[Math.round(v) % 4]}`}
          padL={56}
          bands={bands}
          height={190}
          onPointClick={openBucket}
          tooltip={(i) => {
            const dv = d.dir[i];
            const sv = d.spd[i];
            return (
              <>
                <div className="tchart__tip-row">
                  <span className="tchart__tip-sw" style={{ background: C_DIR }} />
                  <span className="tchart__tip-name">풍향</span>
                  <span className="tchart__tip-val">{dv == null ? '—' : fmtDir(dv)}</span>
                </div>
                <div className="tchart__tip-row">
                  <span className="tchart__tip-sw" style={{ background: C_SPD }} />
                  <span className="tchart__tip-name">{isRaw ? '풍속' : '평균 풍속'}</span>
                  <span className="tchart__tip-val">{sv == null ? '—' : `${fmtNum(sv)} KT`}</span>
                </div>
              </>
            );
          }}
        />
        <span className="dsection__note">북풍 부근(0°↔360°)은 위·아래로 갈려 보일 수 있습니다. 세로 위치는 풍향(도), 점 하나가 전문 1건{!isRaw ? '(집계 구간)' : ''}입니다.</span>
      </Section>

      <div className="dgrid-2">
        <Section title="바람" sub="8방위 × 풍속 3구간 · 반경 = 빈도">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <svg width="216" height="216" viewBox="0 0 200 200" style={{ flexShrink: 0 }}>
              {[26, 52, 78].map((r) => (
                <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgba(50,30,20,0.08)" />
              ))}
              <path d={d.roseD[0]} fill={ROSE_BINS[0].color} />
              <path d={d.roseD[1]} fill={ROSE_BINS[1].color} />
              <path d={d.roseD[2]} fill={ROSE_BINS[2].color} />
              {(
                [
                  ['N', 100, 12],
                  ['E', 192, 104],
                  ['S', 100, 198],
                  ['W', 8, 104],
                ] as const
              ).map(([t, x, y]) => (
                <text key={t} x={x} y={y} textAnchor="middle" fontSize="11" fontWeight="700" fill="rgba(60,40,30,0.55)">
                  {t}
                </text>
              ))}
            </svg>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                {ROSE_BINS.map((b) => (
                  <Legend key={b.label} kind="sq" color={b.color} label={b.label} />
                ))}
              </div>
              {DIR8.map((lbl, i) => {
                const p = d.n ? (d.rose8[i] / d.n) * 100 : 0;
                return (
                  <div key={lbl} className="hbar hbar--sm">
                    <span className="hbar__label">{lbl}</span>
                    <div className="hbar__track">
                      <div className="hbar__fill" style={{ width: `${p ? Math.max(1.5, p) : 0}%`, background: lbl === d.domDir ? C_SPD : 'rgba(127,13,0,0.5)' }} />
                    </div>
                    <span className="hbar__pct">{Math.round(p)}%</span>
                  </div>
                );
              })}
              <span className="rose-legend__dom" style={{ marginTop: 2 }}>
                주풍 {d.domDir} · {d.domPct}% · 벡터 평균 {fmtDir(d.vecDir)}
              </span>
            </div>
          </div>
        </Section>
        <Section title="16방위 빈도" sub="풍향별 전문 비율 (%) · 툴팁에 평균 풍속">
          <BarChart
            items={d.dir16.map((x, i) => ({ label: x.label, value: x.pct, color: x.count > 0 && x.count === topDir16?.count ? C_SPD : 'rgba(127,13,0,0.55)', title: `${x.label} · ${fmtNum(i * 22.5)}° ±11.25°`, note: `${x.count.toLocaleString()}건 · 평균 ${Number.isFinite(x.avgSpd) ? fmtNum(x.avgSpd) : '—'} KT` }))}
            unit="%"
            yMax={chartYMax(topDir16 ? topDir16.pct * 1.05 : 1)}
            yFormat={(v) => String(Math.round(v))}
            height={200}
            labelEvery={1}
            labelMinPx={22}
          />
          <span className="dsection__note">막대 = 해당 16방위(±11.25°)에 속한 전문 비율. 최다 방위 {topDir16?.label ?? '—'}{topTies > 1 ? ` 외 ${topTies - 1}개(동률)` : ''} 강조.</span>
        </Section>
      </div>

      <div className="dgrid-2">
        <Section title="시간대별 평균 풍속" sub={`UTC 시각별 평균 (KT)${peakHour >= 0 ? ` · 최강 ${HOUR_LABELS[peakHour]}Z` : ''}`}>
          <BarChart
            items={d.hourSpd.map((v, h) => ({
              label: HOUR_LABELS[h],
              value: v ?? 0,
              color: v == null ? 'rgba(50,30,20,0.06)' : h === peakHour ? C_SPD : 'rgba(127,13,0,0.55)',
              title: `${HOUR_LABELS[h]}:00Z`,
              note: v == null ? '전문 없음' : `최대 ${d.hourMax[h] ?? '—'} KT`,
            }))}
            unit=" KT"
            yMax={chartYMax(peakHour >= 0 ? (d.hourSpd[peakHour] as number) * 1.05 : 1)}
            yFormat={(v) => fmtNum(v)}
            height={200}
            labelEvery={3}
          />
        </Section>
        <Section title="풍속 등급 분포" sub="전문 건수 · 비율">
          <BarChart
            items={d.classes.map((c) => ({ label: `${c.label} KT`, value: c.count, color: c.color, title: `${c.label} KT · ${c.desc}`, note: `${c.pct}%` }))}
            unit="건"
            yMax={chartYMax(Math.max(4, ...d.classes.map((c) => c.count)) * 1.12)}
            yFormat={(v) => String(Math.round(v))}
            height={200}
            labelEvery={1}
            showValues
          />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {d.classes.map((c) => (
              <Legend key={c.label} kind="sq" color={c.color} label={`${c.desc} ${c.label} · ${c.pct}%`} />
            ))}
          </div>
        </Section>
      </div>

      <Section title="강풍 이벤트" sub={`풍속 ≥ ${STRONG_KT}KT 연속 구간 · 클릭 → 최대 풍속 원문`}>
        <DetailTable columns={evCols} rows={d.events} rowKey={(e) => e.start} onRowClick={(e) => onOpenRaw(e.maxIndex)} emptyText={`기간 내 ${STRONG_KT}KT 이상 강풍이 없습니다.`} />
        <span className="dsection__note">
          연속 구간 = {STRONG_KT}KT 이상 전문이 끊기지 않고 이어진 범위(지속 = 첫 전문 ~ 마지막 전문 시각). 바람 구간(&lt;8 / 8–13 / ≥14KT)·주풍향은 통계 카드와 같은 정의이며, 정온은 {CALM_KT}KT 이하, 벡터 평균 풍향은 각 전문 풍향의 단위벡터 합 방향입니다.
        </span>
      </Section>
    </>
  );
}
