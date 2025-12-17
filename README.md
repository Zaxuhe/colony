# Colony

**Environment-aware config for Node.js. One file, multiple environments.**

[![npm version](https://img.shields.io/npm/v/@ant.sh/colony.svg)](https://www.npmjs.com/package/@ant.sh/colony)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

```
# config/app.colony
*.database.host = "localhost";
prod.database.host = "prod-db.example.com";
```

```js
import { loadColony } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: "prod" }
});

config.database.host // => "prod-db.example.com"
```

## Features

- **Single config file** for all environments (dev, staging, prod)
- **Wildcard matching** - `*` sets defaults, specific rules override
- **Multiple dimensions** - env, region, feature flags, anything
- **Secret management** - AWS Secrets Manager, Vault, OpenBao
- **Interpolation** - `${ENV:VAR}`, `${ctx.region}`, `${VAR:custom}`
- **CLI tools** - validate, diff, lint, print
- **TypeScript** - Full type definitions included
- **Zero runtime deps** - Only `fast-glob` and `json5`

## Installation

```bash
npm install @ant.sh/colony
```

## Quick Start

**1. Create `config/app.colony`**

```
@dims env;

# Defaults
*.app.name = "MyApp";
*.database.host = "localhost";
*.database.port = 5432;

# Production overrides
prod.database.host = "prod-db.example.com";
```

**2. Load in your app**

```js
import { loadColony } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: process.env.NODE_ENV || "dev" }
});

console.log(config.database.host);
// dev:  "localhost"
// prod: "prod-db.example.com"
```

## Multiple Dimensions

```
@dims env, region;

*.*.database.host = "localhost";
prod.*.database.host = "prod-db.example.com";
prod.eu.database.host = "prod-db-eu.example.com";
```

```js
const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: "prod", region: "eu" }
});
// => "prod-db-eu.example.com"
```

## Secrets Integration

```
*.db.password = "${AWS:myapp/db#password}";
*.api.key = "${OPENBAO:secret/data/app#api_key}";
```

```js
import { loadColony, AwsSecretsProvider, OpenBaoProvider } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  secrets: {
    providers: [
      new AwsSecretsProvider({ region: "us-east-1" }),
      new OpenBaoProvider(),
    ],
  },
});
```

**Built-in providers:** AWS Secrets Manager, HashiCorp Vault, OpenBao

## CLI

```bash
colony print --entry ./config/app.colony --ctx "env=prod"
colony diff --entry ./config/app.colony --ctx1 "env=dev" --ctx2 "env=prod"
colony validate --entry ./config/app.colony
colony lint --entry ./config/app.colony
```

## package.json Setup

```json
{
  "scripts": {
    "dev": "NODE_ENV=dev node src/index.js",
    "prod": "NODE_ENV=prod node src/index.js",
    "start": "node src/index.js",
    "config:validate": "colony validate --entry ./config/app.colony",
    "config:lint": "colony lint --entry ./config/app.colony",
    "config:diff": "colony diff --entry ./config/app.colony --ctx1 \"env=dev\" --ctx2 \"env=prod\""
  }
}
```

```bash
npm run dev    # Run with dev config
npm run prod   # Run with prod config
```

Your app picks up the environment automatically:

```js
// src/index.js
import { loadColony } from "@ant.sh/colony";

const config = await loadColony({
  entry: "./config/app.colony",
  ctx: { env: process.env.NODE_ENV || "dev" }
});

console.log(`Running in ${process.env.NODE_ENV} mode`);
console.log(`Database: ${config.database.host}`);
```

## Documentation

See [DOCS.md](./DOCS.md) for complete documentation including:

- Config syntax reference
- All operators (`=`, `:=`, `+=`, `-=`, `|=`)
- Interpolation patterns
- Secret providers
- Security sandbox options
- API reference
- TypeScript types

## License

MIT
