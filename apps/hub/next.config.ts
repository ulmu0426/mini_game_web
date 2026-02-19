import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@minigame/sdk"],
  experimental: {
    externalDir: true
  }
};

export default nextConfig;
