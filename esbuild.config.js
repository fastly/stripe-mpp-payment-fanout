import { build } from "esbuild";

await build({
  entryPoints: ["./src/entry.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  outfile: "./dist/index.js",
  external: ["fastly:*"],
  conditions: ["fastly", "browser", "worker"],
  alias: {
    "node:util": "./src/shims-node-util.ts",
  },
});
