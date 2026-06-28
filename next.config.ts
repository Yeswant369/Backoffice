import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Stray lockfiles in parent
  // directories otherwise cause Next.js to infer the wrong root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
