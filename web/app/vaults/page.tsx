import type {Metadata} from "next";
import {MarketGallery} from "@/components/linkr/landing";
export const metadata:Metadata={title:"Markets"};
export default function MarketsPage(){return <MarketGallery full/>}
