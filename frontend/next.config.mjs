import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: root,
  experimental: { cpus: 2 },
  ...(process.env.STATIC_EXPORT === "true"
    ? { output: "export" }
    : { cacheComponents: true, partialPrefetching: true }),
};

export default nextConfig;
