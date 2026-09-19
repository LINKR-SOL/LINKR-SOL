import type { SVGProps } from "react";
type Props = SVGProps<SVGSVGElement> & { size?: number; weight?: string };
// Original LINKR glyphs: open corners and rounded, linked strokes.
const drawings = {
ArrowRight:"M4 12h13M12 6l6 6-6 6", ArrowUpRight:"M6 18 18 6M7 6h11v11",
ArrowSquareOut:"M13 4h7v7M20 4 10 14M8 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3",
CaretRight:"m9 5 7 7-7 7", CaretDown:"m5 9 7 7 7-7", Check:"m4 12 5 5L20 6", X:"m6 6 12 12M18 6 6 18",
MagnifyingGlass:"M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
Info:"M12 10v7M12 6.5v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
List:"M4 7h16M4 12h11M4 17h16", Copy:"M9 8h9a2 2 0 0 1 2 2v10H9a2 2 0 0 1-2-2V7M15 4H4v11",
TrendUp:"m3 17 6-6 4 3 8-10M15 4h6v6",
ArrowsClockwise:"M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M16 16h5v5",
Coins:"M4 7c0-5 16-5 16 0S4 12 4 7Zm0 0v10c0 5 16 5 16 0V7M4 12c0 5 16 5 16 0",
Gift:"M3 10h18v5H3zM5 15v6h14v-6M12 10v11M12 10C1 9 5 0 10 5l2 5Zm0 0c11-1 7-10 2-5l-2 5Z",
Sparkle:"M12 2c0 7-3 10-10 10 7 0 10 3 10 10 0-7 3-10 10-10-7 0-10-3-10-10Z",
Atom:"M3 8c-2-6 22 4 18 9S0 12 3 8Zm1 10c-5-3 16-19 17-13S9 23 4 18Z",
RocketLaunch:"m8 16-4 4M7 12l-4 1 4-7h4M12 17l-1 4 7-4v-4M7 12C10 5 15 2 22 2c0 7-3 12-10 15l-5-5Z",
StackSimple:"m2 8 10-5 10 5-10 5L2 8Zm0 5 10 5 10-5M2 18l10 5 10-5",
};
function make(name:keyof typeof drawings){return function LinkrIcon({size=20,weight:_weight,...props}:Props){void _weight;return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={drawings[name]}/></svg>}}
export const ArrowRight=make("ArrowRight"),ArrowUpRight=make("ArrowUpRight"),ArrowSquareOut=make("ArrowSquareOut"),CaretRight=make("CaretRight"),CaretDown=make("CaretDown"),Check=make("Check"),X=make("X"),MagnifyingGlass=make("MagnifyingGlass"),Info=make("Info"),List=make("List"),Copy=make("Copy"),TrendUp=make("TrendUp"),ArrowsClockwise=make("ArrowsClockwise"),Coins=make("Coins"),Gift=make("Gift"),Sparkle=make("Sparkle"),Atom=make("Atom"),RocketLaunch=make("RocketLaunch"),StackSimple=make("StackSimple");
