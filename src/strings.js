import { isPlainObject } from "./util.js";

// Regex to detect secret provider patterns: ${PROVIDER:key}
// Provider must start with uppercase letter, followed by uppercase letters, digits, or underscores
const RX_SECRET_PROVIDER = /^[A-Z][A-Z0-9_]*:/;

export function applyInterpolationDeep(value, { ctx, vars, env = null, allowedEnvVars = null, allowedVars = null, warnings = [] }) {
  if (typeof value === "string") return interpolate(value, { ctx, vars, env, allowedEnvVars, allowedVars, warnings });
  if (Array.isArray(value)) return value.map((v) => applyInterpolationDeep(v, { ctx, vars, env, allowedEnvVars, allowedVars, warnings }));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = applyInterpolationDeep(v, { ctx, vars, env, allowedEnvVars, allowedVars, warnings });
    }
    return out;
  }
  return value;
}

export function interpolate(s, { ctx, vars, env = null, allowedEnvVars = null, allowedVars = null, warnings = [] }) {
  // Merge env with process.env (env takes precedence)
  const envSource = env ? { ...process.env, ...env } : process.env;

  return s.replace(/\$\{([^}]+)\}/g, (match, exprRaw) => {
    const expr = exprRaw.trim();

    if (expr.startsWith("ENV:")) {
      const k = expr.slice(4).trim();
      // Security: check if env var is allowed
      if (allowedEnvVars !== null && !allowedEnvVars.includes(k)) {
        warnings.push({
          type: "blocked_env_var",
          var: k,
          message: `Access to environment variable "${k}" blocked by allowedEnvVars whitelist`,
        });
        return "";
      }
      return envSource[k] ?? "";
    }

    if (expr.startsWith("VAR:")) {
      const k = expr.slice(4).trim();
      // Security: check if custom var is allowed
      if (allowedVars !== null && !allowedVars.includes(k)) {
        warnings.push({
          type: "blocked_var",
          var: k,
          message: `Access to custom variable "${k}" blocked by allowedVars whitelist`,
        });
        return "";
      }
      if (vars?.[k] === undefined) {
        warnings.push({
          type: "unknown_var",
          var: k,
          message: `Unknown VAR "${k}" in interpolation ${match}`,
        });
      }
      return String(vars?.[k] ?? "");
    }

    if (expr.startsWith("ctx.")) {
      const k = expr.slice(4).trim();
      if (ctx?.[k] === undefined) {
        warnings.push({
          type: "unknown_ctx",
          var: k,
          message: `Unknown ctx dimension "${k}" in interpolation ${match}`,
        });
      }
      return String(ctx?.[k] ?? "");
    }

    // Secret provider patterns (e.g., ${AWS:...}, ${OPENBAO:...}) - leave for secrets.js
    if (RX_SECRET_PROVIDER.test(expr)) {
      return match; // Keep the pattern intact for later secret processing
    }

    // Unknown interpolation pattern
    warnings.push({
      type: "unknown_interpolation",
      pattern: match,
      message: `Unknown interpolation pattern: ${match}`,
    });
    return "";
  });
}
