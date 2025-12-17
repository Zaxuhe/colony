/**
 * OpenBao provider for colony
 * OpenBao is an API-compatible fork of HashiCorp Vault
 */

import { VaultCompatibleProvider } from "./vault-base.js";

/**
 * @class OpenBaoProvider
 * @property {string} prefix - Provider prefix ("OPENBAO")
 */
export class OpenBaoProvider extends VaultCompatibleProvider {
  /**
   * @param {object} options
   * @param {string=} options.addr - OpenBao address (default: process.env.BAO_ADDR or "http://127.0.0.1:8200")
   * @param {string=} options.token - OpenBao token (default: process.env.BAO_TOKEN)
   * @param {string=} options.namespace - OpenBao namespace (default: process.env.BAO_NAMESPACE)
   * @param {number=} options.timeout - Request timeout in ms (default: 30000)
   */
  constructor(options = {}) {
    super(
      {
        prefix: "OPENBAO",
        addrEnvVar: "BAO_ADDR",
        tokenEnvVar: "BAO_TOKEN",
        namespaceEnvVar: "BAO_NAMESPACE",
        errorPrefix: "OpenBao",
      },
      options
    );
  }
}
