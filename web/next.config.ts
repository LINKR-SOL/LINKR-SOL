import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Anchor's `module` entry (dist/esm) references CommonJS `exports` and breaks when bundled for SSR;
  // resolving it through Node instead picks the CJS build, and the bundler's interop gives the Raydium SDK
  // (which stays bundled) its named imports. The browser bundle uses Anchor's own `browser` build.
  serverExternalPackages: ["@coral-xyz/anchor"],
  // The floating dev badge overlaps the page shell; the build output is unaffected.
  devIndicators: false,
  // The weighted-pool AMM surface was retired; old links land on the dividend product instead.
  async redirects() {
    return [
      { source: "/portfolio", destination: "/claims", permanent: true },
      { source: "/pool/:path*", destination: "/vaults", permanent: true },
      { source: "/pools", destination: "/vaults", permanent: true },
      { source: "/swap", destination: "/vaults", permanent: true },
      { source: "/create", destination: "/launch", permanent: true },
      { source: "/plans/:path*", destination: "/vaults", permanent: true },
    ];
  },
};

export default nextConfig;
