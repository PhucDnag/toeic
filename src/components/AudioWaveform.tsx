'use client';

import { useEffect, useRef } from 'react';

interface AudioWaveformProps {
  audioLevel: number;
  isActive: boolean;
}

export default function AudioWaveform({ audioLevel, isActive }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const barsRef = useRef<number[]>(Array(40).fill(2));
  const levelRef = useRef(audioLevel);
  const activeRef = useRef(isActive);

  // Keep refs up to date without triggering canvas re-creation
  useEffect(() => {
    levelRef.current = audioLevel;
    activeRef.current = isActive;
  }, [audioLevel, isActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    const bars = barsRef.current;
    const numBars = bars.length;

    const animate = () => {
      if (!ctx || width === 0 || height === 0) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const currentLevel = levelRef.current;
      const currentActive = activeRef.current;
      const centerY = height / 2;
      const gap = 3;
      const barWidth = Math.max(2, (width - (numBars - 1) * gap) / numBars);

      for (let i = 0; i < numBars; i++) {
        // Curve factor: higher in the middle, lower at the edges
        const distFromCenter = Math.abs(i - (numBars - 1) / 2) / (numBars / 2);
        const curve = 1 - distFromCenter * 0.6;

        let targetHeight = 2;
        if (currentActive) {
          if (currentLevel > 0.02) {
            targetHeight = 3 + currentLevel * (height * 0.45) * curve + Math.sin(Date.now() / 80 + i) * (currentLevel * 4);
          } else {
            // Idle breathing animation when mic is active but no loud sound
            targetHeight = 2.5 + Math.sin(Date.now() / 400 + i * 0.3) * 1.5;
          }
        }

        // Clamp height
        targetHeight = Math.min(height * 0.45, Math.max(2, targetHeight));

        // Smooth interpolation
        bars[i] += (targetHeight - bars[i]) * 0.2;

        const h = Math.max(2, bars[i]);
        const x = i * (barWidth + gap);

        // Gradient
        const gradient = ctx.createLinearGradient(0, centerY - h, 0, centerY + h);
        if (currentActive && currentLevel > 0.05) {
          gradient.addColorStop(0, '#8b5cf6'); // violet
          gradient.addColorStop(0.5, '#6366f1'); // indigo
          gradient.addColorStop(1, '#3b82f6'); // blue
        } else if (currentActive) {
          gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.3)');
        } else {
          gradient.addColorStop(0, 'rgba(113, 113, 122, 0.2)');
          gradient.addColorStop(1, 'rgba(113, 113, 122, 0.1)');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, centerY - h, barWidth, h * 2, 2);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="relative w-full h-12 overflow-hidden rounded-lg bg-white/[0.01]">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}
