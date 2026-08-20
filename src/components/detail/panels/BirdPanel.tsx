import { useMemo } from 'react';
import { fmtDayHM, fmtDT, fmtDur, fmtNum } from '../../../data/detail/agg';
import {
  BIRD_HOUR_UNIT_MAX_DAYS,
  BIRD_RUN_GAP_MS,
  BIRD_UNIT_LABEL,
  birdColorOf,
  computeBirdDetail,
  DAWN_DUSK_PATTERN_PCT,
  type BirdRun,
  type KindCount,
} from '../../../data/detail/bird';
import { countAxisMax } from '../../../data/detail/tags';
import { BIRD_KIND_LABEL } from '../../../data/stats';
import type { BirdKind } from '../../../data/types';
import { BarChart, HOUR_LABELS, withAlpha, type StackPart } from '../charts';
import { DetailTable, Empty, Legend, Section, StatTiles, type Column } from '../primitives';
import type { PanelProps } from './types';

const HOUR_AXIS = ['00시', '06시', '12시', '18시', '23시'];
const C_HVY = birdColorOf('HVY');
const C_LGT = birdColorOf('LGT');

/** 규모 배지 (색 점 + 코드) */
function Kind({ kind }: { kind: BirdKind }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: birdColorOf(kind), flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{kind}</span>
      <span style={{ opacity: 0.7 }}>{BIRD_KIND_LABEL[kind]}</span>
    </span>
  );
}

const durText = (r: BirdRun) => (r.n > 1 ? `${fmtDur(r.durMs)} · ${r.n}건` : '단발 (1건)');

/** HVY/LGT 누적 막대 조각 (0은 생략) */
const stackOf = (c: KindCount, unitLabel = '건'): StackPart[] =>
  [
    { name: `HVY 큰 무리`, value: c.hvy, color: C_HVY },
    { name: `LGT 작은 무리`, value: c.lgt, color: C_LGT },
  ].filter((p) => p.value > 0).map((p) => ({ ...p, name: `${p.name} (${unitLabel})` }));

/** 조류 활동 상세 — 보고 추이 · 방위/거리/시간대 분포 · 방위 × 시간대 · 활동 구간 */
export function BirdPanel({ recs, win, onOpenRaw }: PanelProps) {
  const d = useMemo(() => computeBirdDetail(recs, win), [recs, win]);
  const has = d.reported > 0;
  const intFmt = (v: number) => String(Math.round(v));
  const legend = (
    <>
      <Legend kind="sq" color={C_HVY} label="HVY 큰 무리" />
      <Legend kind="sq" color={C_LGT} label="LGT 작은 무리" />
    </>
  );

  const evCols: Column<BirdRun>[] = [
    { key: 'start', label: '시작', mono: true, render: (r) => fmtDT(r.startTs) },
    { key: 'end', label: '종료', mono: true, render: (r) => (r.n > 1 ? fmtDT(r.endTs) : '—') },
    { key: 'dur', label: '지속', align: 'right', mono: true, render: (r) => durText(r) },
    { key: 'kind', label: '최대 규모', render: (r) => <Kind kind={r.maxKind} /> },
    { key: 'heads', label: '보고 내용', mono: true, render: (r) => r.heads.join(' · ') },
    { key: 'nm', label: '최근접', align: 'right', mono: true, render: (r) => `${r.minNm}NM` },
    { key: 'wind', label: '시작 시 바람', mono: true, render: (r) => recs[r.start]?.wind ?? '—' },
  ];

  return (
    <>
      <StatTiles
        tiles={[
          { label: '조류 보고 전문', value: `${d.reported.toLocaleString()}건`, sub: `전문 ${d.n.toLocaleString()}건 중 ${d.reportedPct}%`, accent: true },
          { label: 'HVY(큰 무리) 포함', value: `${d.hvyRecs.toLocaleString()}건`, sub: d.reported ? `보고 전문의 ${Math.round((d.hvyRecs / d.reported) * 100)}%` : '보고 없음', color: d.hvyRecs ? C_HVY : undefined },
          { label: '보고 무리', value: `${d.flocks.total.toLocaleString()}건`, sub: d.flocks.total ? `HVY ${d.flocks.hvy} · LGT ${d.flocks.lgt}` : undefined },
          { label: '최다 방위', value: d.topDir ? d.topDir.dir : '—', sub: d.topDir ? `${d.topDir.total}건 · 무리의 ${d.topDir.pct}%` : '기간 내 보고 없음' },
          {
            label: '최근접 거리',
            value: d.nearest ? `${d.nearest.nm}NM` : '—',
            sub: d.nearest ? `${d.nearest.head.replace(' FLOCK', '')} · ${fmtDayHM(d.nearest.ts)}` : d.meanNm != null ? `평균 ${fmtNum(d.meanNm)}NM` : undefined,
          },
          { label: '활동 구간', value: `${d.events.length}회`, sub: d.events.length ? `총 ${fmtDur(d.totalDurMs)}` : undefined },
          {
            label: '최장 구간',
            value: d.longest ? (d.longest.n > 1 ? fmtDur(d.longest.durMs) : '단발') : '—',
            sub: d.longest ? `${fmtDayHM(d.longest.startTs)}~ · ${d.longest.maxKind}` : undefined,
            color: d.longest ? birdColorOf(d.longest.maxKind) : undefined,
          },
          {
            label: '마지막 보고',
            value: d.last ? `${d.last.nm}NM ${d.last.dir}` : '—',
            sub: d.last ? `${d.last.kind} ${BIRD_KIND_LABEL[d.last.kind]} · ${fmtDayHM(d.last.ts)}` : '기간 내 보고 없음',
            color: d.last ? birdColorOf(d.last.kind) : undefined,
          },
        ]}
      />

      <Section title="조류 활동 보고 추이" sub={`해상도 ${BIRD_UNIT_LABEL[d.unit]} · 보고 전문 수 (HVY 포함 / LGT만) · 막대 클릭 → 원문`} right={has ? legend : undefined}>
        {has ? (
          <>
            <div style={{ maxWidth: d.items.length < 12 ? Math.max(280, d.items.length * 64 + 60) : undefined }}>
              <BarChart
                items={d.items.map((it) => ({ label: it.label, title: it.title, stack: stackOf(it), note: it.total ? `보고 전문 ${it.total}건` : '보고 없음' }))}
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
            <span className="dsection__note">
              막대를 클릭하면 해당 구간의 조류 보고가 있는 첫 전문을 엽니다. 조회 기간이 {BIRD_HOUR_UNIT_MAX_DAYS}일 이하면 1시간, 초과면 1일 단위로 집계합니다.
            </span>
          </>
        ) : (
          <Empty>기간 내 조류 활동 보고가 없어 추이를 표시할 수 없습니다.</Empty>
        )}
      </Section>

      <div className="dgrid-2">
        <Section title="방위별 보고 분포" sub="ARP 기준 8방위 · 무리 단위 · 클릭 → 원문" right={has ? legend : undefined}>
          {has ? (
            <BarChart
              items={d.dirs.map((r) => ({ label: r.dir, title: `${r.dir} 방위`, stack: stackOf(r, '무리'), note: r.total ? `${r.total}건 · ${r.pct}%` : '보고 없음' }))}
              yMax={countAxisMax(Math.max(...d.dirs.map((r) => r.total)))}
              yFormat={intFmt}
              unit="건"
              height={210}
              onBarClick={(i) => {
                const idx = d.dirs[i]?.idx;
                if (idx != null) onOpenRaw(idx);
              }}
            />
          ) : (
            <Empty>기간 내 조류 활동 보고 없음</Empty>
          )}
          {d.topDir && (
            <span className="dsection__note">
              최다 방위 {d.topDir.dir} ({d.topDir.total}건, {d.topDir.pct}%){d.meanNm != null ? ` · 평균 보고 거리 ${fmtNum(d.meanNm)}NM` : ''}
            </span>
          )}
        </Section>
        <Section title="시간대별 보고 건수" sub="UTC 시각별 · 보고 전문 수 (HVY 포함 / LGT만)">
          {has ? (
            <BarChart
              items={HOUR_LABELS.map((h, i) => ({
                label: h,
                title: `${h}:00Z ~ ${h}:59Z`,
                stack: stackOf({ hvy: d.hourHvy[i], lgt: d.hourLgt[i], total: d.hourTotals[i] }),
                note: d.hourTotals[i] ? `보고 전문 ${d.hourTotals[i]}건` : '보고 없음',
              }))}
              yMax={countAxisMax(d.maxHourTotal)}
              yFormat={intFmt}
              unit="건"
              height={210}
              labelEvery={3}
            />
          ) : (
            <Empty>기간 내 조류 활동 보고 없음</Empty>
          )}
          {d.topHour && (
            <span className="dsection__note">
              {d.topHour.ties > 3
                ? `시간대별 최다 ${d.topHour.n}건 (${d.topHour.ties}개 시간대 동률)`
                : `보고 최다 시간대 ${HOUR_LABELS[d.topHour.hour]}Z${d.topHour.ties > 1 ? ` 외 ${d.topHour.ties - 1}곳 (각 ${d.topHour.n}건)` : ` (${d.topHour.n}건)`}`}
              {' · '}새벽(20–23Z) {d.dawnDusk.dawn}건 · 저녁(07–10Z) {d.dawnDusk.dusk}건 = {d.dawnDusk.pct}%
              {d.dawnDusk.pattern ? ` — 새벽·저녁 집중 패턴 (${DAWN_DUSK_PATTERN_PCT}% 이상)` : ''}
            </span>
          )}
        </Section>
      </div>

      <div className="dgrid-2">
        <Section title="거리별 분포" sub="ARP 기준 보고 거리 (NM) · 무리 단위" right={has ? legend : undefined}>
          {has ? (
            <BarChart
              items={d.dists.map((r) => ({ label: `${r.nm}NM`, title: `${r.nm}NM`, stack: stackOf(r, '무리'), note: r.total ? `${r.total}건` : '보고 없음' }))}
              yMax={countAxisMax(Math.max(...d.dists.map((r) => r.total)))}
              yFormat={intFmt}
              unit="건"
              height={200}
            />
          ) : (
            <Empty>기간 내 조류 활동 보고 없음</Empty>
          )}
          {d.nearest && (
            <span className="dsection__note">
              최근접 {d.nearest.nm}NM — {d.nearest.head} · {fmtDT(d.nearest.ts)}
            </span>
          )}
        </Section>
        <Section title="방위 × 시간대" sub="행: 방위 · 열: UTC 시각 · 농도 = 무리 건수 · 셀 클릭 → 원문">
          {has ? (
            <div className="heat">
              {d.dirs.map((row, k) => (
                <div key={row.dir} className="heat__row">
                  <span className="heat__day" style={{ fontFamily: 'var(--font-mono)' }}>
                    {row.dir}
                  </span>
                  {d.grid[k].map((cell, h) => (
                    <div
                      key={h}
                      className="heat__cell"
                      style={{
                        height: 18,
                        background: cell.n ? withAlpha(C_HVY, 0.18 + 0.82 * Math.min(1, cell.n / Math.max(1, d.maxCell))) : 'rgba(50,30,20,0.04)',
                        cursor: cell.idx != null ? 'pointer' : 'default',
                      }}
                      title={`${row.dir} · ${HOUR_LABELS[h]}Z · ${cell.n}건`}
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
            <Empty>기간 내 조류 활동 보고 없음</Empty>
          )}
          {has && <span className="dsection__note">전체 셀 최대 {d.maxCell}건 기준으로 농도를 정규화합니다.</span>}
        </Section>
      </div>

      <Section title="조류 활동 구간" sub={`연속 보고 구간 병합 (공백 ${BIRD_RUN_GAP_MS / 3600000}시간 초과 시 분리) · 시작 시각순 · ${d.events.length.toLocaleString()}건 · 클릭 → 시작 원문`}>
        <DetailTable columns={evCols} rows={d.events} rowKey={(r) => r.start} onRowClick={(r) => onOpenRaw(r.start)} emptyText="기간 내 조류 활동 구간이 없습니다." />
        <span className="dsection__note">
          정의: 조류 보고 전문은 remarks에 BIRD ACTIVITY 보고(HVY/LGT FLOCK · 거리 NM · ARP 기준 8방위)가 있는 전문이며, 무리 건수는 전문 1건 × 보고 무리 1건으로 셉니다(통계 카드와 동일). 활동 구간은 보고가
          연속 전문에서 이어지는 범위(수신 공백 {BIRD_RUN_GAP_MS / 3600000}시간 초과 시 분리)이고, 지속 시간은 시작·종료 전문의 시각 차입니다(정기 발행 간격 1시간 단위 근사). HVY = 큰 무리, LGT = 작은 무리.
        </span>
      </Section>
    </>
  );
}
