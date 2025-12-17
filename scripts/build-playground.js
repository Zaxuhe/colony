/**
 * Build browser bundle for Colony playground
 * Bundles parser + resolver + strings for browser use
 */

import * as esbuild from "esbuild";
import { writeFile } from "node:fs/promises";

// Build the browser bundle
await esbuild.build({
  entryPoints: ["./scripts/playground-entry.js"],
  bundle: true,
  format: "iife",
  globalName: "Colony",
  platform: "browser",
  target: "es2020",
  outfile: "./docs/playground.bundle.js",
  sourcemap: true,
  minify: true,
  define: {
    "process.env": "{}",
  },
});

console.log("Built playground bundle to docs/playground.bundle.js");
