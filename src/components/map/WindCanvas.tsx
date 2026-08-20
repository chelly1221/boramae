import { useEffect, useRef } from 'react';
import { windColorRgb } from '../../data/stats';

interface Props {
  /** 풍향(도, 바람이 불어오는 방향) */
  dir: number;
  /** 풍속(KT) */
  spd: number;
  visible: boolean;
  /** 항공사진 위: 더 밝고 진한 궤적 */
  bright: boolean;
}

/** "r,g,b" 문자열을 흰색 쪽으로 t만큼 섞는다 */
function lighten(rgb: string, t: number) {
  return rgb
    .split(',')
    .map((c) => Math.round(Number(c) + (255 - Number(c)) * t))
    .join(',');
}

interface Particle {
  x: number;
  y: number;
  life: number;
  ph: number;
}

/** 프레임당 목표값으로 다가가는 비율 (60fps 기준 약 0.6초에 95% 수렴) */
const EASE = 0.08;

/** Windy 스타일 바람 파티클 오버레이 (design/map.html 이식). 풍향·풍속은 전문이 바뀔 때 목표값으로 부드럽게 수렴한다. */
export function WindCanvas({ dir, spd, visible, bright }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wind = useRef({ dir, spd, bright });
  wind.current = { dir, spd, bright };
  /** 현재(보간 중인) 풍향·풍속 */
  const cur = useRef({ dir, spd });

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let parts: Particle[] = [];
    let raf = 0;

    const spawn = (): Particle => ({ x: Math.random() * W, y: Math.random() * H, life: 50 + Math.random() * 90, ph: Math.random() * 6.28 });
    const resize = () => {
      W = cv.width = cv.clientWidth;
      H = cv.height = cv.clientHeight;
      parts = Array.from({ length: Math.min(900, Math.round((W * H) / 5500)) }, spawn);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    const tick = () => {
      const { dir: tDir, spd: tSpd, bright } = wind.current;
      const c = cur.current;
      // 풍향은 최단 각도로, 풍속은 선형으로 수렴
      const dd = ((tDir - c.dir + 540) % 360) - 180;
      c.dir = (c.dir + dd * EASE + 360) % 360;
      c.spd += (tSpd - c.spd) * EASE;
      if (Math.abs(dd) < 0.05) c.dir = tDir;
      if (Math.abs(tSpd - c.spd) < 0.02) c.spd = tSpd;
      const dir = c.dir;
      const spd = c.spd;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = bright ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.075)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      const h = ((dir + 180) * Math.PI) / 180;
      const v = 0.45 + spd * 0.16;
      const dx = Math.sin(h);
      const dy = -Math.cos(h);
      ctx.lineWidth = (bright ? 1.5 : 1.2) + spd * 0.07;
      ctx.lineCap = 'round';
      const rgb = windColorRgb(spd);
      ctx.strokeStyle = bright ? `rgba(${lighten(rgb, 0.3)},0.9)` : `rgba(${rgb},0.6)`;
      for (const p of parts) {
        p.ph += 0.05;
        const wob = Math.sin(p.ph) * 0.28;
        const nx = p.x + (dx - dy * wob) * v;
        const ny = p.y + (dy + dx * wob) * v;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        p.x = nx;
        p.y = ny;
        if (--p.life <= 0 || p.x < -12 || p.x > W + 12 || p.y < -12 || p.y > H + 12) Object.assign(p, spawn());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="mapview__wind" style={{ display: visible ? '' : 'none' }} />;
}
