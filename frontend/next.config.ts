import type { NextConfig } from "next";

const staticExport = process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = staticExport
  ? { output: "export" }
  : { cacheComponents: true, partialPrefetching: true };

export default nextConfig;
