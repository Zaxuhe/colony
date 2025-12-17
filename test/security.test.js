import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { loadColony } from "../src/index.js";

const TEST_DIR = path.join(process.cwd(), "test", "fixtures");

describe("Security", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("path traversal protection", () => {
    test("blocks include outside basePath", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n@include "../package.json";'
      );

      await assert.rejects(
        loadColony({
          entry: path.join(TEST_DIR, "main.colony"),
          ctx: { env: "prod" },
          sandbox: { basePath: TEST_DIR },
        }),
        /Path traversal blocked/
      );
    });

    test("allows include within basePath", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "base.colony"),
        "@dims env;\n*.key = value;"
      );
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n@include "./base.colony";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
        sandbox: { basePath: TEST_DIR },
      });
      assert.strictEqual(cfg.key, "value");
    });
  });

  describe("environment variable allowlist", () => {
    test("blocks non-whitelisted env vars", async () => {
      process.env.TEST_SECRET = "secret123";
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n*.secret = "${ENV:TEST_SECRET}";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
        sandbox: { allowedEnvVars: ["NODE_ENV"] },
      });

      assert.strictEqual(cfg.secret, "");
      assert.ok(cfg._warnings.some((w) => w.type === "blocked_env_var"));

      delete process.env.TEST_SECRET;
    });

    test("allows whitelisted env vars", async () => {
      process.env.TEST_ALLOWED = "allowed123";
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n*.value = "${ENV:TEST_ALLOWED}";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
        sandbox: { allowedEnvVars: ["TEST_ALLOWED"] },
      });

      assert.strictEqual(cfg.value, "allowed123");

      delete process.env.TEST_ALLOWED;
    });
  });

  describe("max include depth", () => {
    test("blocks deeply nested includes", async () => {
      // Create chain: a -> b -> c -> d -> e (depth 4)
      for (let i = 0; i < 5; i++) {
        const next = i < 4 ? `@include "./${String.fromCharCode(98 + i)}.colony";` : "";
        await fs.writeFile(
          path.join(TEST_DIR, `${String.fromCharCode(97 + i)}.colony`),
          `@dims env;\n${next}\n*.key${i} = value${i};`
        );
      }

      await assert.rejects(
        loadColony({
          entry: path.join(TEST_DIR, "a.colony"),
          ctx: { env: "prod" },
          sandbox: { maxIncludeDepth: 3 },
        }),
        /Max include depth/
      );
    });
  });

  describe("warnings", () => {
    test("preserves secret provider patterns without warning", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n*.value = "${AWS:myapp/secret}";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
      });

      // Secret patterns are preserved for later secret processing
      assert.strictEqual(cfg.value, "${AWS:myapp/secret}");
      assert.ok(!cfg._warnings.some((w) => w.type === "unknown_interpolation"));
    });

    test("warns on truly unknown interpolation pattern", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n*.value = "${unknown}";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
      });

      assert.ok(cfg._warnings.some((w) => w.type === "unknown_interpolation"));
    });

    test("warns on unknown VAR", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n*.value = "${VAR:MISSING}";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
      });

      assert.ok(cfg._warnings.some((w) => w.type === "unknown_var"));
    });

    test("warns on skipped includes when enabled", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "base.colony"),
        "@dims env;\n*.key = value;"
      );
      await fs.writeFile(
        path.join(TEST_DIR, "main.colony"),
        '@dims env;\n@include "./base.colony";\n@include "./base.colony";'
      );

      const cfg = await loadColony({
        entry: path.join(TEST_DIR, "main.colony"),
        ctx: { env: "prod" },
        warnOnSkippedIncludes: true,
      });

      assert.ok(cfg._warnings.some((w) => w.type === "skipped_include"));
    });
  });
});
