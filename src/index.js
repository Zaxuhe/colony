import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parseColony } from "./parser.js";
import { resolveRules } from "./resolver.js";
import {
  applySecretsDeep,
  SecretCache,
  hasGlobalProviders,
  registerSecretProvider,
  unregisterSecretProvider,
  clearSecretProviders,
} from "./secrets.js";

// Re-export secrets functions
export { registerSecretProvider, unregisterSecretProvider, clearSecretProviders };

// Re-export providers
export { AwsSecretsProvider } from "./providers/aws.js";
export { VaultProvider } from "./providers/vault.js";
export { OpenBaoProvider } from "./providers/openbao.js";

/**
 * @param {object} opts
 * @param {string} opts.entry
 * @param {string[]=} opts.dims
 * @param {Record<string,string>=} opts.ctx
 * @param {Record<string,string>=} opts.vars
 * @param {(cfg: any) => any=} opts.schema   // optional validation hook (e.g. zod.parse)
 * @param {object=} opts.sandbox   // security options
 * @param {string=} opts.sandbox.basePath   // restrict includes to this directory
 * @param {string[]=} opts.sandbox.allowedEnvVars   // whitelist of allowed env vars (null = allow all)
 * @param {number=} opts.sandbox.maxIncludeDepth   // max depth for includes (default 50)
 * @param {boolean=} opts.warnOnSkippedIncludes   // warn when skipping already-visited includes
 * @param {object=} opts.secrets   // secrets provider options
 * @param {Array=} opts.secrets.providers   // secret providers (e.g. AwsSecretsProvider)
 * @param {string[]=} opts.secrets.allowedSecrets   // whitelist of allowed secret patterns
 * @param {object=} opts.secrets.cache   // cache options
 * @param {string=} opts.secrets.onNotFound   // 'empty' | 'warn' | 'error' (default: 'warn')
 * @returns {Promise<object>}
 */
export async function loadColony(opts) {
  const entry = opts?.entry;
  if (!entry) throw new Error("loadColony: opts.entry is required");

  const sandbox = opts.sandbox ?? {};
  const basePath = sandbox.basePath ? path.resolve(sandbox.basePath) : null;
  const maxIncludeDepth = sandbox.maxIncludeDepth ?? 50;
  const maxFileSize = sandbox.maxFileSize ?? null;
  const warnOnSkippedIncludes = opts.warnOnSkippedIncludes ?? false;

  const visited = new Set();
  const warnings = [];
  const files = await expandIncludes(entry, visited, {
    basePath,
    maxIncludeDepth,
    maxFileSize,
    warnOnSkippedIncludes,
    warnings,
  });

  const parsed = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    parsed.push(parseColony(text, { filePath: file }));
  }

  const dims =
    (Array.isArray(opts.dims) && opts.dims.length ? opts.dims : null) ??
    parsed.find((p) => p.dims?.length)?.dims ??
    ["env"];

  // ctx precedence: opts.ctx overrides, else @envDefaults, else sensible defaults
  const envDefaults = mergeEnvDefaults(parsed.map((p) => p.envDefaults ?? {}));
  const ctx = {
    ...envDefaults,
    env: process.env.NODE_ENV ?? "dev",
    ...opts.ctx,
  };

  const vars = { ROOT: process.cwd(), ...(opts.vars ?? {}) };

  // Collect requires from all parsed files
  const requires = parsed.flatMap((p) => p.requires ?? []);

  const allRules = parsed.flatMap((p) => p.rules);

  const allowedEnvVars = sandbox.allowedEnvVars ?? null;
  const allowedVars = sandbox.allowedVars ?? null;
  let cfg = resolveRules({ rules: allRules, dims, ctx, vars, allowedEnvVars, allowedVars, warnings });

  // Apply secrets if providers are configured
  const secretsOpts = opts.secrets ?? {};
  if (secretsOpts.providers?.length || hasGlobalProviders()) {
    const cacheOpts = secretsOpts.cache ?? {};
    const cache = cacheOpts.enabled !== false
      ? new SecretCache(cacheOpts.maxSize ?? 100)
      : null;

    const secretified = await applySecretsDeep(cfg, {
      providers: secretsOpts.providers ?? [],
      allowedSecrets: secretsOpts.allowedSecrets ?? null,
      cache,
      cacheTtl: cacheOpts.ttl ?? 300000,
      onNotFound: secretsOpts.onNotFound ?? "warn",
      warnings,
    });

    // Copy config methods to new object
    copyConfigMethods(secretified, cfg, warnings);
    cfg = secretified;
  }

  // Enforce @require after resolution
  const missing = [];
  for (const reqKey of requires) {
    if (cfg.get(reqKey) === undefined) missing.push(reqKey);
  }
  if (missing.length) {
    throw new Error(
      `COLONY @require failed (missing keys):\n` +
      missing.map((k) => `  - ${k}`).join("\n")
    );
  }

  // Attach warnings as non-enumerable
  Object.defineProperty(cfg, "_warnings", { enumerable: false, value: warnings });

  // Optional schema validation hook (supports both sync and async)
  if (typeof opts.schema === "function") {
    const result = opts.schema(cfg);

    // Handle async schema validators (e.g., async Zod, Joi)
    if (result && typeof result.then === "function") {
      const validated = await result;
      if (validated && validated !== cfg) {
        copyConfigMethods(validated, cfg, warnings);
        return validated;
      }
    } else if (result && result !== cfg) {
      copyConfigMethods(result, cfg, warnings);
      return result;
    }
  }

  return cfg;
}

/**
 * Copy non-enumerable config methods to validated object
 */
function copyConfigMethods(target, source, warnings) {
  Object.defineProperties(target, {
    get: { enumerable: false, value: source.get },
    explain: { enumerable: false, value: source.explain },
    toJSON: { enumerable: false, value: source.toJSON },
    keys: { enumerable: false, value: source.keys },
    diff: { enumerable: false, value: source.diff },
    _trace: { enumerable: false, value: source._trace },
    _warnings: { enumerable: false, value: warnings },
  });
}

function mergeEnvDefaults(list) {
  const out = {};
  for (const m of list) {
    for (const [k, v] of Object.entries(m)) out[k] = v;
  }
  return out;
}

async function expandIncludes(entry, visited, { basePath, maxIncludeDepth, maxFileSize, warnOnSkippedIncludes, warnings }) {
  const absEntry = path.resolve(entry);
  const out = [];
  await dfs(absEntry, 0);
  return out;

  async function dfs(file, depth) {
    if (depth > maxIncludeDepth) {
      throw new Error(`COLONY: Max include depth (${maxIncludeDepth}) exceeded at: ${file}`);
    }

    const abs = path.resolve(file);

    if (visited.has(abs)) {
      if (warnOnSkippedIncludes) {
        warnings.push({ type: "skipped_include", file: abs, message: `Skipping already-visited include: ${abs}` });
      }
      return;
    }
    visited.add(abs);

    // Check file size if limit is set
    if (maxFileSize !== null) {
      const stat = await fs.stat(abs);
      if (stat.size > maxFileSize) {
        throw new Error(`COLONY: File size (${stat.size} bytes) exceeds maxFileSize (${maxFileSize} bytes): ${abs}`);
      }
    }

    const text = await fs.readFile(abs, "utf8");
    const { includes } = parseColony(text, { filePath: abs, parseOnlyDirectives: true });

    for (const inc of includes) {
      const incAbs = path.resolve(path.dirname(abs), inc);

      // Security: validate path is within basePath if set
      if (basePath !== null) {
        const normalizedInc = path.normalize(incAbs);
        if (!normalizedInc.startsWith(basePath + path.sep) && normalizedInc !== basePath) {
          throw new Error(
            `COLONY: Path traversal blocked. Include "${inc}" resolves to "${normalizedInc}" which is outside basePath "${basePath}"`
          );
        }
      }

      const matches = await fg(incAbs.replace(/\\/g, "/"), { dot: true });
      // Sort alphabetically for deterministic ordering across platforms/filesystems
      for (const m of matches.sort((a, b) => a.localeCompare(b))) {
        // Also validate glob matches against basePath
        if (basePath !== null) {
          const normalizedMatch = path.normalize(m);
          if (!normalizedMatch.startsWith(basePath + path.sep) && normalizedMatch !== basePath) {
            throw new Error(
              `COLONY: Path traversal blocked. Glob match "${m}" is outside basePath "${basePath}"`
            );
          }
        }
        await dfs(m, depth + 1);
      }
    }

    out.push(abs);
  }
}

/**
 * Validate syntax of colony files without resolving
 * @param {string} entry - Entry file path
 * @returns {Promise<{valid: boolean, files: string[], errors: Array<{file: string, error: string}>}>}
 */
export async function validateColony(entry) {
  const visited = new Set();
  const files = [];
  const errors = [];

  await validateDfs(path.resolve(entry));

  return {
    valid: errors.length === 0,
    files,
    errors,
  };

  async function validateDfs(file) {
    const abs = path.resolve(file);
    if (visited.has(abs)) return;
    visited.add(abs);

    try {
      const text = await fs.readFile(abs, "utf8");
      const { includes } = parseColony(text, { filePath: abs });
      files.push(abs);

      for (const inc of includes) {
        const incAbs = path.resolve(path.dirname(abs), inc);
        const matches = await fg(incAbs.replace(/\\/g, "/"), { dot: true });
        for (const m of matches.sort((a, b) => a.localeCompare(b))) {
          await validateDfs(m);
        }
      }
    } catch (e) {
      errors.push({ file: abs, error: e.message });
    }
  }
}

/**
 * Dry-run: list all files that would be included
 * @param {string} entry - Entry file path
 * @returns {Promise<string[]>}
 */
export async function dryRunIncludes(entry) {
  const visited = new Set();
  const files = [];
  await dryRunDfs(path.resolve(entry));
  return files;

  async function dryRunDfs(file) {
    const abs = path.resolve(file);
    if (visited.has(abs)) return;
    visited.add(abs);

    const text = await fs.readFile(abs, "utf8");
    const { includes } = parseColony(text, { filePath: abs, parseOnlyDirectives: true });

    for (const inc of includes) {
      const incAbs = path.resolve(path.dirname(abs), inc);
      const matches = await fg(incAbs.replace(/\\/g, "/"), { dot: true });
      for (const m of matches.sort((a, b) => a.localeCompare(b))) {
        await dryRunDfs(m);
      }
    }

    files.push(abs);
  }
}

/**
 * Compare two configs loaded with different contexts
 * @param {object} opts - Same options as loadColony, but with ctx1 and ctx2
 * @param {Record<string,string>} opts.ctx1 - First context
 * @param {Record<string,string>} opts.ctx2 - Second context
 * @returns {Promise<{cfg1: object, cfg2: object, diff: object}>}
 */
export async function diffColony(opts) {
  const { ctx1, ctx2, ...baseOpts } = opts;

  if (!ctx1 || !ctx2) {
    throw new Error("diffColony: both ctx1 and ctx2 are required");
  }

  const cfg1 = await loadColony({ ...baseOpts, ctx: ctx1 });
  const cfg2 = await loadColony({ ...baseOpts, ctx: ctx2 });

  return {
    cfg1,
    cfg2,
    diff: cfg1.diff(cfg2),
  };
}

/**
 * Lint colony files for potential issues
 * @param {object} opts
 * @param {string} opts.entry - Entry file path
 * @param {string[]=} opts.dims - Dimension names
 * @returns {Promise<{issues: Array<{type: string, severity: string, message: string, file?: string, line?: number}>}>}
 */
export async function lintColony(opts) {
  const entry = opts?.entry;
  if (!entry) throw new Error("lintColony: opts.entry is required");

  const issues = [];
  const visited = new Set();
  const allRules = [];
  const allFiles = [];
  let foundDims = null;

  // Collect all rules from all files
  await collectRules(path.resolve(entry));

  async function collectRules(file) {
    const abs = path.resolve(file);
    if (visited.has(abs)) return;
    visited.add(abs);

    try {
      const text = await fs.readFile(abs, "utf8");
      const parsed = parseColony(text, { filePath: abs });
      allFiles.push(abs);

      // Capture dims from first file that has them
      if (!foundDims && parsed.dims?.length) {
        foundDims = parsed.dims;
      }

      for (const rule of parsed.rules) {
        allRules.push({ ...rule, filePath: abs });
      }

      for (const inc of parsed.includes) {
        const incAbs = path.resolve(path.dirname(abs), inc);
        const matches = await fg(incAbs.replace(/\\/g, "/"), { dot: true });
        for (const m of matches.sort((a, b) => a.localeCompare(b))) {
          await collectRules(m);
        }
      }
    } catch (e) {
      issues.push({
        type: "parse_error",
        severity: "error",
        message: e.message,
        file: abs,
      });
    }
  }

  // Get dims from options, or from parsed files, or default
  const dims = opts.dims ?? foundDims ?? ["env"];

  // Check for shadowed rules (same key, same scope, different values)
  const rulesByKey = new Map();
  for (const rule of allRules) {
    const scope = rule.keySegments.slice(0, dims.length).join(".");
    const keyPath = rule.keySegments.slice(dims.length).join(".");
    const key = `${scope}|${keyPath}`;

    if (!rulesByKey.has(key)) {
      rulesByKey.set(key, []);
    }
    rulesByKey.get(key).push(rule);
  }

  for (const [key, rules] of rulesByKey.entries()) {
    if (rules.length > 1) {
      // Check if they're in different files or same file
      const locations = rules.map((r) => `${r.filePath}:${r.line}`);
      const uniqueLocations = new Set(locations);

      if (uniqueLocations.size > 1) {
        const [scope, keyPath] = key.split("|");
        issues.push({
          type: "shadowed_rule",
          severity: "warning",
          message: `Rule "${scope}.${keyPath}" is defined ${rules.length} times. Later rule wins.`,
          file: rules[rules.length - 1].filePath,
          line: rules[rules.length - 1].line,
        });
      }
    }
  }

  // Check for potentially unused wildcard rules
  // (rules with all wildcards that might be overridden by more specific rules)
  for (const rule of allRules) {
    const scope = rule.keySegments.slice(0, dims.length);
    const keyPath = rule.keySegments.slice(dims.length).join(".");

    if (scope.every((s) => s === "*")) {
      // Check if there are more specific rules for the same key
      const moreSpecific = allRules.filter((r) => {
        const rKeyPath = r.keySegments.slice(dims.length).join(".");
        if (rKeyPath !== keyPath) return false;
        const rScope = r.keySegments.slice(0, dims.length);
        return rScope.some((s) => s !== "*") && r !== rule;
      });

      if (moreSpecific.length > 0) {
        issues.push({
          type: "overridden_wildcard",
          severity: "info",
          message: `Wildcard rule for "${keyPath}" is overridden by ${moreSpecific.length} more specific rule(s)`,
          file: rule.filePath,
          line: rule.line,
        });
      }
    }
  }

  // Check for empty includes
  for (const file of allFiles) {
    try {
      const text = await fs.readFile(file, "utf8");
      const parsed = parseColony(text, { filePath: file });

      for (const inc of parsed.includes) {
        const incAbs = path.resolve(path.dirname(file), inc);
        const matches = await fg(incAbs.replace(/\\/g, "/"), { dot: true });
        if (matches.length === 0) {
          issues.push({
            type: "empty_include",
            severity: "warning",
            message: `Include pattern "${inc}" matches no files`,
            file,
          });
        }
      }
    } catch {}
  }

  return { issues };
}
