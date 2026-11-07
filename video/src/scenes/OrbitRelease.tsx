import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Audio, staticFile } from "remotion";
import { Bg, Grade, Grain, Vignette } from "../components/layers";
import { Spark } from "../components/primitives";
import { Particles, Starfield, Rise, Eyebrow, Flash } from "../components/fx";
import { theme } from "../theme";

const CODEX = "#7aa2f7";
const GREEN = "#4ade80";
const RED = "#f87171";

// ---------- shared polish ----------
const Sfx: React.FC<{ name: string; from?: number; volume?: number; duration?: number }> = ({ name, from = 0, volume = 0.5, duration = 60 }) => (
  <Sequence from={from} durationInFrames={duration}>
    <Audio src={staticFile(`audio/${name}.wav`)} volume={volume} />
  </Sequence>
);

// Fade + slight scale so cuts don't pop. dur = scene length.
const FadeWrap: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [dur - 10, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, dur], [1.03, 1.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut), transform: `scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};

const Stage: React.FC<{ children: React.ReactNode; stars?: boolean; dust?: number }> = ({ children, stars, dust = 8 }) => (
  <AbsoluteFill>
    <Bg />
    {stars && <Starfield count={40} />}
    <Particles count={dust} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>{children}</AbsoluteFill>
    <Grade />
    <Grain />
    <Vignette />
  </AbsoluteFill>
);

// Window chrome shared by chat / diff / terminal cards
const Window: React.FC<{ title: string; children: React.ReactNode; width?: number; height?: number }> = ({ title, children, width = 560, height = 440 }) => (
  <div style={{
    width, height, borderRadius: 18, background: "#111113",
    border: `1px solid ${theme.colors.border}`, overflow: "hidden",
    display: "flex", flexDirection: "column",
    boxShadow: "0 40px 90px -20px rgba(0,0,0,0.65)",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px",
      borderBottom: `1px solid ${theme.colors.border}`, background: "#0e0e10" }}>
      <div style={{ width: 10, height: 10, borderRadius: 5, background: "#3f3f46" }} />
      <div style={{ width: 10, height: 10, borderRadius: 5, background: "#3f3f46" }} />
      <div style={{ width: 10, height: 10, borderRadius: 5, background: "#3f3f46" }} />
      <div style={{ marginLeft: 10, fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textFaint, letterSpacing: "0.08em" }}>{title}</div>
    </div>
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
  </div>
);

const OrbitMark: React.FC<{ size?: number }> = ({ size = 200 }) => {
  const frame = useCurrentFrame();
  const rot = frame * 0.5;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(244,244,245,0.10)" }} />
      <div style={{ position: "absolute", inset: size * 0.22, borderRadius: "50%", border: "1px dashed rgba(244,244,245,0.10)" }} />
      {[0, 120, 240].map((a) => (
        <div key={a} style={{ position: "absolute", left: "50%", top: "50%",
          width: 10, height: 10, borderRadius: "50%", background: theme.colors.accent,
          transform: `rotate(${a + rot}deg) translateX(${size / 2}px) translate(-50%, -50%)` }} />
      ))}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.30, height: size * 0.30,
        borderRadius: "50%", background: `radial-gradient(circle at 35% 35%, #eda587, ${theme.colors.primary} 60%, #4a2012)`,
        transform: "translate(-50%, -50%)" }} />
    </div>
  );
};

const Pill: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderRadius: 999,
    background: "#131315", border: `1px solid ${theme.colors.border}` }}>
    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
    <div style={{ fontFamily: theme.fonts.body, fontSize: 20, fontWeight: 500, color: theme.colors.text }}>{label}</div>
  </div>
);

// ---------- Scene 1: Hook (0-90) ----------
const Hook: React.FC = () => {
  return (
    <Stage stars dust={10}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <Rise delay={2}><Eyebrow>Orbit — multi-agent workspace</Eyebrow></Rise>
        <div style={{ marginTop: 36 }}><OrbitMark size={210} /></div>
        <Rise delay={14}>
          <div style={{ marginTop: 44, fontFamily: theme.fonts.display, fontSize: 124, fontWeight: 700,
            color: theme.colors.text, letterSpacing: "-0.035em", lineHeight: 0.95 }}>ORBIT</div>
        </Rise>
        <Rise delay={28}>
          <div style={{ marginTop: 20, fontFamily: theme.fonts.body, fontSize: 32, color: theme.colors.textDim, lineHeight: 1.3 }}>
            Orchestrate your coding agents.
          </div>
        </Rise>
        <Rise delay={42}>
          <div style={{ marginTop: 30, fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.textFaint, letterSpacing: "0.12em" }}>
            CLAUDE CODE&nbsp;&nbsp;·&nbsp;&nbsp;CODEX&nbsp;&nbsp;·&nbsp;&nbsp;ONE WORKSPACE
          </div>
        </Rise>
      </div>
    </Stage>
  );
};

// ---------- Scene 2: Context (90-180) ----------
const Context: React.FC = () => (
  <Stage dust={6}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", maxWidth: 1100 }}>
      <Rise delay={0}><Eyebrow>One workspace</Eyebrow></Rise>
      <Rise delay={8}>
        <div style={{ marginTop: 26, fontFamily: theme.fonts.display, fontSize: 80, fontWeight: 600,
          color: theme.colors.text, letterSpacing: "-0.03em", lineHeight: 1.02 }}>
          Claude Code. Codex.<br />One workspace.
        </div>
      </Rise>
      <Rise delay={22}>
        <div style={{ marginTop: 24, fontFamily: theme.fonts.body, fontSize: 27, color: theme.colors.textDim, lineHeight: 1.5, maxWidth: 780 }}>
          Run every agent your project needs, side by side — without losing the thread.
        </div>
      </Rise>
      <Rise delay={34}>
        <div style={{ marginTop: 36, display: "flex", gap: 14 }}>
          <Pill label="Claude Code" color={theme.colors.primary} />
          <Pill label="Codex" color={CODEX} />
        </div>
      </Rise>
    </div>
  </Stage>
);

// ---------- Scene 3: Galaxy (180-300) ----------
const GalaxyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const container = 680;
  const radii = [340, 255];
  const counts = [5, 4];
  return (
    <Stage stars dust={6}>
      <div style={{ position: "relative", width: container, height: container }}>
        {radii.map((radius, r) => {
          const count = counts[r];
          const baseAngle = frame * (0.30 - r * 0.04);
          return (
            <React.Fragment key={r}>
              <div style={{ position: "absolute", left: "50%", top: "50%",
                width: radius * 2, height: radius * 2, borderRadius: "50%",
                border: `1px solid rgba(244,244,245,${0.10 - r * 0.02})`,
                transform: "translate(-50%, -50%)" }} />
              {Array.from({ length: count }).map((_, i) => {
                const angle = baseAngle + (360 / count) * i;
                const color = r === 0 && i < 2 ? theme.colors.primary : (i % 2 === 0 ? theme.colors.accent : CODEX);
                return (
                  <div key={i} style={{ position: "absolute", left: "50%", top: "50%",
                    width: 11, height: 11, borderRadius: "50%", background: color,
                    transform: `rotate(${angle}deg) translateX(${radius}px) translate(-50%, -50%)` }} />
                );
              })}
            </React.Fragment>
          );
        })}
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 88, height: 88,
          borderRadius: "50%", background: `radial-gradient(circle at 35% 35%, #ffffff, #b8b8be 70%)`,
          transform: "translate(-50%, -50%)" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 130, height: 130,
          borderRadius: "50%", border: `1px solid ${theme.colors.primary}33`,
          transform: "translate(-50%, -50%)" }} />
      </div>
      <div style={{ position: "absolute", bottom: 96, left: 0, right: 0, textAlign: "center" }}>
        <Rise delay={0}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 56, fontWeight: 600,
            color: theme.colors.text, letterSpacing: "-0.02em" }}>
            Every project. Its own galaxy.
          </div>
        </Rise>
        <Rise delay={14}>
          <div style={{ fontFamily: theme.fonts.body, fontSize: 24, color: theme.colors.textDim, marginTop: 12 }}>
            Projects are suns. Agents are planets. State is always visible.
          </div>
        </Rise>
      </div>
    </Stage>
  );
};

// ---------- Scene 4: Chat (300-420) ----------
const ChatScene: React.FC = () => (
  <Stage dust={6}>
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 80 }}>
      <Rise delay={0}>
        <Window title="ORBIT — INSPECTOR / CHAT" width={560} height={450}>
          <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            <Rise delay={6}>
              <div style={{ alignSelf: "flex-end", background: theme.colors.primary, color: "#fff",
                borderRadius: 14, padding: "10px 16px", maxWidth: "82%",
                fontFamily: theme.fonts.body, fontSize: 19, lineHeight: 1.4 }}>
                Add a login flow to the app.
              </div>
            </Rise>
            <Rise delay={16}>
              <div style={{ alignSelf: "flex-start", background: "#1a1a1d", border: `1px solid ${theme.colors.border}`,
                borderRadius: 14, padding: "10px 16px", maxWidth: "82%",
                fontFamily: theme.fonts.body, fontSize: 19, color: theme.colors.textDim, lineHeight: 1.4 }}>
                Reading the auth module…
              </div>
            </Rise>
            <Rise delay={26}>
              <div style={{ alignSelf: "flex-start", background: "#1a1a1d", border: `1px solid ${theme.colors.border}`,
                borderRadius: 14, padding: "10px 16px", maxWidth: "86%",
                fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.text, lineHeight: 1.4 }}>
                <span style={{ color: theme.colors.textFaint }}>Writing&nbsp;</span>src/auth/login.ts
              </div>
            </Rise>
            <Rise delay={36}>
              <div style={{ alignSelf: "flex-start", background: "#1a1a1d", border: `1px solid ${theme.colors.border}`,
                borderRadius: 14, padding: "10px 16px", maxWidth: "82%",
                fontFamily: theme.fonts.body, fontSize: 19, color: theme.colors.text, lineHeight: 1.4 }}>
                Tests <span style={{ color: GREEN }}>→ 12 passed.</span>
              </div>
            </Rise>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "14px 24px", borderTop: `1px solid ${theme.colors.border}` }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: theme.colors.primary }} />
            <div style={{ fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textFaint }}>agent is thinking…</div>
          </div>
        </Window>
      </Rise>
      <div style={{ maxWidth: 520 }}>
        <Rise delay={4}><Eyebrow>Talk</Eyebrow></Rise>
        <Rise delay={12}>
          <div style={{ marginTop: 18, fontFamily: theme.fonts.display, fontSize: 62, fontWeight: 600,
            color: theme.colors.text, letterSpacing: "-0.025em", lineHeight: 1.04 }}>
            Talk to your agents.
          </div>
        </Rise>
        <Rise delay={26}>
          <div style={{ marginTop: 18, fontFamily: theme.fonts.body, fontSize: 25, color: theme.colors.textDim, lineHeight: 1.5 }}>
            Full context, tool calls, and results — in one inspector. No tab-hopping.
          </div>
        </Rise>
      </div>
    </AbsoluteFill>
  </Stage>
);

// ---------- Scene 5: Changes (420-540) ----------
const ChangesScene: React.FC = () => (
  <Stage dust={6}>
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 80 }}>
      <div style={{ maxWidth: 520 }}>
        <Rise delay={4}><Eyebrow>Review</Eyebrow></Rise>
        <Rise delay={12}>
          <div style={{ marginTop: 18, fontFamily: theme.fonts.display, fontSize: 62, fontWeight: 600,
            color: theme.colors.text, letterSpacing: "-0.025em", lineHeight: 1.04 }}>
            Review every change.
          </div>
        </Rise>
        <Rise delay={26}>
          <div style={{ marginTop: 18, fontFamily: theme.fonts.body, fontSize: 25, color: theme.colors.textDim, lineHeight: 1.5 }}>
            Staged, unstaged, diffed — before anything lands.
          </div>
        </Rise>
      </div>
      <Rise delay={0}>
        <Window title="ORBIT — CHANGES" width={560} height={450}>
          <div style={{ padding: "18px 24px 0", display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              { f: "src/auth/login.ts", a: "+42", d: "−7" },
              { f: "src/auth/session.ts", a: "+18", d: "−3" },
              { f: "tests/auth.test.ts", a: "+24", d: "−0" },
            ].map((x, i) => (
              <Rise key={x.f} delay={6 + i * 8}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "15px 0", borderBottom: `1px solid ${theme.colors.border}` }}>
                  <div style={{ fontFamily: theme.fonts.mono, fontSize: 17, color: theme.colors.text }}>{x.f}</div>
                  <div style={{ fontFamily: theme.fonts.mono, fontSize: 16 }}>
                    <span style={{ color: GREEN }}>{x.a}</span>
                    <span style={{ color: theme.colors.textFaint }}> </span>
                    <span style={{ color: RED }}>{x.d}</span>
                  </div>
                </div>
              </Rise>
            ))}
          </div>
          <div style={{ marginTop: "auto", padding: 24, borderTop: `1px solid ${theme.colors.border}` }}>
            <Rise delay={34}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ padding: "11px 24px", borderRadius: 10, background: theme.colors.text,
                  color: "#09090b", fontFamily: theme.fonts.body, fontSize: 16, fontWeight: 600 }}>Stage all</div>
                <div style={{ padding: "11px 24px", borderRadius: 10, border: `1px solid ${theme.colors.border}`,
                  color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 16 }}>Commit</div>
                <div style={{ marginLeft: "auto", fontFamily: theme.fonts.mono, fontSize: 13, color: theme.colors.textFaint }}>⌘ + Enter</div>
              </div>
            </Rise>
          </div>
        </Window>
      </Rise>
    </AbsoluteFill>
  </Stage>
);

// ---------- Scene 6: Terminal (540-630) ----------
const TerminalScene: React.FC = () => (
  <Stage dust={6}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 980 }}>
      <Rise delay={0}><Eyebrow>Ship</Eyebrow></Rise>
      <Rise delay={8}>
        <div style={{ marginTop: 18, fontFamily: theme.fonts.display, fontSize: 78, fontWeight: 700,
          color: theme.colors.text, letterSpacing: "-0.03em" }}>
          Run. Preview. Ship.
        </div>
      </Rise>
      <div style={{ marginTop: 34, width: "100%" }}>
        <Rise delay={16}>
          <Window title="ORBIT — TERMINAL" width={980} height={280}>
            <div style={{ padding: 24, fontFamily: theme.fonts.mono, fontSize: 19, lineHeight: 1.7 }}>
              <div><span style={{ color: GREEN }}>$</span> <span style={{ color: theme.colors.text }}>npm run dev</span></div>
              <div style={{ color: theme.colors.textFaint }}>✓ Ready in 1200ms — http://localhost:5173</div>
              <div><span style={{ color: GREEN }}>$</span> <span style={{ color: theme.colors.text }}>orbit test</span></div>
              <div style={{ color: theme.colors.textFaint }}>12 passed, 0 failed</div>
            </div>
          </Window>
        </Rise>
      </div>
      <Rise delay={30}>
        <div style={{ marginTop: 24, fontFamily: theme.fonts.body, fontSize: 24, color: theme.colors.textDim, textAlign: "center" }}>
          Terminals, a built-in browser, and the file inspector — in one place.
        </div>
      </Rise>
    </div>
  </Stage>
);

// ---------- Scene 7: Payoff (630-720) ----------
const Payoff: React.FC = () => {
  const frame = useCurrentFrame();
  const breathe = 1 + Math.sin(frame / 26) * 0.01;
  const flashOp = interpolate(frame, [0, 5, 12], [0.22, 0.08, 0], { extrapolateRight: "clamp" });
  return (
    <Stage stars dust={10}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <Rise delay={0}><OrbitMark size={150} /></Rise>
        <Rise delay={10}>
          <div style={{ marginTop: 36, fontFamily: theme.fonts.display, fontSize: 108, fontWeight: 700,
            color: theme.colors.text, letterSpacing: "-0.035em", lineHeight: 1 }}>ORBIT</div>
        </Rise>
        <Rise delay={22}>
          <div style={{ marginTop: 16, fontFamily: theme.fonts.body, fontSize: 30, color: theme.colors.textDim }}>
            Orchestrate coding agents, per project.
          </div>
        </Rise>
        <Rise delay={36}>
          <div style={{ marginTop: 34, padding: "15px 36px", borderRadius: 12,
            background: theme.colors.text, color: "#09090b",
            fontFamily: theme.fonts.body, fontSize: 22, fontWeight: 600 }}>
            Get started
          </div>
        </Rise>
        <Rise delay={48}>
          <div style={{ marginTop: 18, fontFamily: theme.fonts.mono, fontSize: 16, color: theme.colors.textFaint, letterSpacing: "0.06em" }}>
            github.com/SummerEngine/Orbit
          </div>
        </Rise>
      </div>
      <Flash opacity={flashOp} color={theme.colors.primary} />
      {/* hold-to-black at very end */}
      <EndFade />
    </Stage>
  );
};

const EndFade: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const op = interpolate(frame, [durationInFrames - 12, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#060607", opacity: op, pointerEvents: "none" }} />;
};

// ---------- Root ----------
export const OrbitRelease: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // slow cinematic push across the whole video
  const push = interpolate(frame, [0, durationInFrames], [1.05, 1.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#060607" }}>
      <Audio src={staticFile("audio/music.wav")} volume={0.95} />
      {/* gentle SFX bed under music */}
      <Sfx name="riser" from={0} volume={0.14} duration={50} />
      <Sfx name="impact" from={50} volume={0.22} duration={30} />
      <Sfx name="whoosh" from={88} volume={0.16} duration={20} />
      <Sfx name="impact" from={228} volume={0.12} duration={20} />
      <Sfx name="whoosh" from={418} volume={0.14} duration={20} />
      <Sfx name="success" from={360} volume={0.16} duration={30} />
      <Sfx name="swoosh" from={538} volume={0.16} duration={20} />
      <Sfx name="impact" from={648} volume={0.22} duration={25} />

      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})` }}>
        <Sequence from={0} durationInFrames={90}><FadeWrap dur={90}><Hook /></FadeWrap></Sequence>
        <Sequence from={90} durationInFrames={90}><FadeWrap dur={90}><Context /></FadeWrap></Sequence>
        <Sequence from={180} durationInFrames={120}><FadeWrap dur={120}><GalaxyScene /></FadeWrap></Sequence>
        <Sequence from={300} durationInFrames={120}><FadeWrap dur={120}><ChatScene /></FadeWrap></Sequence>
        <Sequence from={420} durationInFrames={120}><FadeWrap dur={120}><ChangesScene /></FadeWrap></Sequence>
        <Sequence from={540} durationInFrames={90}><FadeWrap dur={90}><TerminalScene /></FadeWrap></Sequence>
        <Sequence from={630} durationInFrames={90}><Payoff /></Sequence>
      </div>

      {/* progress bar — primary only, bottom */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "rgba(244,244,245,0.06)" }}>
        <div style={{ width: `${(frame / durationInFrames) * 100}%`, height: "100%", background: theme.colors.primary }} />
      </div>
    </AbsoluteFill>
  );
};
