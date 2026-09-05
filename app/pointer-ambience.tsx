"use client";

import { useEffect, useRef } from "react";

import { ENCOURAGEMENT_LINES } from "./encouragement-lines";

type Particle = {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
  rotation: number;
  rotationSpeed: number;
  shape: "orb" | "spark";
};

type Ripple = { x: number; y: number; radius: number; life: number; maxLife: number };

type FloatingText = {
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  fontSize: number;
  color: [number, number, number];
  rotation: number;
};

const PALETTE: Array<[number, number, number]> = [
  [224, 178, 101],
  [206, 128, 84],
  [100, 166, 132],
  [241, 213, 157],
];

export function PointerAmbience({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glowElement = glowRef.current;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!canvas || !glowElement || !enabled || !finePointer.matches || reducedMotion.matches || window.innerWidth <= 720) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;

    const particles: Particle[] = [];
    const ripples: Ripple[] = [];
    const floatingTexts: FloatingText[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 3;
    let previousX = targetX;
    let previousY = targetY;
    let hasPointerSample = false;
    let travelled = 0;
    let frame = 0;
    let pointerFrame = 0;
    let lastTextBurstAt = 0;
    let lastPhraseIndex = -1;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const addParticle = (x: number, y: number, speedX: number, speedY: number, burst = false) => {
      const angle = Math.random() * Math.PI * 2;
      const scatter = burst ? 1.2 + Math.random() * 2.8 : .3 + Math.random() * 1.15;
      const inherited = burst ? 0 : .025;
      const maxLife = burst ? 44 + Math.random() * 28 : 30 + Math.random() * 28;
      const particleX = x + (Math.random() - .5) * 8;
      const particleY = y + (Math.random() - .5) * 8;
      particles.push({
        x: particleX,
        y: particleY,
        previousX: particleX,
        previousY: particleY,
        vx: Math.cos(angle) * scatter + speedX * inherited,
        vy: Math.sin(angle) * scatter + speedY * inherited - (burst ? .3 : .08),
        life: maxLife,
        maxLife,
        size: burst ? 1.7 + Math.random() * 2.7 : 1 + Math.random() * 1.9,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        rotation: Math.random() * Math.PI,
        rotationSpeed: (Math.random() - .5) * .14,
        shape: Math.random() < (burst ? .36 : .18) ? "spark" : "orb",
      });
      if (particles.length > 100) particles.splice(0, particles.length - 100);
    };

    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };

    const addTextBurst = (x: number, y: number) => {
      const now = performance.now();
      if (now - lastTextBurstAt < 90) return;
      lastTextBurstAt = now;
      let phraseIndex = Math.floor(Math.random() * ENCOURAGEMENT_LINES.length);
      if (phraseIndex === lastPhraseIndex) phraseIndex = (phraseIndex + 1) % ENCOURAGEMENT_LINES.length;
      lastPhraseIndex = phraseIndex;
      const maxLife = 70 + Math.random() * 18;
      floatingTexts.push({
        text: ENCOURAGEMENT_LINES[phraseIndex],
        x: x + (Math.random() - .5) * 24,
        y: y - 9,
        vx: (Math.random() - .5) * .7,
        vy: -.72 - Math.random() * .48,
        life: maxLife,
        maxLife,
        fontSize: 11.5 + Math.random() * 2,
        color: Math.random() < .58 ? PALETTE[0] : PALETTE[2],
        rotation: (Math.random() - .5) * .08,
      });
      if (floatingTexts.length > 6) floatingTexts.splice(0, floatingTexts.length - 6);
    };

    const renderPointerInput = () => {
      pointerFrame = 0;
      glowElement.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
      glowElement.style.opacity = "1";
      if (!hasPointerSample) {
        previousX = targetX;
        previousY = targetY;
        hasPointerSample = true;
      }
      const dx = targetX - previousX;
      const dy = targetY - previousY;
      const distance = Math.hypot(dx, dy);
      travelled += distance;
      if (distance > 4) {
        const count = Math.min(5, Math.max(1, Math.round(distance / 13)));
        for (let index = 1; index <= count; index += 1) {
          const progress = index / count;
          addParticle(previousX + dx * progress, previousY + dy * progress, dx / count, dy / count);
        }
      }
      if (travelled > 92) {
        ripples.push({ x: targetX, y: targetY, radius: 4, life: 26, maxLife: 26 });
        travelled = 0;
      }
      previousX = targetX;
      previousY = targetY;
      wake();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      targetX = event.clientX;
      targetY = event.clientY;
      if (!pointerFrame) pointerFrame = window.requestAnimationFrame(renderPointerInput);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      targetX = event.clientX;
      targetY = event.clientY;
      previousX = targetX;
      previousY = targetY;
      hasPointerSample = true;
      glowElement.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
      glowElement.style.opacity = "1";
      for (let index = 0; index < 18; index += 1) addParticle(event.clientX, event.clientY, 0, 0, true);
      ripples.push({ x: event.clientX, y: event.clientY, radius: 6, life: 34, maxLife: 34 });
      addTextBurst(event.clientX, event.clientY);
      wake();
    };

    const onPointerLeave = () => { glowElement.style.opacity = "0"; };

    function draw() {
      frame = 0;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.life -= 1;
        if (particle.life <= 0) { particles.splice(index, 1); continue; }
        particle.previousX = particle.x;
        particle.previousY = particle.y;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= .965;
        particle.vy = particle.vy * .965 + .008;
        particle.rotation += particle.rotationSpeed;
        const progress = particle.life / particle.maxLife;
        const shimmer = .76 + Math.sin(particle.life * .58) * .24;
        const alpha = Math.sin(progress * Math.PI) * .9 * shimmer;
        const [red, green, blue] = particle.color;
        const radius = particle.size * (.55 + progress * .65);

        ctx.beginPath();
        ctx.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${alpha * .42})`;
        ctx.lineWidth = Math.max(.55, radius * .52);
        ctx.lineCap = "round";
        ctx.moveTo(particle.previousX - particle.vx * 1.8, particle.previousY - particle.vy * 1.8);
        ctx.lineTo(particle.x, particle.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        if (particle.shape === "spark") {
          const outer = radius * 1.65;
          const inner = radius * .42;
          const point = (distance: number, angle: number) => ({
            x: particle.x + Math.cos(angle) * distance,
            y: particle.y + Math.sin(angle) * distance,
          });
          const points = [
            point(outer, particle.rotation - Math.PI / 2), point(inner, particle.rotation - Math.PI / 4),
            point(outer, particle.rotation), point(inner, particle.rotation + Math.PI / 4),
            point(outer, particle.rotation + Math.PI / 2), point(inner, particle.rotation + Math.PI * .75),
            point(outer, particle.rotation + Math.PI), point(inner, particle.rotation + Math.PI * 1.25),
          ];
          ctx.moveTo(points[0].x, points[0].y);
          for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) ctx.lineTo(points[pointIndex].x, points[pointIndex].y);
          ctx.closePath();
        } else {
          ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        ripple.life -= 1;
        if (ripple.life <= 0) { ripples.splice(index, 1); continue; }
        const progress = 1 - ripple.life / ripple.maxLife;
        ripple.radius += .95;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(232, 185, 105, ${(1 - progress) * .52})`;
        ctx.lineWidth = 1.25;
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      for (let index = floatingTexts.length - 1; index >= 0; index -= 1) {
        const floatingText = floatingTexts[index];
        floatingText.life -= 1;
        if (floatingText.life <= 0) { floatingTexts.splice(index, 1); continue; }
        floatingText.x += floatingText.vx;
        floatingText.y += floatingText.vy;
        floatingText.vx *= .985;
        floatingText.vy *= .987;
        const remaining = floatingText.life / floatingText.maxLife;
        const age = 1 - remaining;
        const alpha = Math.min(1, age * 8) * Math.min(1, remaining * 3.5) * .94;
        const scale = .88 + Math.min(age, .45) * .32;
        const [red, green, blue] = floatingText.color;
        ctx.save();
        ctx.translate(floatingText.x, floatingText.y);
        ctx.rotate(floatingText.rotation);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 ${floatingText.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = "rgba(13, 31, 23, .55)";
        ctx.strokeText(floatingText.text, 0, 0);
        ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        ctx.fillText(floatingText.text, 0, 0);
        ctx.restore();
      }

      if (particles.length || ripples.length || floatingTexts.length) {
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
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
      ctx.clearRect(0, 0, width, height);
      glowElement.style.opacity = "0";
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
    };
  }, [enabled]);

  return <><div ref={glowRef} className="pointer-glow" aria-hidden="true" /><canvas ref={canvasRef} className="pointer-ambience" aria-hidden="true" /></>;
}
