/**
 * Secrets provider system for colony
 */

import { isPlainObject } from "./util.js";

// Global provider registry
const globalRegistry = new Map();

/**
 * Register a secret provider globally
 * @param {object} provider - Provider with prefix and fetch()
 */
export function registerSecretProvider(provider) {
  if (!provider.prefix || typeof provider.fetch !== "function") {
    throw new Error("Invalid provider: must have prefix and fetch()");
  }
  globalRegistry.set(provider.prefix.toUpperCase(), provider);
}

/**
 * Unregister a provider by prefix
 * @param {string} prefix - Provider prefix to remove
 * @returns {boolean} True if provider was removed
 */
export function unregisterSecretProvider(prefix) {
  return globalRegistry.delete(prefix.toUpperCase());
}

/**
 * Clear all registered providers
 */
export function clearSecretProviders() {
  globalRegistry.clear();
}

/**
 * Check if any global providers are registered
 * @returns {boolean}
 */
export function hasGlobalProviders() {
  return globalRegistry.size > 0;
}

/**
 * Simple LRU cache for secrets
 */
export class SecretCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end for LRU behavior
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expires: Date.now() + ttl });
  }

  invalidate(pattern) {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    const regex = new RegExp("^" + globToRegex(pattern) + "$");
    for (const key of this.cache.keys()) {
      if (regex.test(key)) this.cache.delete(key);
    }
  }
}

/**
 * Convert a glob pattern to regex, escaping special chars except *
 * @param {string} pattern - Glob pattern (e.g., "myapp/*")
 * @returns {string} Regex pattern string
 */
function globToRegex(pattern) {
  return pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // escape regex special chars
    .replace(/\*/g, ".*"); // convert glob * to regex .*
}

// Regex to match secret interpolations: ${PROVIDER:key}
// Provider must start with uppercase letter, followed by uppercase letters, digits, or underscores
const RX_SECRET = /\$\{([A-Z][A-Z0-9_]*):([^}]+)\}/g;

// Reserved prefixes that are not secrets
const RESERVED = new Set(["ENV", "VAR"]);

/**
 * Collect all secret references from a value tree
 * @param {any} value - Value to scan
 * @param {Map} refs - Map to collect refs into
 * @returns {Map} Map of fullKey -> { provider, key }
 */
export function collectSecretRefs(value, refs = new Map()) {
  if (typeof value === "string") {
    let match;
    RX_SECRET.lastIndex = 0;
    while ((match = RX_SECRET.exec(value)) !== null) {
      const [, provider, key] = match;
      if (RESERVED.has(provider)) continue;

      const fullKey = `${provider}:${key.trim()}`;
      if (!refs.has(fullKey)) {
        refs.set(fullKey, { provider, key: key.trim() });
      }
    }
    return refs;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSecretRefs(item, refs);
    }
    return refs;
  }

  if (isPlainObject(value)) {
    for (const v of Object.values(value)) {
      collectSecretRefs(v, refs);
    }
  }

  return refs;
}

/**
 * Check if a secret key matches any allowed pattern
 * @param {string} fullKey - Full key like "AWS:myapp/db"
 * @param {string[]|null} allowedSecrets - Allowed patterns
 * @returns {boolean}
 */
function isAllowed(fullKey, allowedSecrets) {
  if (allowedSecrets === null || allowedSecrets === undefined) return true;

  for (const pattern of allowedSecrets) {
    // Exact match
    if (pattern === fullKey) return true;

    // Glob pattern match on full key
    const regex = new RegExp("^" + globToRegex(pattern) + "$");
    if (regex.test(fullKey)) return true;

    // Pattern without provider matches any provider
    if (!pattern.includes(":")) {
      const keyOnly = fullKey.split(":")[1];
      const keyRegex = new RegExp("^" + globToRegex(pattern) + "$");
      if (keyRegex.test(keyOnly)) return true;
    }
  }

  return false;
}

/**
 * Fetch all secrets and apply to value tree
 * @param {any} value - Config value tree
 * @param {object} options - Options
 * @returns {Promise<any>} Value tree with secrets replaced
 */
export async function applySecretsDeep(value, options = {}) {
  const {
    providers = [],
    allowedSecrets = null,
    cache = null,
    cacheTtl = 300000,
    onNotFound = "warn",
    warnings = [],
  } = options;

  // Merge local providers with global registry
  const registry = new Map(globalRegistry);
  for (const p of providers) {
    registry.set(p.prefix.toUpperCase(), p);
  }

  // Collect all secret references
  const refs = collectSecretRefs(value);
  if (refs.size === 0) return value;

  // Fetch all secrets in parallel
  const resolved = new Map();
  const fetchPromises = [];

  for (const [fullKey, { provider, key }] of refs) {
    // Check allowlist
    if (!isAllowed(fullKey, allowedSecrets)) {
      warnings.push({
        type: "blocked_secret",
        provider,
        key,
        message: `Access to secret "${fullKey}" blocked by allowedSecrets`,
      });
      resolved.set(fullKey, "");
      continue;
    }

    // Check cache
    if (cache) {
      const cached = cache.get(fullKey);
      if (cached !== undefined) {
        resolved.set(fullKey, cached);
        continue;
      }
    }

    // Check provider exists
    const providerInstance = registry.get(provider);
    if (!providerInstance) {
      warnings.push({
        type: "unknown_provider",
        provider,
        key,
        message: `No provider registered for "${provider}"`,
      });
      resolved.set(fullKey, "");
      continue;
    }

    // Queue fetch
    fetchPromises.push(
      providerInstance
        .fetch(key)
        .then((val) => {
          const strVal = val ?? "";
          if (cache) cache.set(fullKey, strVal, cacheTtl);
          resolved.set(fullKey, strVal);
        })
        .catch((err) => {
          const isNotFound =
            err.code === "NOT_FOUND" ||
            err.name === "ResourceNotFoundException" ||
            err.message?.includes("not found");

          if (isNotFound) {
            if (onNotFound === "error") {
              throw new Error(`COLONY: Secret not found: ${fullKey}`);
            }
            warnings.push({
              type: "secret_not_found",
              provider,
              key,
              message: `Secret "${fullKey}" not found`,
            });
            resolved.set(fullKey, "");
          } else {
            if (onNotFound === "error") {
              throw err;
            }
            warnings.push({
              type: "secret_fetch_error",
              provider,
              key,
              message: `Failed to fetch "${fullKey}": ${err.message}`,
            });
            resolved.set(fullKey, "");
          }
        })
    );
  }

  await Promise.all(fetchPromises);

  // Apply resolved secrets to value tree
  return replaceSecrets(value, resolved);
}

/**
 * Replace secret placeholders with resolved values
 * @param {any} value - Value to process
 * @param {Map} resolved - Map of fullKey -> resolved value
 * @returns {any} Value with secrets replaced
 */
function replaceSecrets(value, resolved) {
  if (typeof value === "string") {
    return value.replace(RX_SECRET, (match, provider, key) => {
      if (RESERVED.has(provider)) return match;
      const fullKey = `${provider}:${key.trim()}`;
      return resolved.get(fullKey) ?? "";
    });
  }

  if (Array.isArray(value)) {
    return value.map((v) => replaceSecrets(v, resolved));
  }

  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = replaceSecrets(v, resolved);
    }
    return out;
  }

  return value;
}
