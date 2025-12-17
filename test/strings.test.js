import { test, describe } from "node:test";
import assert from "node:assert";
import { interpolate, applyInterpolationDeep } from "../src/strings.js";

describe("interpolate", () => {
  describe("ENV interpolation", () => {
    test("interpolates environment variables", () => {
      process.env.TEST_VAR = "hello";
      const result = interpolate("value: ${ENV:TEST_VAR}", {
        ctx: {},
        vars: {},
        warnings: [],
      });
      assert.strictEqual(result, "value: hello");
      delete process.env.TEST_VAR;
    });

    test("returns empty for missing env var", () => {
      const warnings = [];
      const result = interpolate("value: ${ENV:MISSING_VAR}", {
        ctx: {},
        vars: {},
        warnings,
      });
      assert.strictEqual(result, "value: ");
    });

    test("blocks non-allowed env vars", () => {
      process.env.SECRET = "secret";
      const warnings = [];
      const result = interpolate("value: ${ENV:SECRET}", {
        ctx: {},
        vars: {},
        allowedEnvVars: ["NODE_ENV"],
        warnings,
      });
      assert.strictEqual(result, "value: ");
      assert.ok(warnings.some((w) => w.type === "blocked_env_var"));
      delete process.env.SECRET;
    });
  });

  describe("VAR interpolation", () => {
    test("interpolates custom variables", () => {
      const result = interpolate("path: ${VAR:ROOT}/config", {
        ctx: {},
        vars: { ROOT: "/app" },
        warnings: [],
      });
      assert.strictEqual(result, "path: /app/config");
    });

    test("warns on unknown VAR", () => {
      const warnings = [];
      const result = interpolate("${VAR:UNKNOWN}", {
        ctx: {},
        vars: {},
        warnings,
      });
      assert.strictEqual(result, "");
      assert.ok(warnings.some((w) => w.type === "unknown_var"));
    });
  });

  describe("ctx interpolation", () => {
    test("interpolates context values", () => {
      const result = interpolate("env: ${ctx.env}", {
        ctx: { env: "prod" },
        vars: {},
        warnings: [],
      });
      assert.strictEqual(result, "env: prod");
    });

    test("warns on unknown ctx dimension", () => {
      const warnings = [];
      const result = interpolate("${ctx.missing}", {
        ctx: { env: "prod" },
        vars: {},
        warnings,
      });
      assert.strictEqual(result, "");
      assert.ok(warnings.some((w) => w.type === "unknown_ctx"));
    });
  });

  describe("unknown patterns", () => {
    test("preserves secret provider patterns for later processing", () => {
      const warnings = [];
      const result = interpolate("${AWS:myapp/secret}", {
        ctx: {},
        vars: {},
        warnings,
      });
      // Secret patterns are preserved, not replaced
      assert.strictEqual(result, "${AWS:myapp/secret}");
      assert.ok(!warnings.some((w) => w.type === "unknown_interpolation"));
    });

    test("warns on truly unknown interpolation pattern", () => {
      const warnings = [];
      const result = interpolate("${unknown}", {
        ctx: {},
        vars: {},
        warnings,
      });
      assert.strictEqual(result, "");
      assert.ok(warnings.some((w) => w.type === "unknown_interpolation"));
    });
  });

  describe("multiple interpolations", () => {
    test("handles multiple interpolations in one string", () => {
      process.env.REALM = "us-east";
      const result = interpolate("${ctx.env}-${ENV:REALM}-${VAR:suffix}", {
        ctx: { env: "prod" },
        vars: { suffix: "001" },
        warnings: [],
      });
      assert.strictEqual(result, "prod-us-east-001");
      delete process.env.REALM;
    });
  });
});

describe("applyInterpolationDeep", () => {
  test("interpolates strings in nested objects", () => {
    const input = {
      a: {
        b: "${ctx.env}",
        c: "static",
      },
    };
    const result = applyInterpolationDeep(input, {
      ctx: { env: "prod" },
      vars: {},
      warnings: [],
    });
    assert.strictEqual(result.a.b, "prod");
    assert.strictEqual(result.a.c, "static");
  });

  test("interpolates strings in arrays", () => {
    const input = ["${ctx.env}", "static"];
    const result = applyInterpolationDeep(input, {
      ctx: { env: "prod" },
      vars: {},
      warnings: [],
    });
    assert.deepStrictEqual(result, ["prod", "static"]);
  });

  test("preserves non-string values", () => {
    const input = { num: 42, bool: true, nil: null };
    const result = applyInterpolationDeep(input, {
      ctx: {},
      vars: {},
      warnings: [],
    });
    assert.deepStrictEqual(result, { num: 42, bool: true, nil: null });
  });
});
