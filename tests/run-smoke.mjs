import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outfile = join(
  tmpdir(),
  `drop-ship-smoke-${process.pid}-${Date.now()}.mjs`
);
const localEsbuildBinary = join(
  process.cwd(),
  "node_modules",
  ".pnpm",
  "node_modules",
  "esbuild",
  "bin",
  "esbuild"
);
const localEsbuildShim = join(
  process.cwd(),
  "node_modules",
  ".pnpm",
  "node_modules",
  ".bin",
  "esbuild"
);
const esbuild = existsSync(localEsbuildBinary)
  ? localEsbuildBinary
  : existsSync(localEsbuildShim)
    ? localEsbuildShim
    : "esbuild";

const build = spawnSync(
  esbuild,
  [
    "tests/smoke.test.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outfile}`,
  ],
  {
    stdio: "inherit",
  }
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

try {
  await import(pathToFileURL(outfile).href);
} finally {
  if (existsSync(outfile)) {
    await unlink(outfile);
  }
}
