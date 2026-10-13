import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // The monorepo root, two levels up. It has to be the workspace root rather
    // than this directory: pnpm links dependencies into ../../node_modules/.pnpm,
    // and Turbopack will not resolve past the root it is given — pointing it at
    // this folder makes it fail to find `next` itself.
    root: path.resolve(__dirname, "..", ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
