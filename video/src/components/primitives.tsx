import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import { theme } from "../theme";

export const Entrance: React.FC<{ delay?: number; children: React.ReactNode; y?: number; scale?: number }> =
  ({ delay = 0, children, y = 40, scale = 0.94 }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });
    return (
      <div style={{
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [y, 0])}px) scale(${interpolate(p, [0, 1], [scale, 1])})`,
      }}>{children}</div>
    );
  };

export const WordReveal: React.FC<{ text: string; delay?: number; per?: number; style?: React.CSSProperties; color?: string }> =
  ({ text, delay = 0, per = 3, style, color }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.26em", ...style }}>
        {text.split(" ").map((word, i) => {
          const p = spring({ frame: frame - delay - i * per, fps, config: theme.spring.snappy });
          return (
            <span key={i} style={{ display: "inline-block", opacity: p, color: color ?? "inherit",
              transform: `translateY(${interpolate(p, [0, 1], [30, 0])}px)` }}>{word}</span>
          );
        })}
      </div>
    );
  };

export const Counter: React.FC<{ target: number; delay?: number; suffix?: string; decimals?: number; style?: React.CSSProperties }> =
  ({ target, delay = 0, suffix = "", decimals = 0, style }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const p = spring({ frame: frame - delay, fps, config: { damping: 30, stiffness: 60 } });
    const v = interpolate(p, [0, 1], [0, target]);
    return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{v.toFixed(decimals)}{suffix}</span>;
  };

export const Spark: React.FC<{ size?: number; delay?: number }> = ({ size = 160, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rays = 12;
  const containerP = spring({ frame: frame - delay, fps, config: theme.spring.bouncy });
  const rot = interpolate(containerP, [0, 1], [-120, 0], { easing: theme.ease.out });
  return (
    <div style={{ width: size, height: size, position: "relative",
      transform: `scale(${containerP}) rotate(${rot}deg)`,
      filter: `drop-shadow(0 0 ${size * 0.25}px ${theme.colors.glow})` }}>
      {Array.from({ length: rays }).map((_, i) => {
        const p = spring({ frame: frame - delay - i * 1.2, fps, config: theme.spring.snappy });
        return <div key={i} style={{ position: "absolute", left: "50%", top: "50%",
          width: size * 0.085, height: size * 0.46 * p, background: theme.colors.primary,
          borderRadius: size, transformOrigin: "50% 0%",
          transform: `translateX(-50%) rotate(${(360 / rays) * i}deg) translateY(${size * 0.07}px)` }}/>;
      })}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.22, height: size * 0.22,
        borderRadius: "50%", background: theme.colors.text, transform: "translate(-50%, -50%)" }}/>
    </div>
  );
};