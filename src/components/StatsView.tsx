import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { areaPts, BIRD_COLOR, type Stats } from '../data/stats';
import type { DetailKey, HeatRow } from '../data/types';
import { IconChevronRight } from './icons';

interface Props {
  stats: Stats;
  heatRows: HeatRow[];
  xwLimit: number;
  /** 현재 기간 레코드 인덱스의 원문 열기 */
  onOpenRaw: (index: number) => void;
  /** 히트맵(최근 7일) 레코드 인덱스의 원문 열기 */
  onOpenHeatRaw: (index: number) => void;
  onOpenRawAtHour: (hour: number) => void;
  /** 카드 클릭 → 상세 페이지 */
  onOpenDetail: (key: DetailKey) => void;
}

const HOUR_AXIS = ['00시', '06시', '12시', '18시', '23시'];

function Stat({ label, value, color, lg }: { label: string; value: string; color?: string; lg?: boolean }) {
  return (
    <div className={`stat${lg ? ' stat--lg' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

/** 상세 페이지로 이동하는 카드 — 우상단 화살표 + hover 강조. 내부 클릭 요소는 stopPropagation. */
function LinkCard({
  detail,
  onOpen,
  children,
  className,
  style,
}: {
  detail: DetailKey;
  onOpen: (k: DetailKey) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`card card--link${className ? ' ' + className : ''}`} style={style} onClick={() => onOpen(detail)} title="클릭하여 상세 보기">
      {children}
      <span className="card__go">
        <IconChevronRight />
      </span>
    </div>
  );
}

function Kpi({ label, value, detail, onOpen }: { label: string; value: string; detail: DetailKey; onOpen: (k: DetailKey) => void }) {
  return (
    <LinkCard detail={detail} onOpen={onOpen} className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
    </LinkCard>
  );
}

const GridLines = ({ mid = true }: { mid?: boolean }) => (
  <>
    <line x1="10" y1="120" x2="550" y2="120" stroke="rgba(50,30,20,0.1)" />
    {mid && (
      <>
        <line x1="10" y1="65" x2="550" y2="65" stroke="rgba(50,30,20,0.06)" />
        <line x1="10" y1="10" x2="550" y2="10" stroke="rgba(50,30,20,0.06)" />
      </>
    )}
  </>
);

const stop = (e: MouseEvent) => e.stopPropagation();

export function StatsView({ stats: s, heatRows, xwLimit, onOpenRaw, onOpenHeatRaw, onOpenRawAtHour, onOpenDetail }: Props) {
  return (
    <div className="stats">
      {/* KPI */}
      <div className="grid-4">
        <Kpi label="총 수신 전문" value={`${s.total.toLocaleString()}건`} detail="update" onOpen={onOpenDetail} />
        <Kpi label="평균 발행 간격" value={s.interval} detail="update" onOpen={onOpenDetail} />
        <Kpi label="최다 사용 활주로" value={s.topRwy} detail="runway" onOpen={onOpenDetail} />
        <Kpi label="평균 QNH" value={`${s.avgQnh} hPa`} detail="qnh" onOpen={onOpenDetail} />
      </div>

      <div className="grid-2">
        {/* 온도/노점 */}
        <LinkCard detail="temp" onOpen={onOpenDetail}>
          <div className="card__head">
            <span className="card__title">온도 / 노점 추이 · 스프레드</span>
            <span className="legend">
              <span className="legend__line" style={{ background: '#b4451c' }} />
              온도
            </span>
            <span className="legend">
              <span className="legend__line" style={{ background: '#8c7a6e' }} />
              노점
            </span>
          </div>
          <svg viewBox="0 0 560 130" preserveAspectRatio="none" className="chart" style={{ height: 110 }}>
            <GridLines />
            <polyline points={s.dpPts} fill="none" stroke="#8c7a6e" strokeWidth="2" />
            <polyline points={s.tempPts} fill="none" stroke="#b4451c" strokeWidth="2" />
          </svg>
          <div className="stat-row">
            <Stat label="현재 스프레드" value={`${s.spreadNow}°C`} />
            <Stat label="최소 스프레드" value={`${s.spreadMin}°C`} />
            {s.fogRisk && <span className="badge-amber">안개 위험 구간 감지</span>}
          </div>
        </LinkCard>

        {/* 바람 */}
        <LinkCard detail="wind" onOpen={onOpenDetail} style={{ gap: 6 }}>
          <span className="card__title">바람</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <svg width="176" height="176" viewBox="0 0 200 200" style={{ flexShrink: 0 }}>
              {[26, 52, 78].map((r) => (
                <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgba(50,30,20,0.08)" />
              ))}
              <path d={s.roseD[0]} fill="rgba(127,13,0,0.28)" />
              <path d={s.roseD[1]} fill="rgba(127,13,0,0.58)" />
              <path d={s.roseD[2]} fill="#7f0d00" />
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
            <div className="rose-legend">
              <span className="rose-legend__item">
                <span className="legend__sq" style={{ background: 'rgba(127,13,0,0.28)' }} />
                &lt; 8KT
              </span>
              <span className="rose-legend__item">
                <span className="legend__sq" style={{ background: 'rgba(127,13,0,0.58)' }} />
                8–13KT
              </span>
              <span className="rose-legend__item">
                <span className="legend__sq" style={{ background: '#7f0d00' }} />≥ 14KT
              </span>
              <span className="rose-legend__dom">
                주풍 {s.domDir} · {s.domPct}%
              </span>
            </div>
          </div>
        </LinkCard>
      </div>

      <div className="grid-2">
        {/* 측풍/배풍 */}
        <LinkCard detail="xwind" onOpen={onOpenDetail}>
          <div className="card__head">
            <span className="card__title">
              측풍 / 배풍 성분 <small>· 사용 활주로 기준</small>
            </span>
            <span className="legend">
              <span className="legend__line" style={{ background: '#7f0d00' }} />
              측풍
            </span>
            <span className="legend">
              <span className="legend__dash" />
              한계 {xwLimit}KT
            </span>
          </div>
          <svg viewBox="0 0 560 130" preserveAspectRatio="none" className="chart" style={{ height: 110 }}>
            <GridLines mid={false} />
            <polygon points={areaPts(s.xwPts)} fill="rgba(127,13,0,0.07)" />
            <polyline points={s.xwPts} fill="none" stroke="#7f0d00" strokeWidth="2" />
            <line x1="10" y1={s.thY} x2="550" y2={s.thY} stroke="#b8770a" strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>
          <div className="stat-row">
            <Stat label="최대 측풍" value={`${s.maxXw}KT`} />
            <Stat label="한계 초과" value={`${s.xwExceed}건`} color={s.xwExceed > 0 ? '#b4451c' : undefined} />
            <Stat label="최대 배풍" value={`${s.maxTw}KT`} />
          </div>
        </LinkCard>

        {/* 활주로: 비율 + 전환 타임라인 */}
        <div className="rwy-col">
          <LinkCard detail="runway" onOpen={onOpenDetail}>
            <span className="card__title">활주로 사용 비율</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="hbar">
                <span className="hbar__label">32L/32R</span>
                <div className="hbar__track">
                  <div className="hbar__fill" style={{ background: '#7f0d00', width: `${s.p32}%` }} />
                </div>
                <span className="hbar__pct">{s.p32}%</span>
              </div>
              <div className="hbar">
                <span className="hbar__label">14L/14R</span>
                <div className="hbar__track">
                  <div className="hbar__fill" style={{ background: '#8c7a6e', width: `${s.p14}%` }} />
                </div>
                <span className="hbar__pct">{s.p14}%</span>
              </div>
            </div>
          </LinkCard>
          <LinkCard detail="runway" onOpen={onOpenDetail}>
            <span className="card__title">활주로 전환 이벤트</span>
            <div className="timeline">
              <div className="timeline__track" />
              {s.rwyEvents.map((e) => (
                <div
                  key={e.index}
                  className="timeline__ev"
                  style={{ left: `${e.leftPct.toFixed(1)}%` }}
                  onClick={(ev) => {
                    stop(ev);
                    onOpenRaw(e.index);
                  }}
                >
                  <span className="timeline__time">{e.time}</span>
                  <div className="timeline__dot" />
                  <span className="timeline__label">{e.label}</span>
                  <span className="timeline__wind">{e.wind}</span>
                </div>
              ))}
            </div>
            <div className="axis-labels">
              <span>{s.firstTime}</span>
              <span>{s.lastTime}</span>
            </div>
          </LinkCard>
        </div>
      </div>

      {/* 히트맵 */}
      <LinkCard detail="heat" onOpen={onOpenDetail}>
        <div className="card__head" style={{ gap: 14 }}>
          <span className="card__title">
            시간대별 기상 히트맵 <small>· 최근 7일 × 24시간 (UTC)</small>
          </span>
          <span className="legend">
            <span className="legend__sq" style={{ background: '#c8871c' }} />
            시정 저하 / 안개
          </span>
          <span className="legend">
            <span className="legend__sq" style={{ background: '#6b8cae' }} />
            강수
          </span>
          <span className="legend">
            <span className="legend__sq" style={{ background: '#7f0d00' }} />
            활주로 전환
          </span>
        </div>
        <div className="heat">
          {heatRows.map((row) => (
            <div key={row.dayTs} className="heat__row">
              <span className="heat__day">{row.day}</span>
              {row.cells.map((c) => (
                <div
                  key={c.ts}
                  className="heat__cell"
                  title={c.title}
                  style={{ background: c.bg }}
                  onClick={(ev) => {
                    if (c.index == null) return;
                    stop(ev);
                    onOpenHeatRaw(c.index);
                  }}
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
        <span className="card__note">03–06시 구간에 시정 저하가 반복 — 새벽 안개 패턴</span>
      </LinkCard>

      <div className="grid-2">
        {/* 갱신 빈도 */}
        <LinkCard detail="update" onOpen={onOpenDetail}>
          <div className="card__head" style={{ gap: 0 }}>
            <span className="card__title">
              정보문자 갱신 빈도 <small>· 시간당 발행 횟수 (일평균)</small>
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted-55)' }}>
              최다 {s.maxUpd}회/시 · <span style={{ color: '#b4451c', fontWeight: 700 }}>■</span> 임시 갱신 포함
            </span>
          </div>
          <div className="upd-bars">
            {s.updBars.map((u) => (
              <div
                key={u.hour}
                className="upd-bars__bar"
                title={`${String(u.hour).padStart(2, '0')}시 · ${u.count}회`}
                style={{ height: `${u.heightPct}%`, background: u.temp ? '#b4451c' : 'rgba(127,13,0,0.4)' }}
                onClick={(ev) => {
                  stop(ev);
                  onOpenRawAtHour(u.hour);
                }}
              />
            ))}
          </div>
          <div className="axis-labels">
            {HOUR_AXIS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </LinkCard>

        {/* 구름 / 접근방식 */}
        <LinkCard detail="cloud" onOpen={onOpenDetail} style={{ gap: 12 }}>
          <span className="card__title">구름 / 접근방식</span>
          <div style={{ display: 'flex', gap: 20 }}>
            <Stat label="CAVOK 비율" value={`${s.cavokPct}%`} />
            <Stat label="최저 실링" value={s.minCeil != null ? `${s.minCeil}FT` : '—'} />
            <Stat label="BKN 이상" value={`${s.bknCount}건`} />
          </div>
          <div className="divider-top" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {s.appBars.map((a) => (
              <div key={a.name} className="hbar hbar--sm">
                <span className="hbar__label">{a.name}</span>
                <div className="hbar__track">
                  <div className="hbar__fill" style={{ background: a.fill, width: `${a.pct}%` }} />
                </div>
                <span className="hbar__pct">{a.pct}%</span>
              </div>
            ))}
          </div>
        </LinkCard>
      </div>

      <div className="grid-2">
        {/* QNH */}
        <LinkCard detail="qnh" onOpen={onOpenDetail}>
          <div className="card__head">
            <span className="card__title">
              QNH 추이 <small>· hPa</small>
            </span>
            <span className="legend">
              <span className="legend__line" style={{ background: '#6b8cae' }} />
              해면기압
            </span>
          </div>
          <svg viewBox="0 0 560 130" preserveAspectRatio="none" className="chart" style={{ height: 82 }}>
            <GridLines />
            <polygon points={areaPts(s.qnhPts)} fill="rgba(107,140,174,0.1)" />
            <polyline points={s.qnhPts} fill="none" stroke="#6b8cae" strokeWidth="2" />
          </svg>
          <div className="stat-row">
            <Stat label="현재" value={`${s.qnhNow} hPa`} />
            <Stat label="최고" value={String(s.qnhMax)} />
            <Stat label="최저" value={String(s.qnhMin)} />
            <Stat label="변화 폭" value={`${s.qnhDelta} hPa`} />
          </div>
        </LinkCard>

        {/* 시정 / 특이기상 */}
        <LinkCard detail="vis" onOpen={onOpenDetail}>
          <span className="card__title">시정 / 특이기상</span>
          <div style={{ display: 'flex', gap: 20 }}>
            <Stat lg label="시정 저하" value={`${s.lowVisCount}건`} />
            <Stat lg label="최저 시정" value={s.minVis >= 1 ? `${s.minVis}KM` : `${Math.round(s.minVis * 1000)}M`} />
            <Stat lg label="TS/CB 보고" value={`${s.tsCount}건`} color="#b8770a" />
          </div>
        </LinkCard>
      </div>

      <div className="grid-2">
        {/* 기상 태그 */}
        <LinkCard detail="tags" onOpen={onOpenDetail}>
          <span className="card__title">
            기상현상 태그 빈도 <small>· 전문 remarks 토큰</small>
          </span>
          <div className="tags">
            {s.tagChips.length ? (
              s.tagChips.map((tg) => (
                <div key={tg.tag} className="tag">
                  <span className="tag__code">{tg.tag}</span>
                  <span className="tag__desc">{tg.desc}</span>
                  <span className="tag__n">{tg.n}</span>
                </div>
              ))
            ) : (
              <span className="card__note">기간 내 특이기상 태그 없음</span>
            )}
          </div>
        </LinkCard>

        {/* 조류 활동 */}
        <LinkCard detail="bird" onOpen={onOpenDetail}>
          <span className="card__title">
            조류 활동 <small>· BIRD ACTIVITY 보고</small>
          </span>
          <div style={{ display: 'flex', gap: 20 }}>
            <Stat lg label="보고 전문" value={`${s.bird.n}건`} />
            <Stat lg label="전문 대비" value={`${s.bird.pct}%`} />
            <Stat lg label="HVY 큰 무리" value={`${s.bird.hvy}건`} color={s.bird.hvy ? BIRD_COLOR.HVY : undefined} />
            <Stat lg label="최다 방위" value={s.bird.topDir ? s.bird.topDir.dir : '—'} />
          </div>
          <span className="card__note">
            {s.bird.last ? (
              <>
                마지막 보고 <b style={{ color: BIRD_COLOR[s.bird.last.kind] }}>{s.bird.last.head}</b> · {s.bird.last.time}
              </>
            ) : (
              '기간 내 조류 활동 보고 없음'
            )}
          </span>
        </LinkCard>
      </div>
    </div>
  );
}
