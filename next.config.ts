import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
