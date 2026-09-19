import { Composition } from "remotion";
import { HeroLandscape } from "./HeroLandscape";
import { CausalLine } from "./CausalLine";
import { ConsensusWave } from "./ConsensusWave";

/**
 * Three cinematic plates for causa.
 *
 *   HeroLandscape — SECTION 01, the market as terrain
 *   CausalLine    — SECTION 03, "Information moves before price does"
 *   ConsensusWave — SECTION 11, "Consensus is expensive"
 *
 * All three loop seamlessly. Durations are a filesize/quality tradeoff: long
 * enough that the motion reads as slow, short enough to stay a small download
 * (02_ASSET_GUIDE §16 — "short loops, silent, optimized").
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HeroLandscape"
        component={HeroLandscape}
        durationInFrames={420}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="CausalLine"
        component={CausalLine}
        durationInFrames={480}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ConsensusWave"
        component={ConsensusWave}
        durationInFrames={540}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
