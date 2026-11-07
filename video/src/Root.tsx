import { Composition } from "remotion";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { OrbitRelease } from "./scenes/OrbitRelease";

loadSpaceGrotesk();
loadInter();
loadJetBrainsMono();

export const RemotionRoot = () => (
  <Composition
    id="OrbitRelease"
    component={OrbitRelease}
    durationInFrames={720}
    fps={30}
    width={1920}
    height={1080}
  />
);