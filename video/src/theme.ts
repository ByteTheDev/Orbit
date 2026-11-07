import { Easing } from "remotion";

export const theme = {
  colors: {
    bg: "#09090b",
    bgAlt: "#141416",
    primary: "#d97757", // hero (claude terracotta) — at most one element per frame
    accent: "#e4e4e7",
    text: "#f4f4f5",
    textDim: "#a1a1aa",
    textFaint: "#71717a",
    glow: "rgba(217, 119, 87, 0.45)",
    border: "#27272a",
  },
  fonts: {
    display: "Space Grotesk",
    body: "Inter",
    mono: "JetBrains Mono",
  },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
  },
} as const;