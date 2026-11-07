import React from "react";
import { AbsoluteFill } from "remotion";

// Clean premium backdrop: near-black with a single faint top light.
// No animated blobs, no grid, no particles here — those read "mystery drone"
// and were the biggest render tax. Depth comes from content, not background.
export const Bg: React.FC = () => (
  <AbsoluteFill style={{ background: "#060607", overflow: "hidden" }}>
    <div style={{ position: "absolute", inset: 0,
      background: "linear-gradient(180deg, #0a0a0c 0%, #060607 55%, #070708 100%)" }} />
    {/* faint top light */}
    <div style={{ position: "absolute", left: "50%", top: -320, width: 1400, height: 640,
      transform: "translateX(-50%)",
      background: "radial-gradient(ellipse at center, rgba(217,119,87,0.09), transparent 62%)" }} />
    {/* hairline floor */}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1,
      background: "linear-gradient(90deg, transparent, rgba(244,244,245,0.06), transparent)" }} />
  </AbsoluteFill>
);

export const Grade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.18), transparent 30%, transparent 70%, rgba(0,0,0,0.34))" }} />
  </AbsoluteFill>
);

export const Grain: React.FC = () => {
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")`;
  return <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: noise, backgroundSize: "160px", opacity: 0.04, mixBlendMode: "overlay" }} />;
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.42) 100%)" }} />
);
