import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseDotenv, loadDotenv, loadDotenvFiles, loadColony } from "../src/index.js";

describe("parseDotenv", () => {
  it("parses basic key=value pairs", () => {
    const content = `FOO=bar
BAZ=qux`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { FOO: "bar", BAZ: "qux" });
  });

  it("handles empty lines and comments", () => {
    const content = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { FOO: "bar", BAZ: "qux" });
  });

  it("handles double-quoted values", () => {
    const content = `FOO="hello world"
BAR="value with spaces"`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { FOO: "hello world", BAR: "value with spaces" });
  });

  it("handles single-quoted values", () => {
    const content = `FOO='hello world'`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { FOO: "hello world" });
  });

  it("handles inline comments for unquoted values", () => {
    const content = `FOO=bar # this is a comment`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { FOO: "bar" });
  });

  it("handles values with equals signs", () => {
    const content = `DATABASE_URL=postgres://user:pass@host/db?ssl=true`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { DATABASE_URL: "postgres://user:pass@host/db?ssl=true" });
  });

  it("handles empty values", () => {
    const content = `EMPTY=
ALSO_EMPTY=""`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { EMPTY: "", ALSO_EMPTY: "" });
  });

  it("trims whitespace around keys and values", () => {
    const content = `  FOO  =  bar
BAZ   =   qux`;
    const result = parseDotenv(content);
    assert.deepEqual(result, { FOO: "bar", BAZ: "qux" });
  });
});

describe("loadDotenv", () => {
  let tempDir;
  let envFile;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "colony-test-"));
    envFile = path.join(tempDir, ".env");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  it("loads a dotenv file from disk", async () => {
    await fs.writeFile(envFile, "FOO=bar\nBAZ=qux");
    const result = await loadDotenv(envFile);
    assert.deepEqual(result, { FOO: "bar", BAZ: "qux" });
  });
});

describe("loadDotenvFiles", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "colony-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  it("loads multiple files with later files overriding", async () => {
    await fs.writeFile(path.join(tempDir, ".env"), "FOO=base\nBAR=base");
    await fs.writeFile(path.join(tempDir, ".env.local"), "FOO=local");

    const result = await loadDotenvFiles([
      path.join(tempDir, ".env"),
      path.join(tempDir, ".env.local"),
    ]);
    assert.deepEqual(result, { FOO: "local", BAR: "base" });
  });

  it("silently skips missing files", async () => {
    await fs.writeFile(path.join(tempDir, ".env"), "FOO=bar");

    const result = await loadDotenvFiles([
      path.join(tempDir, ".env"),
      path.join(tempDir, ".env.nonexistent"),
    ]);
    assert.deepEqual(result, { FOO: "bar" });
  });
});

describe("loadColony with dotenv", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "colony-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  it("interpolates dotenv values in config", async () => {
    // Create .env file
    await fs.writeFile(path.join(tempDir, ".env"), "DB_HOST=localhost\nDB_PORT=5432");

    // Create colony file
    const colonyFile = path.join(tempDir, "app.colony");
    await fs.writeFile(colonyFile, `
@dims env;
*.database.host = "\${ENV:DB_HOST}";
*.database.port = "\${ENV:DB_PORT}";
`);

    const cfg = await loadColony({
      entry: colonyFile,
      ctx: { env: "dev" },
      dotenv: path.join(tempDir, ".env"),
    });

    assert.equal(cfg.database.host, "localhost");
    assert.equal(cfg.database.port, "5432");
  });

  it("dotenv values override process.env", async () => {
    // Set a process.env value
    const originalValue = process.env.TEST_OVERRIDE_VAR;
    process.env.TEST_OVERRIDE_VAR = "from-process";

    try {
      // Create .env file that overrides it
      await fs.writeFile(path.join(tempDir, ".env"), "TEST_OVERRIDE_VAR=from-dotenv");

      const colonyFile = path.join(tempDir, "app.colony");
      await fs.writeFile(colonyFile, `
@dims env;
*.value = "\${ENV:TEST_OVERRIDE_VAR}";
`);

      const cfg = await loadColony({
        entry: colonyFile,
        ctx: { env: "dev" },
        dotenv: path.join(tempDir, ".env"),
      });

      assert.equal(cfg.value, "from-dotenv");
    } finally {
      if (originalValue === undefined) {
        delete process.env.TEST_OVERRIDE_VAR;
      } else {
        process.env.TEST_OVERRIDE_VAR = originalValue;
      }
    }
  });

  it("dotenv: true loads .env and .env.local", async () => {
    // Save current directory and change to temp
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      await fs.writeFile(path.join(tempDir, ".env"), "BASE_VAR=base");
      await fs.writeFile(path.join(tempDir, ".env.local"), "LOCAL_VAR=local");

      const colonyFile = path.join(tempDir, "app.colony");
      await fs.writeFile(colonyFile, `
@dims env;
*.base = "\${ENV:BASE_VAR}";
*.local = "\${ENV:LOCAL_VAR}";
`);

      const cfg = await loadColony({
        entry: colonyFile,
        ctx: { env: "dev" },
        dotenv: true,
      });

      assert.equal(cfg.base, "base");
      assert.equal(cfg.local, "local");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("dotenv with array loads multiple files", async () => {
    await fs.writeFile(path.join(tempDir, "base.env"), "VAR=base");
    await fs.writeFile(path.join(tempDir, "override.env"), "VAR=override");

    const colonyFile = path.join(tempDir, "app.colony");
    await fs.writeFile(colonyFile, `
@dims env;
*.value = "\${ENV:VAR}";
`);

    const cfg = await loadColony({
      entry: colonyFile,
      ctx: { env: "dev" },
      dotenv: [
        path.join(tempDir, "base.env"),
        path.join(tempDir, "override.env"),
      ],
    });

    assert.equal(cfg.value, "override");
  });
});
