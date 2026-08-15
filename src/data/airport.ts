/**
 * 김포국제공항(RKSS) 정밀 좌표 데이터.
 * 출처: BRA SUITE `config_BRA.js` / `facilityDB.xlsx` (공항 LIDAR 실측 기반, WGS84 도분초) — 2023.
 * 좌표는 원본 그대로 도·분·초로 적고 `dms()`로 변환한다.
 */
import type { Runway } from './types';

/** 도분초 → 십진도 */
const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

export interface GeoPoint {
  lat: number;
  lon: number;
  /** 표고 (m, MSL) */
  alt: number;
}

export interface RunwayEnd {
  /** 활주로 지정번호 (14L 등) */
  designator: string;
  /** 착륙 시단(THR) */
  thr: GeoPoint;
  /** 진방위 (°) — 이 방향으로 착륙/이륙 */
  heading: number;
}

export interface RunwayStrip {
  /** "14L/32R" */
  id: string;
  /** [14 방향 끝, 32 방향 끝] */
  ends: [RunwayEnd, RunwayEnd];
  /** m */
  length: number;
  /** m */
  width: number;
}

export type NavaidType = 'LOC' | 'GP' | 'VOR';

export interface Navaid {
  id: string;
  type: NavaidType;
  /** 식별부호 (IKMO 등) */
  ident: string;
  name: string;
  /** MHz */
  freq: number;
  pos: GeoPoint;
  /** LOC/GP: 착륙 코스 진방위 */
  course?: number;
  /** LOC/GP: 연결 활주로 시단 */
  runway?: string;
}

export const RKSS = {
  icao: 'RKSS',
  name: '김포국제공항',
  /** 공항 기준점 (ARP) */
  arp: { lat: dms(37, 33, 24.98), lon: dms(126, 47, 51), alt: 18 } satisfies GeoPoint,
  runways: [
    {
      id: '14L/32R',
      ends: [
        { designator: '14L', thr: { lat: dms(37, 34, 14.55), lon: dms(126, 46, 41.8), alt: 11.6 }, heading: 135 },
        { designator: '32R', thr: { lat: dms(37, 32, 51.89), lon: dms(126, 48, 25.58), alt: 12.8 }, heading: 315 },
      ],
      length: 3600,
      width: 45,
    },
    {
      id: '14R/32L',
      ends: [
        { designator: '14R', thr: { lat: dms(37, 34, 6.19), lon: dms(126, 46, 31.6), alt: 10.4 }, heading: 135 },
        { designator: '32L', thr: { lat: dms(37, 32, 52.83), lon: dms(126, 48, 3.71), alt: 12.6 }, heading: 315 },
      ],
      length: 3200,
      width: 60,
    },
  ] satisfies RunwayStrip[],
  navaids: [
    { id: 'LOC-32L', type: 'LOC', ident: 'IKMO', name: 'LOC 32L', freq: 108.3, pos: { lat: dms(37, 34, 13.37334), lon: dms(126, 46, 22.53835), alt: 13.06 }, course: 315.02, runway: '32L' },
    { id: 'LOC-14R', type: 'LOC', ident: 'IOFR', name: 'LOC 14R', freq: 108.7, pos: { lat: dms(37, 32, 45.48607), lon: dms(126, 48, 12.89242), alt: 15.3 }, course: 135, runway: '14R' },
    { id: 'LOC-14L', type: 'LOC', ident: 'ISEL', name: 'LOC 14L', freq: 109.9, pos: { lat: dms(37, 32, 44.5627), lon: dms(126, 48, 34.76705), alt: 15.31 }, course: 135.01, runway: '14L' },
    { id: 'LOC-32R', type: 'LOC', ident: 'ISKP', name: 'LOC 32R', freq: 110.7, pos: { lat: dms(37, 34, 21.75849), lon: dms(126, 46, 32.74821), alt: 13.91 }, course: 315.03, runway: '32R' },
    { id: 'VOR', type: 'VOR', ident: 'KIP', name: 'VOR/DME', freq: 113.6, pos: { lat: dms(37, 33, 27.11513), lon: dms(126, 47, 31.26002), alt: 17.94 } },
    { id: 'GP-14R', type: 'GP', ident: 'GP14R', name: 'GP 14R', freq: 330.5, pos: { lat: dms(37, 34, 1.77039), lon: dms(126, 46, 44.0232), alt: 9.39 }, course: 135, runway: '14R' },
    { id: 'GP-14L', type: 'GP', ident: 'GP14L', name: 'GP 14L', freq: 333.8, pos: { lat: dms(37, 34, 3.93374), lon: dms(126, 46, 48.20254), alt: 9.74 }, course: 135.01, runway: '14L' },
    { id: 'GP-32R', type: 'GP', ident: 'GP32R', name: 'GP 32R', freq: 330.2, pos: { lat: dms(37, 32, 56.36187), lon: dms(126, 48, 13.07397), alt: 11.88 }, course: 315.03, runway: '32R' },
    { id: 'GP-32L', type: 'GP', ident: 'GP32L', name: 'GP 32L', freq: 334.1, pos: { lat: dms(37, 32, 57.26064), lon: dms(126, 47, 51.23475), alt: 10.94 }, course: 315.02, runway: '32L' },
  ] satisfies Navaid[],
} as const;

/** ATIS 사용 활주로 그룹 → 착륙 진방위 (측풍/배풍 계산용) */
export const RUNWAY_TRUE_HEADING: Record<Runway, number> = { '32L/32R': 315, '14L/14R': 135 };

/** 사용 활주로 그룹의 방향 접두 ("32" | "14") */
export const runwayDirPrefix = (rwy: Runway) => rwy.slice(0, 2);

const NM = 1852;
const EARTH_R = 6371008.8;

/** 시작점에서 진방위 bearing(°)으로 dist(m) 이동한 점 (구면 근사) */
export function destination(from: { lat: number; lon: number }, bearingDeg: number, distM: number): { lat: number; lon: number } {
  const φ1 = (from.lat * Math.PI) / 180;
  const λ1 = (from.lon * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const δ = distM / EARTH_R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

export const nmToM = (nm: number) => nm * NM;
