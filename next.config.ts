import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The cloud preview serves the dev server through a generated hostname.
  allowedDevOrigins: process.env.PREVIEW_HOSTNAME ? [process.env.PREVIEW_HOSTNAME] : [],
};

export default nextConfig;
