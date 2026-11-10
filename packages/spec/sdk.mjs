#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FERN_CLI = "fern-api@5.203.0";
const GROUPS = ["typescript-sdk", "python-sdk"];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SPEC_PATH = resolve(ROOT, "packages/spec/openapi.yaml");
const HASH_PATH = resolve(ROOT, "sdks/spec.sha256");
const README_SOURCE_PATH = resolve(ROOT, "sdks/typescript/src/README.md");
const README_ROOT_PATH = resolve(ROOT, "sdks/typescript/README.md");

export function hashSpec(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function checkSpecHash(options = {}) {
  const specPath = options.specPath ?? SPEC_PATH;
  const hashPath = options.hashPath ?? HASH_PATH;
  const actual = hashSpec(specPath);
  let expected;
  try {
    expected = readFileSync(hashPath, "utf8").trim();
  } catch {
    return { ok: false, reason: "missing", actual };
  }
  if (expected !== actual) return { ok: false, reason: "stale", actual, expected };
  return { ok: true, actual };
}

export function checkReadme(options = {}) {
  const sourcePath = options.sourcePath ?? README_SOURCE_PATH;
  const rootPath = options.rootPath ?? README_ROOT_PATH;
  let source;
  try {
    source = readFileSync(sourcePath);
  } catch {
    return { ok: false, reason: "missing-source" };
  }
  let root;
  try {
    root = readFileSync(rootPath);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!source.equals(root)) return { ok: false, reason: "differ" };
  return { ok: true };
}

function generate() {
  for (const group of GROUPS) {
    const result = spawnSync("npx", ["-y", FERN_CLI, "generate", "--group", group, "--force"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      const code = result.status ?? result.signal ?? "unknown";
      console.error(`sdk:generate: ${group} generation failed (${code})`);
      process.exit(1);
    }
  }
  copyFileSync(README_SOURCE_PATH, README_ROOT_PATH);
  console.log(
    `sdk:generate: copied ${relative(ROOT, README_SOURCE_PATH)} to ${relative(ROOT, README_ROOT_PATH)}`,
  );
  writeFileSync(HASH_PATH, `${hashSpec(SPEC_PATH)}\n`);
  console.log(`sdk:generate: wrote ${relative(ROOT, HASH_PATH)}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const unknown = args.find((argument) => argument !== "--generate" && argument !== "--check");
  if (unknown !== undefined) {
    console.error(`sdk: unknown argument: ${unknown}`);
    process.exit(2);
  }

  if (args.includes("--generate")) {
    generate();
    process.exit(0);
  }

  const hash = checkSpecHash();
  const readme = checkReadme();
  let failed = false;

  if (!hash.ok) {
    failed = true;
    if (hash.reason === "missing") {
      console.error("sdk:check: sdks/spec.sha256 is missing");
    } else {
      console.error(
        `sdk:check: sdks/spec.sha256 is stale (expected ${hash.expected}, found ${hash.actual})`,
      );
    }
  }

  if (!readme.ok) {
    failed = true;
    if (readme.reason === "missing") {
      console.error("sdk:check: sdks/typescript/README.md is missing");
    } else if (readme.reason === "missing-source") {
      console.error("sdk:check: sdks/typescript/src/README.md is missing");
    } else {
      console.error(
        "sdk:check: sdks/typescript/README.md is stale, it differs from sdks/typescript/src/README.md",
      );
    }
  }

  if (failed) {
    console.error(
      "run `bun run sdk:generate` to regenerate the SDKs and refresh the committed copies",
    );
    process.exit(1);
  }

  console.log(
    "sdk:check ok: sdks/spec.sha256 matches packages/spec/openapi.yaml and sdks/typescript/README.md matches sdks/typescript/src/README.md",
  );
  process.exit(0);
}
