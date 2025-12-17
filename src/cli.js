#!/usr/bin/env node
import { loadColony, validateColony, dryRunIncludes, diffColony, lintColony } from "./index.js";
import { getByPath } from "./util.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function parseCtx(s) {
  const out = {};
  if (!s || s === true) return out;
  const parts = String(s).split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    out[p.slice(0, idx)] = p.slice(idx + 1);
  }
  return out;
}

function printUsage() {
  console.error(`Usage:
  colony print --entry ./config/app.colony [options]
  colony validate --entry ./config/app.colony
  colony dry-run --entry ./config/app.colony
  colony diff --entry ./config/app.colony --ctx1 "env=dev" --ctx2 "env=prod"
  colony keys --entry ./config/app.colony [--ctx "..."]
  colony env --entry ./config/app.colony [--ctx "..."]
  colony lint --entry ./config/app.colony

Commands:
  print      Resolve and print the configuration
  validate   Check syntax of all colony files without resolving
  dry-run    List all files that would be included
  diff       Compare configs between two contexts
  keys       List all config keys in dot notation
  env        Output config as KEY=value for shell sourcing
  lint       Check for potential issues (unused rules, shadows, etc.)

Options for 'print':
  --entry <file>           Entry colony file (required)
  --dims <d1,d2,...>       Dimension names (comma-separated)
  --ctx "k1=v1 k2=v2"      Context values (space-separated key=value pairs)
  --format <json|env>      Output format (default: json)
  --query <key.path>       Extract specific value (like jq)
  --explain <key.path>     Show which rule set a specific key
  --base-path <dir>        Restrict includes to this directory (security)
  --allowed-env <v1,v2>    Whitelist of allowed env vars (security)
  --allowed-vars <v1,v2>   Whitelist of allowed custom vars (security)
  --max-file-size <bytes>  Maximum file size for includes (security)
  --warn-skipped           Warn when skipping already-visited includes
  --show-warnings          Show all warnings after output
  --strict                 Exit with error if there are any warnings

Options for 'diff':
  --entry <file>           Entry colony file (required)
  --dims <d1,d2,...>       Dimension names (comma-separated)
  --ctx1 "k1=v1 ..."       First context
  --ctx2 "k1=v1 ..."       Second context
  --format <json|text>     Output format (default: text)
`);
}

function formatDiff(diff, format = "text") {
  if (format === "json") {
    return JSON.stringify(diff, null, 2);
  }

  const lines = [];

  if (diff.added.length > 0) {
    lines.push("Added:");
    for (const key of diff.added) {
      lines.push(`  + ${key}`);
    }
  }

  if (diff.removed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Removed:");
    for (const key of diff.removed) {
      lines.push(`  - ${key}`);
    }
  }

  if (diff.changed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Changed:");
    for (const { key, from, to } of diff.changed) {
      lines.push(`  ~ ${key}`);
      lines.push(`    from: ${JSON.stringify(from)}`);
      lines.push(`    to:   ${JSON.stringify(to)}`);
    }
  }

  if (lines.length === 0) {
    return "No differences found.";
  }

  return lines.join("\n");
}

/**
 * Format config as KEY=value for shell sourcing
 */
function formatAsEnv(cfg, prefix = "") {
  const lines = [];

  function flatten(obj, currentPrefix) {
    for (const [key, value] of Object.entries(obj)) {
      const envKey = currentPrefix
        ? `${currentPrefix}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
        : key.toUpperCase().replace(/[^A-Z0-9_]/g, "_");

      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        flatten(value, envKey);
      } else {
        const envValue = typeof value === "string"
          ? value
          : JSON.stringify(value);
        // Escape single quotes for shell
        const escaped = envValue.replace(/'/g, "'\\''");
        lines.push(`${envKey}='${escaped}'`);
      }
    }
  }

  flatten(cfg, prefix);
  return lines.sort().join("\n");
}

(async () => {
  try {
    const args = parseArgs(process.argv);
    const cmd = args._[0];

    if (!cmd || cmd === "help" || args.help) {
      printUsage();
      process.exit(cmd === "help" || args.help ? 0 : 1);
    }

    const entry = args.entry;
    if (!entry) {
      console.error("Error: Missing --entry\n");
      printUsage();
      process.exit(1);
    }

    // Handle validate command
    if (cmd === "validate") {
      const result = await validateColony(entry);
      if (result.valid) {
        console.log(`✓ All ${result.files.length} file(s) valid:`);
        for (const f of result.files) {
          console.log(`  ${f}`);
        }
        process.exit(0);
      } else {
        console.error(`✗ Validation failed with ${result.errors.length} error(s):`);
        for (const e of result.errors) {
          console.error(`\n  ${e.file}:`);
          console.error(`    ${e.error}`);
        }
        process.exit(1);
      }
    }

    // Handle dry-run command
    if (cmd === "dry-run") {
      const files = await dryRunIncludes(entry);
      console.log(`Files that would be included (${files.length}):`);
      for (const f of files) {
        console.log(`  ${f}`);
      }
      process.exit(0);
    }

    // Handle diff command
    if (cmd === "diff") {
      if (!args.ctx1 || !args.ctx2) {
        console.error("Error: diff command requires both --ctx1 and --ctx2\n");
        printUsage();
        process.exit(1);
      }

      const dims = typeof args.dims === "string"
        ? args.dims.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      const ctx1 = parseCtx(args.ctx1);
      const ctx2 = parseCtx(args.ctx2);

      const result = await diffColony({ entry, dims, ctx1, ctx2 });

      const format = args.format || "text";
      console.log(formatDiff(result.diff, format));

      // Exit with code 1 if there are differences (useful for CI)
      const hasDiffs = result.diff.added.length > 0 ||
                       result.diff.removed.length > 0 ||
                       result.diff.changed.length > 0;
      process.exit(hasDiffs ? 1 : 0);
    }

    // Handle lint command
    if (cmd === "lint") {
      const dims = typeof args.dims === "string"
        ? args.dims.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      const result = await lintColony({ entry, dims });

      if (result.issues.length === 0) {
        console.log("✓ No issues found");
        process.exit(0);
      }

      console.error(`Found ${result.issues.length} issue(s):\n`);
      for (const issue of result.issues) {
        const icon = issue.severity === "error" ? "✗" : "⚠";
        console.error(`${icon} [${issue.type}] ${issue.message}`);
        if (issue.file) {
          console.error(`  at ${issue.file}:${issue.line || 0}`);
        }
      }
      process.exit(result.issues.some((i) => i.severity === "error") ? 1 : 0);
    }

    // Handle keys command
    if (cmd === "keys") {
      const dims = typeof args.dims === "string"
        ? args.dims.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      const ctx = parseCtx(args.ctx);
      const cfg = await loadColony({ entry, dims, ctx });

      const keys = cfg.keys();
      for (const key of keys) {
        console.log(key);
      }
      process.exit(0);
    }

    // Handle env command
    if (cmd === "env") {
      const dims = typeof args.dims === "string"
        ? args.dims.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      const ctx = parseCtx(args.ctx);
      const cfg = await loadColony({ entry, dims, ctx });

      console.log(formatAsEnv(cfg.toJSON(), args.prefix || ""));
      process.exit(0);
    }

    // Handle print command
    if (cmd !== "print") {
      console.error(`Error: Unknown command "${cmd}"\n`);
      printUsage();
      process.exit(1);
    }

    const dims = typeof args.dims === "string"
      ? args.dims.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const ctx = parseCtx(args.ctx);

    // Build sandbox options
    const sandbox = {};
    if (args["base-path"]) {
      sandbox.basePath = args["base-path"];
    }
    if (args["allowed-env"]) {
      sandbox.allowedEnvVars = args["allowed-env"].split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (args["allowed-vars"]) {
      sandbox.allowedVars = args["allowed-vars"].split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (args["max-file-size"]) {
      sandbox.maxFileSize = parseInt(args["max-file-size"], 10);
    }

    const warnOnSkippedIncludes = !!args["warn-skipped"];

    const cfg = await loadColony({ entry, dims, ctx, sandbox, warnOnSkippedIncludes });

    // Handle --query option
    if (args.query) {
      const value = getByPath(cfg, args.query);
      if (value === undefined) {
        console.error(`Key not found: ${args.query}`);
        process.exit(1);
      }
      if (typeof value === "object") {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    } else {
      // Format output
      const format = args.format || "json";
      if (format === "env") {
        console.log(formatAsEnv(cfg.toJSON(), args.prefix || ""));
      } else {
        console.log(JSON.stringify(cfg, null, 2));
      }
    }

    // Handle --strict flag
    if (args.strict && cfg._warnings?.length > 0) {
      console.error(`\n✗ Strict mode: ${cfg._warnings.length} warning(s) found:`);
      for (const w of cfg._warnings) {
        console.error(`  [${w.type}] ${w.message}`);
      }
      process.exit(1);
    }

    // Show warnings if requested
    if (args["show-warnings"] && cfg._warnings?.length > 0) {
      console.error(`\nWarnings (${cfg._warnings.length}):`);
      for (const w of cfg._warnings) {
        console.error(`  [${w.type}] ${w.message}`);
      }
    }

    if (typeof args.explain === "string") {
      const info = cfg.explain(args.explain);
      console.error(`\nExplain ${args.explain}:`);
      console.error(info ? JSON.stringify(info, null, 2) : "(no matching rule / unset)");
    }

  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();
