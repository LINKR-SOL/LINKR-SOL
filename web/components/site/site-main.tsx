"use client";

import { usePathname } from "next/navigation";
import { PageMotion } from "@/components/linkr/motion";

/** The landing page lays out its own full-bleed bands; every other route gets
 *  the shared content column. */
export function SiteMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <main id="main" className={pathname === "/" ? undefined : "page-main"}><PageMotion>{children}</PageMotion></main>;
}
