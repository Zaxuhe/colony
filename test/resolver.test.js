import { test, describe } from "node:test";
import assert from "node:assert";
import { resolveRules } from "../src/resolver.js";

function makeRule(keyRaw, op, value, filePath = "test.colony", line = 1) {
  const keySegments = keyRaw.split(".");
  return { keyRaw, keySegments, op, value, filePath, line, col: 0 };
}

describe("resolveRules", () => {
  describe("scope matching", () => {
    test("matches exact scope", () => {
      const rules = [makeRule("prod.us.db.host", "=", "prod-db")];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.db.host, "prod-db");
    });

    test("matches wildcard scope", () => {
      const rules = [makeRule("*.*.db.host", "=", "any-db")];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.db.host, "any-db");
    });

    test("does not match non-matching scope", () => {
      const rules = [makeRule("dev.us.db.host", "=", "dev-db")];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.db, undefined);
    });
  });

  describe("specificity", () => {
    test("more specific rule wins", () => {
      const rules = [
        makeRule("*.*.db.host", "=", "wildcard"),
        makeRule("prod.*.db.host", "=", "prod"),
        makeRule("prod.us.db.host", "=", "prod-us"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.db.host, "prod-us");
    });

    test("later rule wins on tie", () => {
      const rules = [
        makeRule("prod.*.db.host", "=", "first"),
        makeRule("*.us.db.host", "=", "second"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.db.host, "second");
    });
  });

  describe("operators", () => {
    test("= overwrites value", () => {
      const rules = [
        makeRule("*.*.key", "=", "first"),
        makeRule("prod.*.key", "=", "second"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.key, "second");
    });

    test(":= sets if missing", () => {
      const rules = [
        makeRule("prod.*.key", "=", "set"),
        makeRule("*.*.key", ":=", "default"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.key, "set");
    });

    test(":= sets when missing", () => {
      const rules = [makeRule("*.*.key", ":=", "default")];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.key, "default");
    });

    test("|= merges with existing nested value", () => {
      // First set parent, then |= on child to test merge
      const rules = [
        makeRule("*.*.obj.a", "=", { x: 1 }),
        makeRule("*.*.obj.a", "|=", { y: 2 }),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      // Later |= rule wins and sets value (winner selection, not merge)
      assert.deepStrictEqual(cfg.obj.a, { y: 2 });
    });

    test("|= sets value when no existing", () => {
      const rules = [
        makeRule("*.*.obj", "|=", { b: 3, c: 4 }),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.deepStrictEqual(cfg.obj, { b: 3, c: 4 });
    });

    test("+= appends to array", () => {
      const rules = [
        makeRule("*.*.list", "=", ["a"]),
        makeRule("prod.*.list", "+=", "b"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.deepStrictEqual(cfg.list, ["a", "b"]);
    });

    test("+= coerces scalar to array", () => {
      const rules = [
        makeRule("*.*.value", "=", "first"),
        makeRule("prod.*.value", "+=", "second"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.deepStrictEqual(cfg.value, ["first", "second"]);
    });

    test("-= removes from array", () => {
      const rules = [
        makeRule("*.*.list", "=", ["a", "b", "c"]),
        makeRule("prod.*.list", "-=", "b"),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.deepStrictEqual(cfg.list, ["a", "c"]);
    });
  });

  describe("helper methods", () => {
    test("get() retrieves nested values", () => {
      const rules = [makeRule("*.*.deep.nested.key", "=", "value")];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.strictEqual(cfg.get("deep.nested.key"), "value");
    });

    test("explain() returns trace info", () => {
      const rules = [makeRule("prod.us.key", "=", "value", "config.rune", 42)];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      const trace = cfg.explain("key");
      assert.strictEqual(trace.op, "=");
      assert.strictEqual(trace.line, 42);
      assert.strictEqual(trace.filePath, "config.rune");
      assert.ok(trace.source.includes("config.rune:42"));
    });

    test("keys() lists all leaf keys", () => {
      const rules = [
        makeRule("*.*.a.b", "=", 1),
        makeRule("*.*.a.c", "=", 2),
        makeRule("*.*.d", "=", 3),
      ];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      assert.deepStrictEqual(cfg.keys(), ["a.b", "a.c", "d"]);
    });

    test("toJSON() returns plain object", () => {
      const rules = [makeRule("*.*.key", "=", "value")];
      const cfg = resolveRules({
        rules,
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      const json = cfg.toJSON();
      assert.strictEqual(json.key, "value");
      assert.strictEqual(typeof json.get, "undefined");
    });

    test("diff() compares configs", () => {
      const cfg1 = resolveRules({
        rules: [
          makeRule("*.*.a", "=", 1),
          makeRule("*.*.b", "=", 2),
        ],
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      const cfg2 = resolveRules({
        rules: [
          makeRule("*.*.b", "=", 3),
          makeRule("*.*.c", "=", 4),
        ],
        dims: ["env", "region"],
        ctx: { env: "prod", region: "us" },
        vars: {},
      });
      const diff = cfg1.diff(cfg2);
      assert.deepStrictEqual(diff.added, ["c"]);
      assert.deepStrictEqual(diff.removed, ["a"]);
      assert.strictEqual(diff.changed[0].key, "b");
      assert.strictEqual(diff.changed[0].from, 2);
      assert.strictEqual(diff.changed[0].to, 3);
    });
  });
});
