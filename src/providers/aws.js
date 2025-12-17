/**
 * AWS Secrets Manager provider for colony
 */

/**
 * @class AwsSecretsProvider
 * @property {string} prefix - Provider prefix ("AWS")
 */
export class AwsSecretsProvider {
  prefix = "AWS";

  /**
   * @param {object} options
   * @param {string=} options.region - AWS region (default: process.env.AWS_REGION or "us-east-1")
   */
  constructor(options = {}) {
    this.region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
    this.client = null;
    this.clientPromise = null;
    this.GetSecretValueCommand = null;
  }

  /**
   * Get or create the AWS client (lazy initialization)
   * @returns {Promise<object>}
   */
  async getClient() {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    this.clientPromise = (async () => {
      // Dynamic import to avoid requiring AWS SDK if not used
      const { SecretsManagerClient, GetSecretValueCommand } = await import(
        "@aws-sdk/client-secrets-manager"
      );
      this.client = new SecretsManagerClient({ region: this.region });
      this.GetSecretValueCommand = GetSecretValueCommand;
      return this.client;
    })();

    return this.clientPromise;
  }

  /**
   * Fetch a secret value
   * @param {string} key - Secret key, optionally with JSON path: "secret-name#json.path"
   * @returns {Promise<string>}
   */
  async fetch(key) {
    const client = await this.getClient();

    // Support key with JSON path: secret-name#json.path
    const [secretId, jsonPath] = key.split("#");

    const command = new this.GetSecretValueCommand({ SecretId: secretId });
    const response = await client.send(command);

    let value = response.SecretString;
    if (!value && response.SecretBinary) {
      value = Buffer.from(response.SecretBinary).toString("utf-8");
    }

    // Extract JSON path if specified
    if (jsonPath && value) {
      try {
        const parsed = JSON.parse(value);
        value = getJsonPath(parsed, jsonPath);
      } catch {
        // Not JSON or invalid path, return as-is
      }
    }

    return value ?? "";
  }

  /**
   * Validate provider configuration
   * @returns {Promise<void>}
   */
  async validate() {
    // Try to initialize client to verify SDK is available
    await this.getClient();
  }

  /**
   * Cleanup resources
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this.client?.destroy) {
      this.client.destroy();
    }
    this.client = null;
    this.clientPromise = null;
  }
}

/**
 * Get a value from an object using dot notation path
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., "database.password")
 * @returns {string|undefined}
 */
function getJsonPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : JSON.stringify(current);
}
