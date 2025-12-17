# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Colony is a Node.js config loader with a "rules-first" approach. It loads `.colony` configuration files with scope-based rule matching, where the most specific scope wins.

## Commands

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run the example loader
node ./examples/load.mjs

# CLI usage - print resolved config
colony print --entry ./examples/config/app.colony --dims env,realm,region --ctx "env=prod realm=US region=us-east-1"

# CLI with explain (shows which rule set a key)
colony print --entry ./examples/config/app.colony --ctx "env=prod" --explain precompute.aws.region

# Query specific value (like jq)
colony print --entry ./examples/config/app.colony --query log.level

# Validate syntax without resolving
colony validate --entry ./examples/config/app.colony

# Dry-run: list files that would be included
colony dry-run --entry ./examples/config/app.colony

# List all config keys
colony keys --entry ./examples/config/app.colony

# Export as shell variables
colony env --entry ./examples/config/app.colony --ctx "env=prod"

# Compare two environments
colony diff --entry ./examples/config/app.colony --ctx1 "env=dev" --ctx2 "env=prod"

# Lint for potential issues
colony lint --entry ./examples/config/app.colony

# With security sandbox options
colony print --entry ./config/app.colony --base-path ./config --allowed-env NODE_ENV,HOME --allowed-vars ROOT --max-file-size 1048576 --show-warnings --strict
```

## Architecture

### Core Flow
1. **index.js** - Entry point (`loadColony`): expands includes via DFS, parses all files, merges configs, enforces `@require`, runs optional schema validation
2. **parser.js** - Parses `.colony` files: extracts directives (`@dims`, `@include`, `@require`, `@envDefaults`) and rules with operators (`=`, `:=`, `|=`, `+=`, `-=`)
3. **resolver.js** - Resolves rules against context: matches scopes, applies specificity-based precedence, handles operators, attaches `get()` and `explain()` helpers to output
4. **strings.js** - Interpolation: `${ENV:NAME}`, `${ctx.dim}`, `${VAR:key}`
5. **util.js** - Deep object utilities: `getDeep`, `setDeep`, `deepMerge`, `isPlainObject`

### Key Concepts
- **Dimensions**: Declared via `@dims env, realm, region;` - every rule key starts with N scope segments
- **Scope matching**: `*` is wildcard; highest specificity (most non-`*` segments) wins; ties broken by later rule
- **Operators**: `=` set, `:=` set-if-missing, `|=` deep-merge, `+=` append array, `-=` remove from array
- **Post-ops**: `+=` and `-=` are applied after base rules, sorted by specificity (less-specific first)

### API
```js
import { loadColony, validateColony, dryRunIncludes, diffColony, lintColony } from "@ant.sh/colony";

const cfg = await loadColony({
  entry: "./config/app.colony",
  dims: ["env", "realm", "region"],
  ctx: { env: "prod", realm: "US", region: "us-east-1" },
  vars: { ROOT: process.cwd() },
  schema: (cfg) => zodSchema.parse(cfg), // optional validation (sync or async)
  sandbox: {
    basePath: "./config",           // restrict includes to this directory
    allowedEnvVars: ["NODE_ENV"],   // whitelist of allowed env vars (null = allow all)
    allowedVars: ["ROOT"],          // whitelist of allowed custom vars (null = allow all)
    maxIncludeDepth: 50,            // max depth for includes
    maxFileSize: 1048576,           // max file size in bytes
  },
  warnOnSkippedIncludes: true,      // warn when skipping already-visited includes
});

// Config methods
cfg.get("some.key.path");           // get value by dot-notation path
cfg.explain("some.key.path");       // returns trace info: file, line, col, operator, scope, source
cfg.toJSON();                       // serialize to plain object
cfg.keys();                         // list all leaf keys in dot notation
cfg.diff(otherCfg);                 // compare with another config
cfg._warnings;                      // array of warnings (blocked env vars, unknown interpolations, etc.)
cfg._trace;                         // internal trace Map

// Validate syntax without resolving
const result = await validateColony("./config/app.colony");
// { valid: boolean, files: string[], errors: Array<{file, error}> }

// List files that would be included
const files = await dryRunIncludes("./config/app.colony");

// Compare two environments
const { cfg1, cfg2, diff } = await diffColony({
  entry: "./config/app.colony",
  ctx1: { env: "dev" },
  ctx2: { env: "prod" },
});
// diff: { added: string[], removed: string[], changed: Array<{key, from, to}> }

// Lint for potential issues
const { issues } = await lintColony({ entry: "./config/app.colony" });
// issues: Array<{type, severity, message, file?, line?}>
```
