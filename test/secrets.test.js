import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  collectSecretRefs,
  applySecretsDeep,
  registerSecretProvider,
  unregisterSecretProvider,
  clearSecretProviders,
  SecretCache,
} from "../src/secrets.js";

describe("secrets", () => {
  describe("collectSecretRefs", () => {
    test("finds secret references in strings", () => {
      const refs = collectSecretRefs("db: ${AWS:myapp/db}");
      assert.strictEqual(refs.size, 1);
      assert.ok(refs.has("AWS:myapp/db"));
    });

    test("finds multiple refs in one string", () => {
      const refs = collectSecretRefs("${AWS:user} ${AWS:pass}");
      assert.strictEqual(refs.size, 2);
      assert.ok(refs.has("AWS:user"));
      assert.ok(refs.has("AWS:pass"));
    });

    test("ignores ENV and VAR prefixes (reserved)", () => {
      const refs = collectSecretRefs("${ENV:FOO} ${VAR:BAR} ${AWS:secret}");
      assert.strictEqual(refs.size, 1);
      assert.ok(refs.has("AWS:secret"));
      assert.ok(!refs.has("ENV:FOO"));
      assert.ok(!refs.has("VAR:BAR"));
    });

    test("finds refs in nested objects", () => {
      const refs = collectSecretRefs({
        a: { b: "${AWS:one}" },
        c: ["${VAULT:two}"],
      });
      assert.strictEqual(refs.size, 2);
      assert.ok(refs.has("AWS:one"));
      assert.ok(refs.has("VAULT:two"));
    });

    test("finds refs in arrays", () => {
      const refs = collectSecretRefs(["${AWS:first}", "${AWS:second}"]);
      assert.strictEqual(refs.size, 2);
    });

    test("handles values without refs", () => {
      const refs = collectSecretRefs({ foo: "bar", num: 42 });
      assert.strictEqual(refs.size, 0);
    });

    test("supports provider-specific prefixes", () => {
      const refs = collectSecretRefs("${CUSTOM_PROVIDER:key}");
      assert.strictEqual(refs.size, 1);
      assert.ok(refs.has("CUSTOM_PROVIDER:key"));
    });
  });

  describe("SecretCache", () => {
    test("stores and retrieves values", () => {
      const cache = new SecretCache(10);
      cache.set("key1", "value1", 60000);
      assert.strictEqual(cache.get("key1"), "value1");
    });

    test("returns undefined for missing keys", () => {
      const cache = new SecretCache(10);
      assert.strictEqual(cache.get("missing"), undefined);
    });

    test("expires values after TTL", async () => {
      const cache = new SecretCache(10);
      cache.set("key1", "value1", 10); // 10ms TTL
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(cache.get("key1"), undefined);
    });

    test("respects maxSize with LRU eviction", () => {
      const cache = new SecretCache(2);
      cache.set("key1", "value1", 60000);
      cache.set("key2", "value2", 60000);
      cache.set("key3", "value3", 60000); // Evicts key1
      assert.strictEqual(cache.get("key1"), undefined);
      assert.strictEqual(cache.get("key2"), "value2");
      assert.strictEqual(cache.get("key3"), "value3");
    });

    test("invalidate clears all when no pattern", () => {
      const cache = new SecretCache(10);
      cache.set("key1", "value1", 60000);
      cache.set("key2", "value2", 60000);
      cache.invalidate();
      assert.strictEqual(cache.get("key1"), undefined);
      assert.strictEqual(cache.get("key2"), undefined);
    });

    test("invalidate clears matching pattern", () => {
      const cache = new SecretCache(10);
      cache.set("AWS:secret1", "v1", 60000);
      cache.set("AWS:secret2", "v2", 60000);
      cache.set("VAULT:secret3", "v3", 60000);
      cache.invalidate("AWS:*");
      assert.strictEqual(cache.get("AWS:secret1"), undefined);
      assert.strictEqual(cache.get("AWS:secret2"), undefined);
      assert.strictEqual(cache.get("VAULT:secret3"), "v3");
    });
  });

  describe("applySecretsDeep", () => {
    beforeEach(() => clearSecretProviders());
    afterEach(() => clearSecretProviders());

    test("replaces secrets with provider values", async () => {
      const mockProvider = {
        prefix: "MOCK",
        fetch: async (key) => `secret-${key}`,
      };

      const result = await applySecretsDeep(
        { password: "${MOCK:db-pass}" },
        { providers: [mockProvider], warnings: [] }
      );

      assert.strictEqual(result.password, "secret-db-pass");
    });

    test("handles multiple secrets in one string", async () => {
      const mockProvider = {
        prefix: "MOCK",
        fetch: async (key) => key.toUpperCase(),
      };

      const result = await applySecretsDeep(
        { conn: "${MOCK:user}:${MOCK:pass}@db" },
        { providers: [mockProvider], warnings: [] }
      );

      assert.strictEqual(result.conn, "USER:PASS@db");
    });

    test("applies secrets in nested objects", async () => {
      const mockProvider = {
        prefix: "MOCK",
        fetch: async (key) => `value-${key}`,
      };

      const result = await applySecretsDeep(
        { db: { password: "${MOCK:pw}" } },
        { providers: [mockProvider], warnings: [] }
      );

      assert.strictEqual(result.db.password, "value-pw");
    });

    test("applies secrets in arrays", async () => {
      const mockProvider = {
        prefix: "MOCK",
        fetch: async (key) => `v-${key}`,
      };

      const result = await applySecretsDeep(
        { hosts: ["${MOCK:h1}", "${MOCK:h2}"] },
        { providers: [mockProvider], warnings: [] }
      );

      assert.deepStrictEqual(result.hosts, ["v-h1", "v-h2"]);
    });

    test("blocks secrets not in allowlist", async () => {
      const warnings = [];
      const mockProvider = {
        prefix: "MOCK",
        fetch: async () => "secret",
      };

      const result = await applySecretsDeep(
        { password: "${MOCK:blocked}" },
        {
          providers: [mockProvider],
          allowedSecrets: ["other/*"],
          warnings,
        }
      );

      assert.strictEqual(result.password, "");
      assert.ok(warnings.some((w) => w.type === "blocked_secret"));
    });

    test("allows secrets matching glob pattern", async () => {
      const warnings = [];
      const mockProvider = {
        prefix: "MOCK",
        fetch: async () => "allowed-value",
      };

      const result = await applySecretsDeep(
        { password: "${MOCK:myapp/db/pass}" },
        {
          providers: [mockProvider],
          allowedSecrets: ["myapp/*"],
          warnings,
        }
      );

      assert.strictEqual(result.password, "allowed-value");
      assert.ok(!warnings.some((w) => w.type === "blocked_secret"));
    });

    test("allows secrets matching exact pattern", async () => {
      const mockProvider = {
        prefix: "MOCK",
        fetch: async () => "exact-value",
      };

      const result = await applySecretsDeep(
        { password: "${MOCK:specific-key}" },
        {
          providers: [mockProvider],
          allowedSecrets: ["MOCK:specific-key"],
          warnings: [],
        }
      );

      assert.strictEqual(result.password, "exact-value");
    });

    test("warns on unknown provider", async () => {
      const warnings = [];
      const result = await applySecretsDeep(
        { val: "${UNKNOWN:key}" },
        { warnings }
      );

      assert.strictEqual(result.val, "");
      assert.ok(warnings.some((w) => w.type === "unknown_provider"));
    });

    test("uses globally registered providers", async () => {
      const globalProvider = {
        prefix: "GLOBAL",
        fetch: async (key) => `global-${key}`,
      };
      registerSecretProvider(globalProvider);

      const result = await applySecretsDeep(
        { val: "${GLOBAL:test}" },
        { warnings: [] }
      );

      assert.strictEqual(result.val, "global-test");
    });

    test("local providers override global", async () => {
      const globalProvider = {
        prefix: "TEST",
        fetch: async () => "global",
      };
      const localProvider = {
        prefix: "TEST",
        fetch: async () => "local",
      };
      registerSecretProvider(globalProvider);

      const result = await applySecretsDeep(
        { val: "${TEST:key}" },
        { providers: [localProvider], warnings: [] }
      );

      assert.strictEqual(result.val, "local");
    });

    test("handles fetch errors gracefully (onNotFound=warn)", async () => {
      const warnings = [];
      const failingProvider = {
        prefix: "FAIL",
        fetch: async () => {
          throw new Error("Connection refused");
        },
      };

      const result = await applySecretsDeep(
        { val: "${FAIL:key}" },
        {
          providers: [failingProvider],
          onNotFound: "warn",
          warnings,
        }
      );

      assert.strictEqual(result.val, "");
      assert.ok(warnings.some((w) => w.type === "secret_fetch_error"));
    });

    test("throws on fetch error when onNotFound=error", async () => {
      const failingProvider = {
        prefix: "FAIL",
        fetch: async () => {
          throw new Error("Connection refused");
        },
      };

      await assert.rejects(
        async () =>
          applySecretsDeep(
            { val: "${FAIL:key}" },
            { providers: [failingProvider], onNotFound: "error", warnings: [] }
          ),
        /Connection refused/
      );
    });

    test("handles not found errors (onNotFound=warn)", async () => {
      const warnings = [];
      const notFoundProvider = {
        prefix: "NF",
        fetch: async () => {
          const err = new Error("Secret not found");
          err.code = "NOT_FOUND";
          throw err;
        },
      };

      const result = await applySecretsDeep(
        { val: "${NF:missing}" },
        {
          providers: [notFoundProvider],
          onNotFound: "warn",
          warnings,
        }
      );

      assert.strictEqual(result.val, "");
      assert.ok(warnings.some((w) => w.type === "secret_not_found"));
    });

    test("caches fetched secrets", async () => {
      let fetchCount = 0;
      const countingProvider = {
        prefix: "COUNT",
        fetch: async (key) => {
          fetchCount++;
          return `value-${key}`;
        },
      };

      const cache = new SecretCache(10);
      const opts = {
        providers: [countingProvider],
        cache,
        cacheTtl: 60000,
        warnings: [],
      };

      // First call should fetch
      await applySecretsDeep({ a: "${COUNT:key}" }, opts);
      assert.strictEqual(fetchCount, 1);

      // Second call should use cache
      await applySecretsDeep({ b: "${COUNT:key}" }, opts);
      assert.strictEqual(fetchCount, 1);
    });

    test("preserves non-string values", async () => {
      const mockProvider = {
        prefix: "MOCK",
        fetch: async () => "secret",
      };

      const result = await applySecretsDeep(
        { num: 42, bool: true, nil: null },
        { providers: [mockProvider], warnings: [] }
      );

      assert.strictEqual(result.num, 42);
      assert.strictEqual(result.bool, true);
      assert.strictEqual(result.nil, null);
    });

    test("returns original value when no secret refs", async () => {
      const result = await applySecretsDeep(
        { plain: "value", nested: { foo: "bar" } },
        { warnings: [] }
      );

      assert.strictEqual(result.plain, "value");
      assert.strictEqual(result.nested.foo, "bar");
    });
  });

  describe("provider registration", () => {
    beforeEach(() => clearSecretProviders());
    afterEach(() => clearSecretProviders());

    test("registerSecretProvider adds provider", async () => {
      const provider = {
        prefix: "REG",
        fetch: async () => "registered",
      };
      registerSecretProvider(provider);

      const result = await applySecretsDeep(
        { val: "${REG:key}" },
        { warnings: [] }
      );

      assert.strictEqual(result.val, "registered");
    });

    test("unregisterSecretProvider removes provider", async () => {
      const provider = {
        prefix: "UNREG",
        fetch: async () => "value",
      };
      registerSecretProvider(provider);
      const removed = unregisterSecretProvider("UNREG");

      assert.strictEqual(removed, true);

      const warnings = [];
      await applySecretsDeep({ val: "${UNREG:key}" }, { warnings });
      assert.ok(warnings.some((w) => w.type === "unknown_provider"));
    });

    test("clearSecretProviders removes all", async () => {
      registerSecretProvider({ prefix: "A", fetch: async () => "a" });
      registerSecretProvider({ prefix: "B", fetch: async () => "b" });
      clearSecretProviders();

      const warnings = [];
      await applySecretsDeep({ val: "${A:key}" }, { warnings });
      assert.ok(warnings.some((w) => w.type === "unknown_provider"));
    });

    test("throws on invalid provider", () => {
      assert.throws(
        () => registerSecretProvider({}),
        /Invalid provider/
      );
      assert.throws(
        () => registerSecretProvider({ prefix: "X" }),
        /Invalid provider/
      );
    });

    test("provider prefix is case-insensitive", async () => {
      const provider = {
        prefix: "lower",
        fetch: async () => "value",
      };
      registerSecretProvider(provider);

      const result = await applySecretsDeep(
        { val: "${LOWER:key}" },
        { warnings: [] }
      );

      assert.strictEqual(result.val, "value");
    });
  });
});
