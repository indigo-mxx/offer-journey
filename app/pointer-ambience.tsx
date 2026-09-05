"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
};

type Ripple = { x: number; y: number; radius: number; life: number; maxLife: number };

const PALETTE: Array<[number, number, number]> = [
  [224, 178, 101],
  [206, 128, 84],
  [100, 166, 132],
  [241, 213, 157],
];

export function PointerAmbience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!canvas || !finePointer.matches || reducedMotion.matches || window.innerWidth <= 720) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;

    const particles: Particle[] = [];
    const ripples: Ripple[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 3;
    let glowX = targetX;
    let glowY = targetY;
    let previousX = targetX;
    let previousY = targetY;
    let travelled = 0;
    let glowOpacity = 0;
    let pointerPresent = false;
    let frame = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const addParticle = (x: number, y: number, speedX: number, speedY: number, burst = false) => {
      const angle = Math.random() * Math.PI * 2;
      const scatter = burst ? 1.2 + Math.random() * 2.8 : .3 + Math.random() * 1.15;
      const inherited = burst ? 0 : .055;
      const maxLife = burst ? 56 + Math.random() * 40 : 42 + Math.random() * 38;
      particles.push({
        x: x + (Math.random() - .5) * 8,
        y: y + (Math.random() - .5) * 8,
        vx: Math.cos(angle) * scatter + speedX * inherited,
        vy: Math.sin(angle) * scatter + speedY * inherited - (burst ? .3 : .08),
        life: maxLife,
        maxLife,
        size: burst ? 1.8 + Math.random() * 3.1 : 1 + Math.random() * 2.35,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      });
      if (particles.length > 180) particles.splice(0, particles.length - 180);
    };

    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      targetX = event.clientX;
      targetY = event.clientY;
      pointerPresent = true;
      const dx = targetX - previousX;
      const dy = targetY - previousY;
      const distance = Math.hypot(dx, dy);
      travelled += distance;
      if (distance > 2) {
        const count = Math.min(6, Math.max(2, Math.round(distance / 8)));
        for (let index = 0; index < count; index += 1) addParticle(targetX, targetY, dx, dy);
      }
      if (travelled > 92) {
        ripples.push({ x: targetX, y: targetY, radius: 5, life: 34, maxLife: 34 });
        travelled = 0;
      }
      previousX = targetX;
      previousY = targetY;
      wake();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      for (let index = 0; index < 32; index += 1) addParticle(event.clientX, event.clientY, 0, 0, true);
      ripples.push({ x: event.clientX, y: event.clientY, radius: 7, life: 48, maxLife: 48 });
      wake();
    };

    const onPointerLeave = () => { pointerPresent = false; wake(); };

    function draw() {
      frame = 0;
      ctx.clearRect(0, 0, width, height);
      glowX += (targetX - glowX) * .2;
      glowY += (targetY - glowY) * .2;
      glowOpacity += ((pointerPresent ? 1 : 0) - glowOpacity) * .11;

      if (glowOpacity > .01) {
        const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, 190);
        glow.addColorStop(0, `rgba(250, 215, 145, ${.34 * glowOpacity})`);
        glow.addColorStop(.18, `rgba(220, 157, 88, ${.2 * glowOpacity})`);
        glow.addColorStop(.52, `rgba(75, 137, 107, ${.11 * glowOpacity})`);
        glow.addColorStop(1, "rgba(30, 76, 58, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(glowX - 190, glowY - 190, 380, 380);
      }

      ctx.globalCompositeOperation = "lighter";
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.life -= 1;
        if (particle.life <= 0) { particles.splice(index, 1); continue; }
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= .965;
        particle.vy = particle.vy * .965 + .008;
        const progress = particle.life / particle.maxLife;
        const alpha = Math.sin(progress * Math.PI) * .9;
        const [red, green, blue] = particle.color;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        ctx.shadowColor = `rgba(${red}, ${green}, ${blue}, ${alpha * .8})`;
        ctx.shadowBlur = 12;
        ctx.arc(particle.x, particle.y, particle.size * (.55 + progress * .65), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        ripple.life -= 1;
        if (ripple.life <= 0) { ripples.splice(index, 1); continue; }
        const progress = 1 - ripple.life / ripple.maxLife;
        ripple.radius += 1.55;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(232, 185, 105, ${(1 - progress) * .52})`;
        ctx.lineWidth = 1.55;
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      if (particles.length || ripples.length || glowOpacity > .01 || pointerPresent) {
        frame = window.requestAnimationFrame(draw);
      }
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-ambience" aria-hidden="true" />;
}
