import { barchart } from "./barchart";
import { googleNews } from "./google-news";
import { nasdaqHalts } from "./nasdaq-halts";
import { secEdgar } from "./sec-edgar";
import { stocktwits } from "./stocktwits";
import { yahoo } from "./yahoo";
import { envOn, type Adapter } from "./types";

/** Every source the newswire can read. Order is only cosmetic; the collector runs them
 *  concurrently and gates their output identically. */
export const ADAPTERS: Adapter[] = [stocktwits, yahoo, barchart, googleNews, nasdaqHalts, secEdgar];

export const enabledAdapters = (): Adapter[] => ADAPTERS.filter((a) => envOn(a.envFlag, a.defaultOn));

export type { Adapter, RawStory } from "./types";
