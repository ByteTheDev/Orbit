import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { BgMesh, Grade, Grain, Vignette } from "../components/layers";
import { Entrance, WordReveal, Spark } from "../components/primitives";
import { theme } from "../theme";

const Stack: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill>
    <BgMesh />
    {children}
    <Grade />
    <Grain />
    <Vignette />
  </AbsoluteFill>
);

// ---------- Scene 1: Hook ----------
const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sunP = spring({ frame, fps, config: theme.spring.bouncy });
  const ringRot = frame * 0.6;
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 360, height: 360 }}>
          {/* orbit ring */}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%",
            border: "1px solid rgba(244,244,245,0.12)",
            transform: `rotate(${ringRot}deg)` }}>
            {[0, 120, 240].map((a) => (
              <div key={a} style={{ position: "absolute", left: "50%", top: "50%",
                width: 14, height: 14, borderRadius: "50%", background: theme.colors.accent,
                transform: `rotate(${a}deg) translateX(180px) translate(-50%, -50%)`,
                boxShadow: `0 0 18px ${theme.colors.accent}88` }}/>
            ))}
          </div>
          {/* sun */}
          <div style={{ position: "absolute", left: "50%", top: "50%",
            width: 110 * sunP, height: 110 * sunP, borderRadius: "50%",
            background: `radial-gradient(circle, ${theme.colors.primary}, #7a3a22)`,
            transform: "translate(-50%, -50%)",
            boxShadow: `0 0 80px ${theme.colors.glow}, 0 0 160px ${theme.colors.glow}` }}/>
        </div>
        <div style={{ marginTop: 60, textAlign: "center" }}>
          <Entrance delay={12} y={30}>
            <div style={{ fontFamily: theme.fonts.display, fontSize: 150, fontWeight: 700,
              color: theme.colors.text, letterSpacing: "-0.03em", lineHeight: 1 }}>
              Orbit
            </div>
          </Entrance>
          <Entrance delay={24} y={20}>
            <div style={{ fontFamily: theme.fonts.body, fontSize: 34, fontWeight: 400,
              color: theme.colors.textDim, marginTop: 18, letterSpacing: "0.02em" }}>
              Orchestrate your coding agents.
            </div>
          </Entrance>
        </div>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Scene 2: Context ----------
const Context: React.FC = () => {
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40, flexDirection: "column" }}>
        <WordReveal text="Claude Code. Codex. One workspace." delay={0} per={4}
          style={{ fontFamily: theme.fonts.display, fontSize: 78, fontWeight: 600,
            color: theme.colors.text, letterSpacing: "-0.02em", justifyContent: "center" }} />
        <Entrance delay={24} y={20}>
          <div style={{ fontFamily: theme.fonts.body, fontSize: 30, color: theme.colors.textDim,
            maxWidth: 900, textAlign: "center", lineHeight: 1.4 }}>
            Run every agent your project needs, side by side, without losing the thread.
          </div>
        </Entrance>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Scene 3: Galaxy ----------
const GalaxyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const rot = frame * 0.4;
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 720, height: 720 }}>
          {[0, 1, 2].map((r) => (
            <div key={r} style={{ position: "absolute", inset: r * 90, borderRadius: "50%",
              border: `1px solid rgba(244,244,245,${0.12 - r * 0.03})`,
              transform: `rotate(${rot * (1 - r * 0.15)}deg)` }}>
              {[0, 1, 2, 3].slice(0, 4 - r).map((i, idx) => {
                const count = 4 - r;
                const angle = (360 / count) * i + frame * (0.3 + r * 0.1);
                const color = idx % 2 === 0 ? theme.colors.primary : theme.colors.accent;
                return (
                  <div key={i} style={{ position: "absolute", left: "50%", top: "50%",
                    width: 12, height: 12, borderRadius: "50%", background: color,
                    transform: `rotate(${angle}deg) translateX(${180 + r * 90}px) translate(-50%, -50%)`,
                    boxShadow: `0 0 14px ${color}88` }}/>
                );
              })}
            </div>
          ))}
          <div style={{ position: "absolute", left: "50%", top: "50%", width: 90, height: 90,
            borderRadius: "50%", background: `radial-gradient(circle, ${theme.colors.text}, #9a9aa0)`,
            transform: "translate(-50%, -50%)",
            boxShadow: `0 0 60px rgba(244,244,245,0.35)` }}/>
        </div>
        <Entrance delay={0} y={20}>
          <div style={{ position: "absolute", bottom: 120, left: 0, right: 0, textAlign: "center" }}>
            <div style={{ fontFamily: theme.fonts.display, fontSize: 56, fontWeight: 600,
              color: theme.colors.text, letterSpacing: "-0.02em" }}>
              Every project. Its own galaxy.
            </div>
            <div style={{ fontFamily: theme.fonts.body, fontSize: 26, color: theme.colors.textDim, marginTop: 12 }}>
              Projects are suns. Agents are planets. State is always visible.
            </div>
          </div>
        </Entrance>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Scene 4: Chat ----------
const ChatScene: React.FC = () => {
  const lines = [
    { who: "you", text: "Add a login flow to the app." },
    { who: "agent", text: "Reading the auth module…" },
    { who: "agent", text: "Writing src/auth/login.ts" },
    { who: "agent", text: "Running tests — 12 passed." },
  ];
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 80 }}>
        <Entrance delay={0} y={0} scale={1}>
          <div style={{ width: 520, height: 420, borderRadius: 20, background: theme.colors.bgAlt,
            border: `1px solid ${theme.colors.border}`, padding: 28,
            boxShadow: "0 40px 80px -20px rgba(0,0,0,0.6)" }}>
            <div style={{ fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.textFaint, marginBottom: 18 }}>
              inspector / chat
            </div>
            {lines.map((l, i) => (
              <Entrance key={i} delay={i * 12} y={12}>
                <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 8,
                    background: l.who === "you" ? theme.colors.text : theme.colors.primary,
                    flexShrink: 0 }}/>
                  <div style={{ fontFamily: theme.fonts.body, fontSize: 22,
                    color: l.who === "you" ? theme.colors.text : theme.colors.textDim,
                    lineHeight: 1.4 }}>{l.text}</div>
                </div>
              </Entrance>
            ))}
          </div>
        </Entrance>
        <div style={{ maxWidth: 560 }}>
          <WordReveal text="Talk to your agents." delay={0} per={4}
            style={{ fontFamily: theme.fonts.display, fontSize: 64, fontWeight: 600,
              color: theme.colors.text, letterSpacing: "-0.02em" }} />
          <Entrance delay={24} y={20}>
            <div style={{ fontFamily: theme.fonts.body, fontSize: 26, color: theme.colors.textDim, marginTop: 18, lineHeight: 1.4 }}>
              Full context, tool calls, and results — in one inspector.
            </div>
          </Entrance>
        </div>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Scene 5: Changes ----------
const ChangesScene: React.FC = () => {
  const files = ["src/auth/login.ts", "src/auth/session.ts", "tests/auth.test.ts"];
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 80 }}>
        <div style={{ maxWidth: 560 }}>
          <WordReveal text="Review every change." delay={0} per={4}
            style={{ fontFamily: theme.fonts.display, fontSize: 64, fontWeight: 600,
              color: theme.colors.text, letterSpacing: "-0.02em" }} />
          <Entrance delay={24} y={20}>
            <div style={{ fontFamily: theme.fonts.body, fontSize: 26, color: theme.colors.textDim, marginTop: 18, lineHeight: 1.4 }}>
              Staged, unstaged, diffed — before anything lands.
            </div>
          </Entrance>
        </div>
        <Entrance delay={0} y={0} scale={1}>
          <div style={{ width: 520, height: 420, borderRadius: 20, background: theme.colors.bgAlt,
            border: `1px solid ${theme.colors.border}`, padding: 28,
            boxShadow: "0 40px 80px -20px rgba(0,0,0,0.6)" }}>
            <div style={{ fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.textFaint, marginBottom: 18 }}>
              changes
            </div>
            {files.map((f, i) => (
              <Entrance key={i} delay={i * 10} y={10}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 0", borderBottom: `1px solid ${theme.colors.border}` }}>
                  <span style={{ fontFamily: theme.fonts.mono, fontSize: 18, color: theme.colors.text }}>{f}</span>
                  <span style={{ fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.primary }}>+42 -7</span>
                </div>
              </Entrance>
            ))}
            <Entrance delay={36} y={8}>
              <div style={{ marginTop: 22, display: "flex", gap: 12 }}>
                <div style={{ padding: "8px 16px", borderRadius: 8, background: theme.colors.primary,
                  color: "#fff", fontFamily: theme.fonts.body, fontSize: 16, fontWeight: 600 }}>Stage</div>
                <div style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${theme.colors.border}`,
                  color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 16 }}>Commit</div>
              </div>
            </Entrance>
          </div>
        </Entrance>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Scene 6: Terminal + Browser ----------
const TerminalScene: React.FC = () => {
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 }}>
        <WordReveal text="Run. Preview. Ship." delay={0} per={4}
          style={{ fontFamily: theme.fonts.display, fontSize: 88, fontWeight: 700,
            color: theme.colors.text, letterSpacing: "-0.03em", justifyContent: "center" }} />
        <Entrance delay={10} y={20}>
          <div style={{ display: "flex", gap: 24 }}>
            {["Terminal", "Browser", "Files"].map((t, i) => (
              <div key={t} style={{ padding: "14px 28px", borderRadius: 12,
                background: theme.colors.bgAlt, border: `1px solid ${theme.colors.border}`,
                fontFamily: theme.fonts.body, fontSize: 22, color: theme.colors.textDim }}>
                {t}
              </div>
            ))}
          </div>
        </Entrance>
        <Entrance delay={24} y={20}>
          <div style={{ fontFamily: theme.fonts.body, fontSize: 26, color: theme.colors.textDim, textAlign: "center" }}>
            Terminals, a built-in browser, and the file inspector — in one place.
          </div>
        </Entrance>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Scene 7: Payoff + CTA ----------
const Payoff: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const breathe = 1 + Math.sin(frame / 22) * 0.012;
  return (
    <Stack>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
        <div style={{ transform: `scale(${breathe})` }}>
          <Spark size={150} delay={0} />
        </div>
        <Entrance delay={8} y={20}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 110, fontWeight: 700,
            color: theme.colors.text, letterSpacing: "-0.03em", lineHeight: 1, textAlign: "center" }}>
            Orbit
          </div>
        </Entrance>
        <Entrance delay={18} y={16}>
          <div style={{ fontFamily: theme.fonts.body, fontSize: 34, color: theme.colors.textDim, textAlign: "center" }}>
            Orchestrate coding agents, per project.
          </div>
        </Entrance>
        <Entrance delay={40} y={12}>
          <div style={{ marginTop: 30, padding: "14px 32px", borderRadius: 12,
            background: theme.colors.primary, color: "#fff",
            fontFamily: theme.fonts.body, fontSize: 24, fontWeight: 600,
            boxShadow: `0 0 40px ${theme.colors.glow}` }}>
            Get started
          </div>
        </Entrance>
        <Entrance delay={50} y={8}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 18, color: theme.colors.textFaint, marginTop: 14 }}>
            github.com/SummerEngine/Orbit
          </div>
        </Entrance>
      </AbsoluteFill>
    </Stack>
  );
};

// ---------- Root orchestration ----------
export const OrbitRelease: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={90}><Hook /></Sequence>
      <Sequence from={90} durationInFrames={90}><Context /></Sequence>
      <Sequence from={180} durationInFrames={120}><GalaxyScene /></Sequence>
      <Sequence from={300} durationInFrames={120}><ChatScene /></Sequence>
      <Sequence from={420} durationInFrames={120}><ChangesScene /></Sequence>
      <Sequence from={540} durationInFrames={90}><TerminalScene /></Sequence>
      <Sequence from={630} durationInFrames={90}><Payoff /></Sequence>
    </AbsoluteFill>
  );
};