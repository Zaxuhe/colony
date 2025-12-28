/**
 * Type definitions for colony
 */

export interface SandboxOptions {
  /** Restrict @include paths to this directory */
  basePath?: string;
  /** Whitelist of allowed environment variables for ${ENV:*} (null = allow all) */
  allowedEnvVars?: string[] | null;
  /** Whitelist of allowed custom variables for ${VAR:*} (null = allow all) */
  allowedVars?: string[] | null;
  /** Maximum depth for nested includes (default: 50) */
  maxIncludeDepth?: number;
  /** Maximum file size in bytes for included files */
  maxFileSize?: number;
}

/**
 * Secret provider interface for custom integrations
 */
export interface SecretProvider {
  /** Unique prefix for this provider (e.g., "AWS", "VAULT") */
  readonly prefix: string;
  /** Fetch a secret value by key/path */
  fetch(key: string): Promise<string>;
  /** Optional: validate configuration on registration */
  validate?(): Promise<void>;
  /** Optional: cleanup resources */
  dispose?(): Promise<void>;
}

export interface SecretCacheOptions {
  /** Enable caching (default: true) */
  enabled?: boolean;
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  ttl?: number;
  /** Maximum number of cached secrets (default: 100) */
  maxSize?: number;
}

export interface SecretsOptions {
  /** Secret providers to use (e.g., AwsSecretsProvider) */
  providers?: SecretProvider[];
  /** Whitelist of allowed secret patterns (glob supported, null = allow all) */
  allowedSecrets?: string[] | null;
  /** Cache settings */
  cache?: SecretCacheOptions;
  /** Behavior when secret not found: 'empty' returns "", 'warn' adds warning, 'error' throws */
  onNotFound?: "empty" | "warn" | "error";
}

export interface LoadColonyOptions {
  /** Entry colony file path */
  entry: string;
  /** Dimension names (e.g., ["env", "realm", "region"]) */
  dims?: string[];
  /** Context values for scope matching */
  ctx?: Record<string, string>;
  /** Custom variables for ${VAR:*} interpolation */
  vars?: Record<string, string>;
  /** Schema validation hook (supports sync and async) */
  schema?: (cfg: ColonyConfig) => ColonyConfig | Promise<ColonyConfig>;
  /**
   * Load environment variables from dotenv file(s).
   * - `true`: Load from [".env", ".env.local"]
   * - `string`: Load from single file path
   * - `string[]`: Load from multiple file paths (later files override)
   */
  dotenv?: boolean | string | string[];
  /** Security sandbox options */
  sandbox?: SandboxOptions;
  /** Warn when skipping already-visited includes */
  warnOnSkippedIncludes?: boolean;
  /** Secrets provider options */
  secrets?: SecretsOptions;
}

export interface Warning {
  type:
    | "blocked_env_var"
    | "blocked_var"
    | "unknown_var"
    | "unknown_ctx"
    | "unknown_interpolation"
    | "skipped_include"
    | "blocked_secret"
    | "secret_not_found"
    | "secret_fetch_error"
    | "unknown_provider";
  message: string;
  var?: string;
  file?: string;
  pattern?: string;
  /** Provider name (for secret warnings) */
  provider?: string;
  /** Secret key (for secret warnings) */
  key?: string;
}

export interface TraceInfo {
  /** Operator used (=, :=, |=, +=, -=) */
  op: string;
  /** Scope segments that matched */
  scope: string[];
  /** Specificity score (number of non-* segments) */
  specificity: number;
  /** File path where the rule was defined */
  filePath: string;
  /** Line number in the file */
  line: number;
  /** Column number in the file */
  col: number;
  /** Raw key from the rule */
  keyRaw: string;
  /** Source location string (filePath:line:col) */
  source: string;
}

export interface DiffResult {
  /** Keys present in other but not in this config */
  added: string[];
  /** Keys present in this config but not in other */
  removed: string[];
  /** Keys present in both but with different values */
  changed: Array<{
    key: string;
    from: unknown;
    to: unknown;
  }>;
}

export interface ColonyConfig {
  /** Get a value by dot-notation path */
  get(path: string): unknown;
  /** Get trace info for how a key was set */
  explain(path: string): TraceInfo | null;
  /** Serialize to plain object */
  toJSON(): Record<string, unknown>;
  /** List all leaf keys in dot notation */
  keys(): string[];
  /** Compare with another config */
  diff(other: ColonyConfig | Record<string, unknown>): DiffResult;
  /** Internal trace data */
  readonly _trace: Map<string, TraceInfo>;
  /** Warnings generated during resolution */
  readonly _warnings: Warning[];
  /** Allow indexing with any string key */
  [key: string]: unknown;
}

export interface ValidationResult {
  /** Whether all files are valid */
  valid: boolean;
  /** List of all files that were checked */
  files: string[];
  /** List of errors found */
  errors: Array<{
    file: string;
    error: string;
  }>;
}

export interface DiffColonyOptions extends Omit<LoadColonyOptions, "ctx"> {
  /** First context to compare */
  ctx1: Record<string, string>;
  /** Second context to compare */
  ctx2: Record<string, string>;
}

export interface DiffColonyResult {
  /** Config resolved with ctx1 */
  cfg1: ColonyConfig;
  /** Config resolved with ctx2 */
  cfg2: ColonyConfig;
  /** Differences between the two configs */
  diff: DiffResult;
}

/**
 * Load and resolve a colony configuration file
 */
export function loadColony(options: LoadColonyOptions): Promise<ColonyConfig>;

/**
 * Validate syntax of colony files without resolving
 */
export function validateColony(entry: string): Promise<ValidationResult>;

/**
 * List all files that would be included (dry run)
 */
export function dryRunIncludes(entry: string): Promise<string[]>;

/**
 * Compare configs loaded with different contexts
 */
export function diffColony(options: DiffColonyOptions): Promise<DiffColonyResult>;

export interface LintIssue {
  /** Type of issue found */
  type: "parse_error" | "shadowed_rule" | "overridden_wildcard" | "empty_include";
  /** Severity level */
  severity: "error" | "warning" | "info";
  /** Human-readable message */
  message: string;
  /** File where the issue was found */
  file?: string;
  /** Line number in the file */
  line?: number;
}

export interface LintColonyOptions {
  /** Entry colony file path */
  entry: string;
  /** Dimension names (e.g., ["env", "realm", "region"]) */
  dims?: string[];
}

export interface LintColonyResult {
  /** List of issues found */
  issues: LintIssue[];
}

/**
 * Lint colony files for potential issues
 */
export function lintColony(options: LintColonyOptions): Promise<LintColonyResult>;

// ============================================================================
// Secrets Management
// ============================================================================

/**
 * Register a secret provider globally (available to all loadColony calls)
 */
export function registerSecretProvider(provider: SecretProvider): void;

/**
 * Unregister a secret provider by prefix
 */
export function unregisterSecretProvider(prefix: string): boolean;

/**
 * Clear all globally registered secret providers
 */
export function clearSecretProviders(): void;

/**
 * AWS Secrets Manager provider
 *
 * @example
 * ```ts
 * import { loadColony, AwsSecretsProvider } from "@ant.sh/colony";
 *
 * const cfg = await loadColony({
 *   entry: "./config/app.colony",
 *   secrets: {
 *     providers: [new AwsSecretsProvider({ region: "us-east-1" })],
 *   },
 * });
 * ```
 *
 * Config usage:
 * ```
 * *.db.password = "${AWS:myapp/db#password}";
 * ```
 */
export class AwsSecretsProvider implements SecretProvider {
  readonly prefix: "AWS";

  /**
   * @param options.region - AWS region (default: process.env.AWS_REGION or "us-east-1")
   */
  constructor(options?: { region?: string });

  fetch(key: string): Promise<string>;
  validate(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * HashiCorp Vault provider
 *
 * @example
 * ```ts
 * import { loadColony, VaultProvider } from "@ant.sh/colony";
 *
 * const cfg = await loadColony({
 *   entry: "./config/app.colony",
 *   secrets: {
 *     providers: [new VaultProvider({ addr: "https://vault.example.com" })],
 *   },
 * });
 * ```
 *
 * Config usage:
 * ```
 * *.api.key = "${VAULT:secret/data/myapp#api_key}";
 * ```
 */
export class VaultProvider implements SecretProvider {
  readonly prefix: "VAULT";

  /**
   * @param options.addr - Vault address (default: process.env.VAULT_ADDR or "http://127.0.0.1:8200")
   * @param options.token - Vault token (default: process.env.VAULT_TOKEN)
   * @param options.namespace - Vault namespace (default: process.env.VAULT_NAMESPACE)
   * @param options.timeout - Request timeout in ms (default: 30000)
   */
  constructor(options?: { addr?: string; token?: string; namespace?: string; timeout?: number });

  fetch(key: string): Promise<string>;
  validate(): Promise<void>;
}

/**
 * OpenBao provider (API-compatible Vault fork)
 *
 * @example
 * ```ts
 * import { loadColony, OpenBaoProvider } from "@ant.sh/colony";
 *
 * const cfg = await loadColony({
 *   entry: "./config/app.colony",
 *   secrets: {
 *     providers: [new OpenBaoProvider({ addr: "https://bao.example.com" })],
 *   },
 * });
 * ```
 *
 * Config usage:
 * ```
 * *.api.key = "${OPENBAO:secret/data/myapp#api_key}";
 * ```
 */
export class OpenBaoProvider implements SecretProvider {
  readonly prefix: "OPENBAO";

  /**
   * @param options.addr - OpenBao address (default: process.env.BAO_ADDR or "http://127.0.0.1:8200")
   * @param options.token - OpenBao token (default: process.env.BAO_TOKEN)
   * @param options.namespace - OpenBao namespace (default: process.env.BAO_NAMESPACE)
   * @param options.timeout - Request timeout in ms (default: 30000)
   */
  constructor(options?: { addr?: string; token?: string; namespace?: string; timeout?: number });

  fetch(key: string): Promise<string>;
  validate(): Promise<void>;
}

// ============================================================================
// Dotenv
// ============================================================================

/**
 * Parse dotenv file content and return key-value pairs
 */
export function parseDotenv(content: string): Record<string, string>;

/**
 * Load environment variables from a dotenv file
 */
export function loadDotenv(filePath: string): Promise<Record<string, string>>;

/**
 * Load multiple dotenv files (later files override earlier ones)
 */
export function loadDotenvFiles(filePaths: string[]): Promise<Record<string, string>>;
