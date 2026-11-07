import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, random } from "remotion";
import { theme } from "../theme";

// Very faint dust — 10 dots max. The old 80-particle field read as static/noise
// and slowed renders. This version is barely-visible atmosphere.
export const Particles: React.FC<{ count?: number }> = ({ count = 10 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: count }).map((_, i) => {
        const seed = i * 97.31;
        const x = random(seed) * width;
        const yBase = random(seed + 1) * height;
        const y = (yBase + frame * 0.22) % height;
        const size = 1.2 + random(seed + 3) * 1.6;
        const tw = 0.35 + 0.35 * Math.sin((frame + seed) / 40);
        return (
          <div key={i} style={{
            position: "absolute", left: x, top: y, width: size, height: size,
            borderRadius: "50%", background: theme.colors.text, opacity: Math.max(0.05, tw) * 0.5,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

// Sparse stars for hero/payoff only. Fewer, smaller, slower than before.
export const Starfield: React.FC<{ count?: number }> = ({ count = 45 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cx = width / 2, cy = height / 2;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: count }).map((_, i) => {
        const seed = i * 131.7;
        const z = ((random(seed) * 1000) + frame * 1.1) % 1000;
        const depth = 1 - z / 1000;
        const angle = random(seed + 1) * Math.PI * 2;
        const baseR = random(seed + 2) * 600;
        const r = baseR * (0.2 + depth * 1.1);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.9;
        const size = 0.7 + depth * 1.6;
        return (
          <div key={i} style={{
            position: "absolute", left: x, top: y, width: size, height: size,
            borderRadius: "50%", background: theme.colors.text, opacity: 0.10 + depth * 0.45,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

// Clean entrance: y + blur + fade. No bouncy scale/rotation — that read amateur.
export const Rise: React.FC<{ delay?: number; children: React.ReactNode; y?: number }> = ({ delay = 0, children, y = 26 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
  const clamped = Math.max(0, Math.min(1, p));
  const yy = interpolate(clamped, [0, 1], [y, 0]);
  const blur = interpolate(clamped, [0, 1], [10, 0]);
  return (
    <div style={{ opacity: clamped, transform: `translateY(${yy}px)`, filter: blur > 0.2 ? `blur(${blur}px)` : undefined }}>
      {children}
    </div>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontFamily: theme.fonts.mono, fontSize: 15, letterSpacing: "0.28em",
    textTransform: "uppercase", color: theme.colors.textFaint,
  }}>{children}</div>
);

export const Flash: React.FC<{ opacity: number; color?: string }> = ({ opacity, color = "#ffffff" }) => {
  if (opacity <= 0.001) return null;
  return <AbsoluteFill style={{ pointerEvents: "none", background: color, opacity, mixBlendMode: "screen" }} />;
};
