/**
 * Playground entry point - exports parser and resolver for browser
 */

import { parseColony } from "../src/parser.js";
import { resolveRules } from "../src/resolver.js";

// Export for browser use
export { parseColony, resolveRules };

// Also attach to window for easy access
if (typeof window !== "undefined") {
  window.Colony = { parseColony, resolveRules };
}
