import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur, UNIT_LABEL } from '../../../data/detail/agg';
import {
  CLOUD_CAT_COLORS,
  CLOUD_CAT_LABEL,
  computeCloudDetail,
  LOW_CEIL_FT,
  VERY_LOW_CEIL_FT,
  type LowCeilEvent,
} from '../../../data/detail/cloud';
import { BarChart, HOUR_LABELS, TimeSeriesChart } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const C_CEIL = '#6b8cae';
const C_AMBER = '#b8770a';
const C_DANGER = '#c8422e';
const C_LOW_BAND = 'rgba(184,119,10,0.14)';

/** 구름 / 접근방식 상세 — 실링 추이 · 운량 구성 · 접근방식 비율 · 시간대별 CAVOK · 저실링 이벤트 */
export function CloudPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeCloudDetail(recs, win), [recs, win]);
  // 점 클릭 → 버킷의 최저 실링 전문 (실링 없으면 첫 전문)
  const openBucket = (i: number) => {
    const idx = d.tips[i]?.index;
    if (idx != null) onOpenRaw(idx);
  };
  const openComp = (i: number) => {
    const idx = d.comp[i]?.index;
    if (idx != null) onOpenRaw(idx);
  };
  const compLabel = d.compUnit === 'hour' ? '시간별' : '일별';
  const otherApps = d.appNames.filter((a) => a !== d.topApp && d.appCount[a] > 0);

  const lowCols: Column<LowCeilEvent>[] = [
    { key: 'start', label: '시작', mono: true, render: (e) => fmtDT(e.startTs) },
    { key: 'end', label: '종료', mono: true, render: (e) => fmtDT(e.endTs) },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (e) => (e.n > 1 ? fmtDur(e.durMs) : '단발') },
    { key: 'n', label: '전문', align: 'right', mono: true, render: (e) => `${e.n}건` },
    {
      key: 'min',
      label: '최저 실링',
      align: 'right',
      mono: true,
      render: (e) => <span style={{ color: e.minCeil < VERY_LOW_CEIL_FT ? C_DANGER : C_AMBER, fontWeight: 700 }}>{e.minCeil} FT</span>,
    },
    { key: 'cloud', label: '구름', mono: true, render: (e) => e.cloud },
    { key: 'vis', label: '당시 시정', align: 'right', mono: true, render: (e) => e.visTxt },
    { key: 'app', label: '접근', render: (e) => <span style={{ color: d.appColors[e.app], fontWeight: 700 }}>{e.app}</span> },
  ];

  return (
    <>
      <StatTiles
        tiles={[
          { label: 'CAVOK 비율', value: `${d.cavokPct}%`, sub: `${d.cavokCount.toLocaleString()}건 / ${d.n.toLocaleString()}건`, accent: true },
          { label: 'BKN 이상 (실링 보고)', value: `${d.ceilCount.toLocaleString()}건`, sub: `전문의 ${d.ceilPct}%` },
          {
            label: '최저 실링',
            value: d.minCeil != null ? `${d.minCeil} FT` : '—',
            sub: d.minCeilAt != null ? fmtDayHM(d.minCeilAt) : '실링 보고 없음',
            color: d.minCeil != null && d.minCeil < LOW_CEIL_FT ? (d.minCeil < VERY_LOW_CEIL_FT ? C_DANGER : C_AMBER) : undefined,
          },
          { label: '평균 실링', value: d.meanCeil != null ? `${d.meanCeil.toLocaleString()} FT` : '—', sub: d.ceilCount ? `실링 보고 ${d.ceilCount.toLocaleString()}건 기준` : '실링 보고 없음' },
          {
            label: `저실링 <${LOW_CEIL_FT}FT`,
            value: `${d.lowCount.toLocaleString()}건`,
            sub: d.lowEvents.length ? `${d.lowEvents.length}회 · ${d.lowDurMs > 0 ? `총 ${fmtDur(d.lowDurMs)}` : '단발 보고'}` : `전문의 ${d.lowPct}%`,
            color: d.lowCount ? C_AMBER : undefined,
          },
          {
            label: 'CB 보고',
            value: `${d.cbCount.toLocaleString()}건`,
            sub: d.vvCount ? `VV/차폐 ${d.vvCount.toLocaleString()}건` : 'VV/차폐 보고 없음',
            color: d.cbCount ? C_DANGER : undefined,
          },
          {
            label: '접근방식',
            value: (
              <span style={{ color: d.appColors[d.topApp] }}>
                {d.topApp} {d.appPct[d.topApp]}%
              </span>
            ),
            sub: otherApps.length ? otherApps.map((a) => `${a} ${d.appPct[a]}%`).join(' · ') : '기간 내 단일 접근 명칭',
          },
          {
            label: '기간 마지막',
            value: d.last ? d.last.cloud : '—',
            sub: d.last ? `${d.last.app} · ${fmtDayHM(d.last.ts)}` : undefined,
          },
        ]}
      />

      <Section
        title="실링 추이"
        sub={`FT · 버킷 최저 실링 · 해상도 ${UNIT_LABEL[d.unit]}`}
        right={
          <>
            <Legend color={C_CEIL} label="실링 (BKN 이상)" />
            <Legend kind="dash" label={`${LOW_CEIL_FT}FT`} />
            <span className="legend">
              <span className="legend__dash" style={{ borderTopColor: C_DANGER }} />
              {VERY_LOW_CEIL_FT}FT
            </span>
            {d.unit !== 'day' && d.lowBands.length > 0 && <Legend kind="sq" color={C_LOW_BAND} label="저실링 구간" />}
          </>
        }
      >
        {d.ceilCount ? (
          <>
            <TimeSeriesChart
              xs={d.xs}
              xDomain={[win.from, win.to]}
              series={[
                { name: '실링', color: C_CEIL, values: d.ceilValues, step: d.unit === 'raw', width: 2, format: (v) => `${Math.round(v)}` },
                { name: '실링(단발)', color: C_CEIL, values: d.ceilIsolated, dots: true, hideTip: true },
              ]}
              thresholds={[
                { y: LOW_CEIL_FT, color: C_AMBER, label: `${LOW_CEIL_FT}FT` },
                { y: VERY_LOW_CEIL_FT, color: C_DANGER, label: `${VERY_LOW_CEIL_FT}FT` },
              ]}
              bands={d.unit !== 'day' ? d.lowBands.map((b) => ({ ...b, color: C_LOW_BAND })) : []}
              yMin={0}
              yMax={Math.max(LOW_CEIL_FT, d.maxCeil ?? 0) * 1.12}
              unit=" FT"
              height={240}
              onPointClick={openBucket}
              tooltip={(i) => {
                const t = d.tips[i];
                if (!t) return null;
                return (
                  <>
                    <div className="tchart__tip-row">
                      <span className="tchart__tip-sw" style={{ background: C_CEIL }} />
                      <span className="tchart__tip-name">{d.unit === 'raw' ? '실링' : '최저 실링'}</span>
                      <span className="tchart__tip-val">{t.ceil != null ? `${t.ceil} FT` : '없음'}</span>
                    </div>
                    {d.unit === 'raw' ? (
                      <div className="tchart__tip-note">
                        {t.cloud} · {t.app} 접근 · 시정 {t.visTxt}
                      </div>
                    ) : (
                      <div className="tchart__tip-note">
                        {t.n}건 · CAVOK {t.cavok}건 · 저실링 {t.low}건
                      </div>
                    )}
                  </>
                );
              }}
            />
            <span className="dsection__note">
              실링(BKN/OVC 운저 고도)이 없는 전문(CAVOK·FEW·SCT)은 선이 끊기고, 앞뒤에 실링이 없는 단발 보고는 점으로 표시합니다. 점을 클릭하면 해당 시각 원문을 엽니다{d.unit !== 'raw' ? ' (집계 구간의 최저 실링 전문)' : ''}.
            </span>
          </>
        ) : (
          <Empty>선택한 기간에 실링 보고(BKN 이상)가 없습니다 — CAVOK·SCT 등 실링 없는 전문만 수신되었습니다.</Empty>
        )}
      </Section>

      <div className="dgrid-2">
        <Section
          title={`${compLabel} 운량 구성`}
          sub="전문 건수"
          right={
            <>
              {d.catsPresent.map((c) => (
                <Legend key={c} kind="sq" color={CLOUD_CAT_COLORS[c]} label={CLOUD_CAT_LABEL[c]} />
              ))}
            </>
          }
        >
          <BarChart
            items={d.comp.map((c) => ({
              label: c.label,
              title: c.title,
              stack: d.catsPresent.map((cat) => ({ name: CLOUD_CAT_LABEL[cat], value: c.cats[cat], color: CLOUD_CAT_COLORS[cat] })),
              note: c.n ? `총 ${c.n}건` : '전문 없음',
            }))}
            yMax={Math.max(4.4, d.compMax * 1.08)}
            unit="건"
            yFormat={(v) => String(Math.round(v))}
            height={200}
            onBarClick={openComp}
          />
          <span className="dsection__note">구름 코드 앞 3자(FEW/SCT/BKN/OVC) 기준, 실링 {LOW_CEIL_FT}FT 미만은 저실링으로 분리. 막대 클릭 → 해당 구간 첫 원문.</span>
        </Section>
        <Section
          title={`${compLabel} 접근방식 비율`}
          sub={`${d.appNames.join(' / ')} · %`}
          right={
            <>
              {d.appNames.map((a) => (
                <Legend key={a} kind="sq" color={d.appColors[a]} label={a} />
              ))}
            </>
          }
        >
          <BarChart
            items={d.comp.map((c) => ({
              label: c.label,
              title: c.title,
              stack: d.appNames.map((a) => ({ name: a, value: c.n ? ((c.apps[a] ?? 0) / c.n) * 100 : 0, color: d.appColors[a] })),
              note: c.n ? `총 ${c.n}건 · ${d.appNames.map((a) => `${a} ${c.apps[a] ?? 0}`).join(' / ')}` : '전문 없음',
            }))}
            yMax={105}
            unit="%"
            yFormat={(v) => String(Math.round(v))}
            height={200}
            onBarClick={openComp}
          />
        </Section>
      </div>

      <div className="dgrid-2">
        <Section title="시간대별 CAVOK 비율" sub="UTC 시각별 CAVOK 전문 비율 (%)">
          <BarChart
            items={d.hourCavokPct.map((v, h) => ({
              label: HOUR_LABELS[h],
              value: v ?? 0,
              color: 'rgba(107,140,174,0.7)',
              title: `${HOUR_LABELS[h]}:00Z`,
              note: d.hourTotal[h] ? `CAVOK ${d.hourCavok[h]} / ${d.hourTotal[h]}건 · 저실링 ${d.hourLow[h]}건` : '전문 없음',
            }))}
            yMax={105}
            unit="%"
            yFormat={(v) => String(Math.round(v))}
            height={200}
            labelEvery={3}
          />
        </Section>
        <Section title="구름 코드 빈도" sub="보고 건수 상위 10 · 클릭 → 마지막 보고 원문">
          <BarChart
            items={d.codeFreq.map((c) => ({
              label: c.code,
              value: c.n,
              color: CLOUD_CAT_COLORS[c.cat],
              title: c.code,
              note: `${c.pct}% · ${CLOUD_CAT_LABEL[c.cat]}`,
            }))}
            yMax={Math.max(4.4, (d.codeFreq[0]?.n ?? 0) * 1.12)}
            unit="건"
            yFormat={(v) => String(Math.round(v))}
            height={200}
            showValues
            labelMinPx={52}
            onBarClick={(i) => onOpenRaw(d.codeFreq[i].index)}
          />
        </Section>
      </div>

      <Section title="저실링 이벤트" sub={`실링 < ${LOW_CEIL_FT}FT 연속 구간 · 클릭 → 최저 실링 원문`}>
        <DetailTable columns={lowCols} rows={d.lowEvents} rowKey={(e) => e.start} onRowClick={(e) => onOpenRaw(e.minIndex)} emptyText={`기간 내 실링 ${LOW_CEIL_FT}FT 미만 보고가 없습니다.`} />
        <span className="dsection__note">
          CAVOK 비율 = cloud가 CAVOK인 전문 비율, BKN 이상 = 실링(운저 고도)이 보고된 전문(BKN/OVC/VV) 건수 — 통계 카드와 동일 정의. 저실링은 실링 {LOW_CEIL_FT}FT 미만, 연속 전문을 한 구간으로 병합(지속 = 첫~마지막 전문 시각 차).
          접근방식 비율은 전문에 기재된 접근 명칭("EXPECT ILS RWY32R APPROACH"의 ILS / ILS Z 등) 기준으로 기간 내 등장한 명칭만 표시. CB 보고 = 구름층에 CB가 붙은 전문, VV/차폐 = 수직시정(VERTICAL VISIBILITY) 또는 SKY OBSCURED 전문.
        </span>
      </Section>
    </>
  );
}
