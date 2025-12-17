/**
 * Base class for Vault-compatible secret providers (Vault, OpenBao)
 * Both use the same HTTP API, differing only in environment variables and naming.
 */

/**
 * @class VaultCompatibleProvider
 * @property {string} prefix - Provider prefix
 */
export class VaultCompatibleProvider {
  /**
   * @param {object} config
   * @param {string} config.prefix - Provider prefix (e.g., "VAULT", "OPENBAO")
   * @param {string} config.addrEnvVar - Environment variable for address
   * @param {string} config.tokenEnvVar - Environment variable for token
   * @param {string} config.namespaceEnvVar - Environment variable for namespace
   * @param {string} config.errorPrefix - Prefix for error messages
   * @param {object} options - User options
   * @param {string=} options.addr - Server address
   * @param {string=} options.token - Auth token
   * @param {string=} options.namespace - Namespace
   * @param {number=} options.timeout - Request timeout in ms (default: 30000)
   */
  constructor(config, options = {}) {
    this.prefix = config.prefix;
    this.errorPrefix = config.errorPrefix;
    this.addr = options.addr ?? process.env[config.addrEnvVar] ?? "http://127.0.0.1:8200";
    this.token = options.token ?? process.env[config.tokenEnvVar];
    this.namespace = options.namespace ?? process.env[config.namespaceEnvVar];
    this.timeout = options.timeout ?? 30000;
    this.tokenEnvVar = config.tokenEnvVar;
  }

  /**
   * Fetch a secret value
   * @param {string} key - Secret path, optionally with field: "secret/data/myapp#password"
   * @returns {Promise<string>}
   */
  async fetch(key) {
    const [path, field] = key.split("#");

    const url = `${this.addr}/v1/${path}`;
    const headers = {
      "X-Vault-Token": this.token,
    };
    if (this.namespace) {
      headers["X-Vault-Namespace"] = this.namespace;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === 404) {
      const err = new Error(`Secret not found: ${key}`);
      err.code = "NOT_FOUND";
      throw err;
    }

    if (!response.ok) {
      throw new Error(`${this.errorPrefix} error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // KV v2 returns data.data.data, KV v1 returns data.data
    const secretData = data.data?.data ?? data.data;

    if (field) {
      return String(secretData?.[field] ?? "");
    }

    if (typeof secretData === "object" && secretData !== null) {
      const values = Object.values(secretData);
      if (values.length === 1) return String(values[0]);
      return JSON.stringify(secretData);
    }

    return String(secretData ?? "");
  }

  /**
   * Validate provider configuration
   * @returns {Promise<void>}
   */
  async validate() {
    if (!this.token) {
      throw new Error(`${this.tokenEnvVar} is required`);
    }
  }
}
