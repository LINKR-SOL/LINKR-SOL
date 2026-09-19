import type { Metadata } from "next";
import { NewsWire } from "@/components/news/news-wire";

export const metadata: Metadata = {
  title: "News",
  description:
    "Live headlines on the tokenised stocks LINKR pairs to — each story read against today's real move on Solana.",
};

export default function NewsPage() {
  return <NewsWire />;
}
