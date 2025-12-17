import { test, describe } from "node:test";
import assert from "node:assert";
import { parseColony } from "../src/parser.js";

describe("parseColony", () => {
  describe("dimensions", () => {
    test("parses @dims directive", () => {
      const result = parseColony("@dims env, realm, region;");
      assert.deepStrictEqual(result.dims, ["env", "realm", "region"]);
    });

    test("returns null dims if not specified", () => {
      const result = parseColony("*.key = value;");
      assert.strictEqual(result.dims, null);
    });
  });

  describe("includes", () => {
    test("parses @include with quoted path", () => {
      const result = parseColony('@include "./base.colony";');
      assert.deepStrictEqual(result.includes, ["./base.colony"]);
    });

    test("parses @include with unquoted path", () => {
      const result = parseColony("@include ./base.colony;");
      assert.deepStrictEqual(result.includes, ["./base.colony"]);
    });

    test("parses multiple includes", () => {
      const result = parseColony('@include "./a.colony";\n@include "./b.colony";');
      assert.deepStrictEqual(result.includes, ["./a.colony", "./b.colony"]);
    });
  });

  describe("requires", () => {
    test("parses @require directive", () => {
      const result = parseColony("@require foo.bar, baz.qux;");
      assert.deepStrictEqual(result.requires, ["foo.bar", "baz.qux"]);
    });
  });

  describe("envDefaults", () => {
    test("parses @envDefaults directive", () => {
      const result = parseColony("@envDefaults env=dev, realm=US;");
      assert.deepStrictEqual(result.envDefaults, { env: "dev", realm: "US" });
    });
  });

  describe("rules", () => {
    test("parses simple rule with = operator", () => {
      const result = parseColony('*.key = "value";');
      assert.strictEqual(result.rules.length, 1);
      assert.strictEqual(result.rules[0].op, "=");
      assert.strictEqual(result.rules[0].value, "value");
    });

    test("parses rule with := operator", () => {
      const result = parseColony('*.key := "default";');
      assert.strictEqual(result.rules[0].op, ":=");
    });

    test("parses rule with |= operator", () => {
      const result = parseColony("*.key |= { a: 1 };");
      assert.strictEqual(result.rules[0].op, "|=");
      assert.deepStrictEqual(result.rules[0].value, { a: 1 });
    });

    test("parses rule with += operator", () => {
      const result = parseColony('*.list += "item";');
      assert.strictEqual(result.rules[0].op, "+=");
    });

    test("parses rule with -= operator", () => {
      const result = parseColony('*.list -= "item";');
      assert.strictEqual(result.rules[0].op, "-=");
    });

    test("parses bareword values", () => {
      const result = parseColony("*.key = bareword;");
      assert.strictEqual(result.rules[0].value, "bareword");
    });

    test("parses numeric values", () => {
      const result = parseColony("*.timeout = 1000;");
      assert.strictEqual(result.rules[0].value, 1000);
    });

    test("parses boolean values", () => {
      const result = parseColony("*.enabled = true;");
      assert.strictEqual(result.rules[0].value, true);
    });

    test("parses null values", () => {
      const result = parseColony("*.value = null;");
      assert.strictEqual(result.rules[0].value, null);
    });

    test("parses array values", () => {
      const result = parseColony('*.list = ["a", "b", "c"];');
      assert.deepStrictEqual(result.rules[0].value, ["a", "b", "c"]);
    });

    test("parses object values", () => {
      const result = parseColony('*.obj = { a: 1, b: "two" };');
      assert.deepStrictEqual(result.rules[0].value, { a: 1, b: "two" });
    });

    test("parses multi-line object values", () => {
      const result = parseColony(`*.obj = {
        a: 1,
        b: 2,
      };`);
      assert.deepStrictEqual(result.rules[0].value, { a: 1, b: 2 });
    });
  });

  describe("comments", () => {
    test("ignores # line comments", () => {
      const result = parseColony('# comment\n*.key = "value";');
      assert.strictEqual(result.rules.length, 1);
    });

    test("ignores // line comments", () => {
      const result = parseColony('// comment\n*.key = "value";');
      assert.strictEqual(result.rules.length, 1);
    });

    test("ignores block comments", () => {
      const result = parseColony('/* comment */ *.key = "value";');
      assert.strictEqual(result.rules.length, 1);
    });

    test("ignores multi-line block comments", () => {
      const result = parseColony(`/*
        multi-line
        comment
      */
      *.key = "value";`);
      assert.strictEqual(result.rules.length, 1);
    });

    test("handles nested block comments", () => {
      const result = parseColony('/* outer /* inner */ still comment */ *.key = "value";');
      assert.strictEqual(result.rules.length, 1);
    });
  });

  describe("escaped dots", () => {
    test("parses escaped dots in key names", () => {
      const result = parseColony('*.api\\.v2\\.endpoint = "url";');
      assert.deepStrictEqual(result.rules[0].keySegments, ["*", "api.v2.endpoint"]);
    });

    test("mixes escaped and unescaped dots", () => {
      const result = parseColony('*.foo\\.bar.baz = "value";');
      assert.deepStrictEqual(result.rules[0].keySegments, ["*", "foo.bar", "baz"]);
    });
  });

  describe("heredoc strings", () => {
    test("parses heredoc strings", () => {
      const result = parseColony(`*.template = <<EOF
line 1
line 2
EOF`);
      assert.strictEqual(result.rules[0].value, "line 1\nline 2");
    });

    test("preserves heredoc content exactly", () => {
      const result = parseColony(`*.sql = <<SQL
SELECT * FROM users
WHERE id = 1;
SQL`);
      assert.strictEqual(result.rules[0].value, "SELECT * FROM users\nWHERE id = 1;");
    });
  });

  describe("error handling", () => {
    test("throws on missing semicolon", () => {
      assert.throws(
        () => parseColony('*.key = "value"'),
        /Unterminated statement/
      );
    });

    test("throws on unterminated heredoc", () => {
      assert.throws(
        () => parseColony("*.key = <<EOF\nno end"),
        /Unterminated heredoc/
      );
    });

    test("throws on invalid JSON5 value", () => {
      assert.throws(
        () => parseColony('*.key = { invalid };'),
        /Bad JSON5 value/
      );
    });

    test("error includes line number", () => {
      try {
        parseColony('*.valid = "ok";\n*.invalid = { bad }');
      } catch (e) {
        assert.ok(e.message.includes(":2:"));
      }
    });
  });
});
