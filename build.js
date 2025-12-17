import * as esbuild from "esbuild";
import { readdir, writeFile, copyFile, mkdir, stat } from "node:fs/promises";

// Collect source files
const srcFiles = (await readdir("./src")).filter(f => f.endsWith(".js"));
const dtsFiles = (await readdir("./src")).filter(f => f.endsWith(".d.ts"));

// Collect provider files if directory exists
let providerFiles = [];
try {
  const providerStat = await stat("./src/providers");
  if (providerStat.isDirectory()) {
    providerFiles = (await readdir("./src/providers")).filter(f => f.endsWith(".js"));
  }
} catch {
  // No providers directory
}

// All entry points
const entryPoints = [
  ...srcFiles.map(f => `./src/${f}`),
  ...providerFiles.map(f => `./src/providers/${f}`),
];

// Ensure dist directories exist
await mkdir("./dist/esm", { recursive: true });
await mkdir("./dist/cjs", { recursive: true });
await mkdir("./dist/esm/providers", { recursive: true });
await mkdir("./dist/cjs/providers", { recursive: true });

// Build ESM
await esbuild.build({
  entryPoints,
  outdir: "./dist/esm",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
});

// Build CJS
await esbuild.build({
  entryPoints,
  outdir: "./dist/cjs",
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
});

// Create package.json for ESM (explicit module type)
await writeFile("./dist/esm/package.json", JSON.stringify({ type: "module" }, null, 2));

// Create package.json for CJS (explicit commonjs type)
await writeFile("./dist/cjs/package.json", JSON.stringify({ type: "commonjs" }, null, 2));

// Copy TypeScript definitions to dist/esm
for (const f of dtsFiles) {
  await copyFile(`./src/${f}`, `./dist/esm/${f}`);
}

console.log("Built ESM and CJS to dist/");
