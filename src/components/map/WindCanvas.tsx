import { useEffect, useRef } from 'react';
import { windColorRgb } from '../../data/stats';

interface Props {
  /** 풍향(도, 바람이 불어오는 방향) */
  dir: number;
  /** 풍속(KT) */
  spd: number;
  visible: boolean;
}

interface Particle {
  x: number;
  y: number;
  life: number;
  ph: number;
}

/** Windy 스타일 바람 파티클 오버레이 (design/map.html 이식) */
export function WindCanvas({ dir, spd, visible }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wind = useRef({ dir, spd });
  wind.current = { dir, spd };

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
      const { dir, spd } = wind.current;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.075)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      const h = ((dir + 180) * Math.PI) / 180;
      const v = 0.45 + spd * 0.16;
      const dx = Math.sin(h);
      const dy = -Math.cos(h);
      ctx.lineWidth = 1.2 + spd * 0.07;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(${windColorRgb(spd)},0.6)`;
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
