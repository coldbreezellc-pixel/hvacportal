import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The one-time PM import reads the JSON files archived by the old portal at
  // runtime, so they must ship with the serverless function.
  outputFileTracingIncludes: { "/api/admin/import-legacy-pm": ["./legacy/**/*"] },
};

export default nextConfig;
