/**
 * HashiCorp Vault provider for colony
 */

import { VaultCompatibleProvider } from "./vault-base.js";

/**
 * @class VaultProvider
 * @property {string} prefix - Provider prefix ("VAULT")
 */
export class VaultProvider extends VaultCompatibleProvider {
  /**
   * @param {object} options
   * @param {string=} options.addr - Vault address (default: process.env.VAULT_ADDR or "http://127.0.0.1:8200")
   * @param {string=} options.token - Vault token (default: process.env.VAULT_TOKEN)
   * @param {string=} options.namespace - Vault namespace (default: process.env.VAULT_NAMESPACE)
   * @param {number=} options.timeout - Request timeout in ms (default: 30000)
   */
  constructor(options = {}) {
    super(
      {
        prefix: "VAULT",
        addrEnvVar: "VAULT_ADDR",
        tokenEnvVar: "VAULT_TOKEN",
        namespaceEnvVar: "VAULT_NAMESPACE",
        errorPrefix: "Vault",
      },
      options
    );
  }
}
