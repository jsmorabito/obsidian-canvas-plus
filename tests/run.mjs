// Bundles the tests (they import the plugin's TypeScript) and runs them with Node's own test runner.
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "canvas-plus-tests-"));
const tests = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).map((f) => join("tests", f));
try {
  await esbuild.build({
    entryPoints: tests,
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: dir,
    outExtension: { ".js": ".mjs" },
    logLevel: "warning",
    alias: { obsidian: "./tests/obsidian-stub.ts" },
  });
  const built = tests.map((t) => join(dir, `${t.split("/").pop()?.replace(/\.ts$/, "")}.mjs`));
  const result = spawnSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
