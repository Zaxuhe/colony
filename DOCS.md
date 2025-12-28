# Colony Documentation

Complete documentation for Colony, the environment-aware config loader for Node.js.

## Table of Contents

- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Config File Syntax](#config-file-syntax)
- [JavaScript API](#javascript-api)
- [CLI Reference](#cli-reference)
- [Secrets Management](#secrets-management)
- [Security](#security)
- [TypeScript](#typescript)
- [Examples](#examples)

---

## Installation

```bash
npm install @ant.sh/colony
```

**Requirements:** Node.js 18+

**Optional peer dependencies:**
- `@aws-sdk/client-secrets-manager` - For AWS Secrets Manager integration

---

## Core Concepts

### What is a Dimension?

A **dimension** is an axis along which your configuration varies. Think of it as a question your config needs to answer:

- "Which **environment** am I running in?" → `env` dimension (dev, staging, prod)
- "Which **region** am I deployed to?" → `region` dimension (us, eu, asia)
- "Which **customer** is this for?" → `tenant` dimension (acme, globex, initech)

**The key insight:** Instead of creating separate config files for each combination (config-dev.json, config-prod.json, config-prod-eu.json...), you define dimensions and write rules that apply to specific combinations.

### Declaring Dimensions

Use `@dims` at the top of your config file:

```
@dims env;                    # Single dimension
@dims env, region;            # Two dimensions
@dims env, region, tenant;    # Three dimensions
```

The order matters - it determines how you write your rules.

### How Dimensions Work: A Complete Example

Let's say you're building a SaaS app deployed across environments and regions:

```
@dims env, region;

# Default for ALL environments and ALL regions
*.*.database.port = 5432;
*.*.database.pool.size = 10;
*.*.api.timeout = 5000;

# Defaults for development (any region)
dev.*.database.host = "localhost";
dev.*.api.url = "http://localhost:3000";

# Defaults for production (any region)
prod.*.database.host = "prod-db.internal";
prod.*.database.pool.size = 50;
prod.*.api.timeout = 10000;

# Region-specific overrides
prod.us.database.host = "prod-db-us.internal";
prod.us.api.url = "https://api-us.myapp.com";

prod.eu.database.host = "prod-db-eu.internal";
prod.eu.api.url = "https://api-eu.myapp.com";
```

Now in your code:

```js
// Development
const devConfig = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: "dev", region: "us" }
});
// database.host → "localhost"
// database.pool.size → 10

// Production US
const prodUsConfig = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: "prod", region: "us" }
});
// database.host → "prod-db-us.internal"
// database.pool.size → 50

// Production EU
const prodEuConfig = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: "prod", region: "eu" }
});
// database.host → "prod-db-eu.internal"
// api.url → "https://api-eu.myapp.com"
```

### Common Dimension Patterns

**Single dimension (simplest):**
```
@dims env;

*.database.host = "localhost";
prod.database.host = "prod-db.example.com";
```

**Environment + Region:**
```
@dims env, region;

*.*.cache.ttl = 3600;
prod.us.cache.host = "redis-us.prod.internal";
prod.eu.cache.host = "redis-eu.prod.internal";
```

**Environment + Feature Flags:**
```
@dims env, feature;

*.*.payment.provider = "stripe";
*.beta.payment.provider = "new-payment-system";
prod.beta.payment.provider = "new-payment-system";
```

**Multi-tenant SaaS:**
```
@dims env, tenant;

*.*.branding.logo = "/default-logo.png";
*.acme.branding.logo = "/tenants/acme/logo.png";
*.acme.branding.primaryColor = "#FF5500";
prod.acme.features.advancedReporting = true;
```

### Wildcards (`*`)

The `*` wildcard matches **any value** for that dimension:

```
@dims env, region;

*.*. ...        # Matches any env, any region (default)
prod.*. ...     # Matches prod env, any region
*.us. ...       # Matches any env, us region
prod.us. ...    # Matches only prod env AND us region
```

### Specificity: Which Rule Wins?

When multiple rules match, Colony picks the **most specific** one.

**Specificity** = count of non-wildcard dimension values.

```
@dims env, region;

*.*.timeout = 1000;           # specificity: 0 (two wildcards)
prod.*.timeout = 2000;        # specificity: 1 (one wildcard)
prod.us.timeout = 3000;       # specificity: 2 (no wildcards)
```

For `ctx: { env: "prod", region: "us" }`:
- All three rules match
- `prod.us.timeout = 3000` wins (highest specificity)

For `ctx: { env: "prod", region: "eu" }`:
- Rules 1 and 2 match
- `prod.*.timeout = 2000` wins

For `ctx: { env: "dev", region: "us" }`:
- Only rule 1 matches
- `*.*.timeout = 1000` wins

**Tie-breaker:** If two rules have the same specificity, the one defined later wins.

---

## Config File Syntax

### File Extension

Colony config files use the `.colony` extension.

### Comments

```
# Line comment (hash)
// Line comment (double slash)

/* Block comment */

/*
  Multi-line
  block comment
*/
```

### Directives

Directives start with `@` and configure the parser:

```
@dims env, region;              # Declare dimensions
@include "./base.colony";       # Include another file
@include "./envs/*.colony";     # Include with glob pattern
@require database.host;         # Require key to be set
@envDefaults env=dev;           # Default context values
```

### Rules

Rules follow the pattern: `scope.key.path = value;`

```
prod.database.host = "prod-db.example.com";
```

### Operators

| Operator | Name | Description |
|----------|------|-------------|
| `=` | Set | Set value, overwrites existing |
| `:=` | Set if missing | Set only if key doesn't exist |
| `\|=` | Merge | Deep merge objects, overwrite primitives |
| `+=` | Append | Append to array (creates array if needed) |
| `-=` | Remove | Remove value from array |

**Examples:**

```
# Set (overwrites)
*.timeout = 5000;

# Set if missing (won't overwrite)
*.timeout := 3000;

# Merge objects
*.database |= { pool: { min: 5 } };

# Append to array
*.features += "dark-mode";

# Remove from array
prod.features -= "debug-panel";
```

### Values

Colony uses JSON5 for values, supporting:

```
# Strings
*.name = "MyApp";
*.name = 'MyApp';                    # single quotes ok

# Numbers
*.port = 5432;
*.ratio = 0.75;

# Booleans
*.enabled = true;
*.debug = false;

# Null
*.optional = null;

# Arrays
*.hosts = ["a.com", "b.com"];
*.ports = [80, 443];

# Objects
*.database = {
  host: "localhost",
  port: 5432,
  ssl: true
};

# Trailing commas allowed
*.list = [1, 2, 3,];
```

### Heredoc Strings

For multi-line strings:

```
*.template = <<<EOF
Hello, ${name}!
Welcome to our service.
EOF;
```

### Escaped Dots in Keys

Use `\.` to include a literal dot in key names:

```
*.headers.content\.type = "application/json";
# Creates: { headers: { "content.type": "application/json" } }
```

### Interpolation

**Environment Variables:**
```
*.api_key = "${ENV:API_KEY}";
*.home = "${ENV:HOME}";
```

**Context Values:**
```
*.endpoint = "https://api.${ctx.region}.example.com";
```

**Custom Variables:**
```
*.data_path = "${VAR:ROOT}/data";
```

Variables are passed via the `vars` option:
```js
loadColony({ vars: { ROOT: "/app" } });
```

---

## JavaScript API

### `loadColony(options)`

Load and resolve a colony configuration.

```js
import { loadColony } from "@ant.sh/colony";

const config = await loadColony({
  // Required
  entry: "./config/app.colony",

  // Optional
  ctx: { env: "prod", region: "us" },
  dims: ["env", "region"],           // Override @dims
  vars: { ROOT: "/app" },            // Custom ${VAR:*} values
  schema: (cfg) => validate(cfg),    // Validation hook
  warnOnSkippedIncludes: false,

  // Dotenv integration
  dotenv: true,                      // Load .env and .env.local
  // dotenv: ".env.production",      // Or specify a path
  // dotenv: [".env", ".env.local"], // Or multiple paths

  // Security sandbox
  sandbox: {
    basePath: "./config",
    allowedEnvVars: ["NODE_ENV", "API_KEY"],
    allowedVars: ["ROOT"],
    maxIncludeDepth: 50,
    maxFileSize: 1048576,
  },

  // Secrets
  secrets: {
    providers: [new AwsSecretsProvider()],
    allowedSecrets: ["myapp/*"],
    cache: { enabled: true, ttl: 300000 },
    onNotFound: "warn",
  },
});
```

**Returns:** `ColonyConfig` object with:

```js
// Direct property access
config.database.host;

// Methods
config.get("database.host");           // Dot-notation access
config.keys();                         // List all leaf keys
config.explain("database.host");       // Debug info
config.toJSON();                       // Plain object
config.diff(otherConfig);              // Compare configs

// Internal (non-enumerable)
config._warnings;                      // Array of warnings
config._trace;                         // Map of trace info
```

### `validateColony(entry)`

Validate syntax without resolving.

```js
import { validateColony } from "@ant.sh/colony";

const { valid, files, errors } = await validateColony("./config/app.colony");

if (!valid) {
  for (const { file, error } of errors) {
    console.error(`${file}: ${error}`);
  }
}
```

### `diffColony(options)`

Compare configs with different contexts.

```js
import { diffColony } from "@ant.sh/colony";

const { cfg1, cfg2, diff } = await diffColony({
  entry: "./config/app.colony",
  ctx1: { env: "dev" },
  ctx2: { env: "prod" },
});

console.log("Added in prod:", diff.added);
console.log("Removed in prod:", diff.removed);
console.log("Changed:", diff.changed);
```

### `lintColony(options)`

Find potential issues in config files.

```js
import { lintColony } from "@ant.sh/colony";

const { issues } = await lintColony({
  entry: "./config/app.colony",
  dims: ["env"],
});

for (const issue of issues) {
  console.log(`[${issue.severity}] ${issue.type}: ${issue.message}`);
}
```

**Issue types:**
- `parse_error` - Syntax error
- `shadowed_rule` - Rule overwritten by later rule
- `overridden_wildcard` - Wildcard always overridden
- `empty_include` - Include pattern matches no files

### `dryRunIncludes(entry)`

List all files that would be included.

```js
import { dryRunIncludes } from "@ant.sh/colony";

const files = await dryRunIncludes("./config/app.colony");
console.log("Files:", files);
```

---

## CLI Reference

### `colony print`

Print resolved configuration.

```bash
colony print --entry ./config/app.colony --ctx "env=prod,region=us"
colony print --entry ./config/app.colony --ctx "env=prod" --format json
colony print --entry ./config/app.colony --ctx "env=prod" --query "database"
```

**Options:**
- `--entry, -e` - Entry file path (required)
- `--ctx, -c` - Context as key=value pairs
- `--format, -f` - Output format: `json` (default) or `yaml`
- `--query, -q` - Print only matching key path

### `colony diff`

Compare two contexts.

```bash
colony diff --entry ./config/app.colony --ctx1 "env=dev" --ctx2 "env=prod"
```

**Options:**
- `--entry, -e` - Entry file path (required)
- `--ctx1` - First context (required)
- `--ctx2` - Second context (required)

### `colony validate`

Validate config syntax.

```bash
colony validate --entry ./config/app.colony
```

**Options:**
- `--entry, -e` - Entry file path (required)

**Exit codes:**
- `0` - Valid
- `1` - Invalid (errors printed to stderr)

### `colony lint`

Check for potential issues.

```bash
colony lint --entry ./config/app.colony
```

**Options:**
- `--entry, -e` - Entry file path (required)

### `colony includes`

List all included files.

```bash
colony includes --entry ./config/app.colony
```

### `colony env`

Show environment variables used.

```bash
colony env --entry ./config/app.colony
```

---

## Secrets Management

Colony integrates with secret managers to keep credentials out of config files.

### Config Syntax

```
*.db.password = "${AWS:myapp/database#password}";
*.api.key = "${VAULT:secret/data/myapp#api_key}";
*.token = "${OPENBAO:secret/data/app#token}";
```

**Pattern:** `${PROVIDER:path#field}`

- `PROVIDER` - Provider prefix (AWS, VAULT, OPENBAO, or custom)
- `path` - Secret path/name in the provider
- `field` - Optional JSON field to extract

### Built-in Providers

#### AWS Secrets Manager

```js
import { loadColony, AwsSecretsProvider } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  secrets: {
    providers: [
      new AwsSecretsProvider({ region: "us-east-1" }),
    ],
  },
});
```

**Config:**
```
*.password = "${AWS:myapp/db}";           # Whole secret
*.password = "${AWS:myapp/db#password}";  # JSON field
```

**Requirements:**
- `npm install @aws-sdk/client-secrets-manager`
- AWS credentials configured (env vars, IAM role, etc.)

**Options:**
- `region` - AWS region (default: `AWS_REGION` env var or `us-east-1`)

#### HashiCorp Vault

```js
import { loadColony, VaultProvider } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  secrets: {
    providers: [
      new VaultProvider({
        addr: "https://vault.example.com",
        token: process.env.VAULT_TOKEN,
      }),
    ],
  },
});
```

**Config:**
```
*.password = "${VAULT:secret/data/myapp#password}";
```

**Environment variables:**
- `VAULT_ADDR` - Vault server address
- `VAULT_TOKEN` - Authentication token
- `VAULT_NAMESPACE` - Optional namespace

#### OpenBao

```js
import { loadColony, OpenBaoProvider } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  secrets: {
    providers: [new OpenBaoProvider()],
  },
});
```

**Config:**
```
*.password = "${OPENBAO:secret/data/myapp#password}";
```

**Environment variables:**
- `BAO_ADDR` - OpenBao server address
- `BAO_TOKEN` - Authentication token
- `BAO_NAMESPACE` - Optional namespace

### Custom Providers

```js
import { registerSecretProvider } from "@ant.sh/colony";

// Register globally
registerSecretProvider({
  prefix: "CUSTOM",
  fetch: async (key) => {
    // key is the path after the prefix
    // e.g., for ${CUSTOM:myapp/secret}, key = "myapp/secret"
    return await mySecretStore.get(key);
  },
  validate: async () => {
    // Optional: verify configuration
  },
  dispose: async () => {
    // Optional: cleanup resources
  },
});

// Now ${CUSTOM:path} works in config files
```

Or pass providers per-load:

```js
const config = await loadColony({
  entry: "./config/app.colony",
  secrets: {
    providers: [myCustomProvider],
  },
});
```

### Security Options

```js
secrets: {
  providers: [...],

  // Whitelist allowed secret patterns (glob supported)
  allowedSecrets: ["myapp/*", "shared/db-*"],

  // Cache settings
  cache: {
    enabled: true,      // Default: true
    ttl: 300000,        // Default: 5 minutes
    maxSize: 100,       // Default: 100 secrets
  },

  // Behavior when secret not found
  onNotFound: "warn",   // "empty" | "warn" | "error"
}
```

### Provider Management

```js
import {
  registerSecretProvider,
  unregisterSecretProvider,
  clearSecretProviders,
} from "@ant.sh/colony";

// Register globally (available to all loadColony calls)
registerSecretProvider(provider);

// Unregister by prefix
unregisterSecretProvider("CUSTOM");

// Clear all global providers
clearSecretProviders();
```

---

## Security

### Sandbox Options

When loading untrusted config files:

```js
const config = await loadColony({
  entry: untrustedPath,
  sandbox: {
    // Restrict @include to this directory
    basePath: "./config",

    // Whitelist environment variables for ${ENV:*}
    allowedEnvVars: ["NODE_ENV", "APP_ENV"],

    // Whitelist custom variables for ${VAR:*}
    allowedVars: ["ROOT"],

    // Maximum include depth (prevent infinite loops)
    maxIncludeDepth: 10,

    // Maximum file size in bytes
    maxFileSize: 1048576,  // 1MB
  },
});
```

### Path Traversal Protection

When `basePath` is set, Colony blocks includes that resolve outside:

```
@include "../../../etc/passwd";  # Blocked!
@include "/etc/passwd";          # Blocked!
```

### Warnings

Access `_warnings` for security-related warnings:

```js
const config = await loadColony({ ... });

for (const warning of config._warnings) {
  console.log(`[${warning.type}] ${warning.message}`);
}
```

**Warning types:**
- `blocked_env_var` - Blocked by `allowedEnvVars`
- `blocked_var` - Blocked by `allowedVars`
- `blocked_secret` - Blocked by `allowedSecrets`
- `unknown_var` - Variable not found
- `unknown_ctx` - Context dimension not found
- `unknown_interpolation` - Invalid interpolation pattern
- `unknown_provider` - No secret provider for prefix
- `secret_not_found` - Secret not found in provider
- `secret_fetch_error` - Error fetching secret
- `skipped_include` - Circular include skipped

---

## TypeScript

Colony includes full TypeScript definitions.

```ts
import {
  loadColony,
  LoadColonyOptions,
  ColonyConfig,
  SecretProvider,
  Warning,
} from "@ant.sh/colony";

// Options are fully typed
const options: LoadColonyOptions = {
  entry: "./config/app.colony",
  ctx: { env: "prod" },
};

// Config object is typed
const config: ColonyConfig = await loadColony(options);

// Custom provider with type safety
const provider: SecretProvider = {
  prefix: "CUSTOM",
  fetch: async (key: string): Promise<string> => {
    return "value";
  },
};
```

### Key Types

```ts
interface LoadColonyOptions {
  entry: string;
  dims?: string[];
  ctx?: Record<string, string>;
  vars?: Record<string, string>;
  schema?: (cfg: ColonyConfig) => ColonyConfig | Promise<ColonyConfig>;
  sandbox?: SandboxOptions;
  warnOnSkippedIncludes?: boolean;
  secrets?: SecretsOptions;
}

interface ColonyConfig {
  get(path: string): unknown;
  explain(path: string): TraceInfo | null;
  toJSON(): Record<string, unknown>;
  keys(): string[];
  diff(other: ColonyConfig | Record<string, unknown>): DiffResult;
  readonly _trace: Map<string, TraceInfo>;
  readonly _warnings: Warning[];
  [key: string]: unknown;
}

interface SecretProvider {
  readonly prefix: string;
  fetch(key: string): Promise<string>;
  validate?(): Promise<void>;
  dispose?(): Promise<void>;
}
```

---

## Examples

### Basic App Config

**config/app.colony:**
```
@dims env;

# App settings
*.app.name = "MyApp";
*.app.version = "1.0.0";

# Server
*.server.port = 3000;
*.server.host = "localhost";
prod.server.host = "0.0.0.0";

# Database
*.database.host = "localhost";
*.database.port = 5432;
*.database.name = "myapp_dev";
prod.database.host = "prod-db.internal";
prod.database.name = "myapp";

# Logging
*.log.level = "debug";
prod.log.level = "info";
```

**app.js:**
```js
import { loadColony } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: process.env.NODE_ENV || "dev" },
});

console.log(`Starting ${config.app.name} v${config.app.version}`);
console.log(`Server: ${config.server.host}:${config.server.port}`);
```

### Multi-Region Deployment

**config/app.colony:**
```
@dims env, region;

# Defaults
*.*.api.timeout = 5000;
*.*.api.retries = 3;

# Regional endpoints
*.us.api.endpoint = "https://api-us.example.com";
*.eu.api.endpoint = "https://api-eu.example.com";
*.asia.api.endpoint = "https://api-asia.example.com";

# Production overrides
prod.*.api.retries = 5;
prod.us.api.endpoint = "https://api-us.prod.example.com";
prod.eu.api.endpoint = "https://api-eu.prod.example.com";
```

### With Secrets

**config/app.colony:**
```
@dims env;

*.database.host = "localhost";
*.database.user = "app";
*.database.password = "${ENV:DB_PASSWORD}";

prod.database.host = "prod-db.internal";
prod.database.password = "${AWS:myapp/prod/db#password}";
```

**app.js:**
```js
import { loadColony, AwsSecretsProvider } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: process.env.NODE_ENV || "dev" },
  secrets: {
    providers: [new AwsSecretsProvider({ region: "us-east-1" })],
  },
});
```

### With Schema Validation (Zod)

```js
import { loadColony } from "@ant.sh/colony";
import { z } from "zod";

const configSchema = z.object({
  database: z.object({
    host: z.string(),
    port: z.number(),
    name: z.string(),
  }),
  server: z.object({
    port: z.number().min(1).max(65535),
  }),
});

const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: "prod" },
  schema: (cfg) => configSchema.parse(cfg),
});
```

### Modular Config with Includes

**config/app.colony:**
```
@dims env;
@include "./base.colony";
@include "./database.colony";
@include "./envs/${ctx.env}.colony";
```

**config/base.colony:**
```
*.app.name = "MyApp";
*.app.version = "1.0.0";
```

**config/database.colony:**
```
*.database.port = 5432;
*.database.pool.min = 2;
*.database.pool.max = 10;
```

**config/envs/prod.colony:**
```
prod.database.host = "prod-db.internal";
prod.database.pool.min = 10;
prod.database.pool.max = 50;
```

---

## Framework Integrations

### Express.js

```js
// config/app.colony
// @dims env;
// *.server.port = 3000;
// prod.server.port = 8080;

import express from 'express';
import { loadColony } from '@ant.sh/colony';

const config = await loadColony({
  entry: './config/app.colony',
  ctx: { env: process.env.NODE_ENV || 'dev' },
  dotenv: true,
});

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV });
});

app.listen(config.server.port, () => {
  console.log(`Server running on port ${config.server.port}`);
});
```

### Fastify

```js
import Fastify from 'fastify';
import { loadColony } from '@ant.sh/colony';

const config = await loadColony({
  entry: './config/app.colony',
  ctx: { env: process.env.NODE_ENV || 'dev' },
  dotenv: true,
});

const fastify = Fastify({
  logger: config.log.enabled,
});

fastify.get('/health', async () => {
  return { status: 'ok' };
});

await fastify.listen({
  port: config.server.port,
  host: config.server.host,
});
```

### Next.js

```js
// lib/config.js
import { loadColony } from '@ant.sh/colony';

let configPromise = null;

export async function getConfig() {
  if (!configPromise) {
    configPromise = loadColony({
      entry: './config/app.colony',
      ctx: { env: process.env.NODE_ENV || 'development' },
      dotenv: ['.env', '.env.local'],
    });
  }
  return configPromise;
}

// app/api/config/route.js
import { getConfig } from '@/lib/config';

export async function GET() {
  const config = await getConfig();
  return Response.json({
    appName: config.app.name,
    features: config.features,
  });
}
```

### Docker Compose

Use Colony CLI to generate environment-specific configs:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    environment:
      NODE_ENV: production
    command: >
      sh -c "
        colony print -e ./config/app.colony -c 'env=prod' -f json > /app/config.json &&
        node server.js
      "
```

### Kubernetes ConfigMap

Generate a ConfigMap from your Colony config:

```bash
# Generate config JSON
colony print -e ./config/app.colony -c 'env=prod,region=us-east-1' -f json > config.json

# Create ConfigMap
kubectl create configmap myapp-config --from-file=config.json
```

Or inline in your deployment:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
data:
  config.json: |
    # Output of: colony print -e ./config/app.colony -c 'env=prod'
```

---

## Troubleshooting

### Debug Which Rule Set a Value

```js
const config = await loadColony({ ... });
const trace = config.explain("database.host");
console.log(trace);
// {
//   op: "=",
//   scope: ["prod"],
//   specificity: 1,
//   filePath: "/path/to/config/app.colony",
//   line: 15,
//   col: 1,
//   source: "/path/to/config/app.colony:15:1"
// }
```

### List All Config Keys

```js
const keys = config.keys();
// ["app.name", "app.version", "database.host", ...]
```

### Compare Environments

```bash
colony diff --entry ./config/app.colony --ctx1 "env=dev" --ctx2 "env=prod"
```

### Check for Issues

```bash
colony lint --entry ./config/app.colony
```
