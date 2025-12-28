import { applyInterpolationDeep } from "./strings.js";
import { getDeep, setDeep, deepMerge, isPlainObject } from "./util.js";

export function resolveRules({ rules, dims, ctx, vars, env = null, allowedEnvVars = null, allowedVars = null, warnings = [] }) {
  const indexed = [];
  for (const r of rules) {
    const scope = r.keySegments.slice(0, dims.length);
    const keyPath = r.keySegments.slice(dims.length);

    if (scope.length !== dims.length || keyPath.length === 0) {
      throw new Error(
        `${r.filePath}:${r.line}: Key must have ${dims.length} scope segments + at least one key segment: ${r.keyRaw}`
      );
    }

    indexed.push({
      ...r,
      scope,
      keyPath,
      keyPathStr: keyPath.join("."),
    });
  }

  const ctxScope = dims.map((d) => String(ctx[d] ?? ""));

  const candidatesByKey = new Map();
  const postOps = [];

  for (const r of indexed) {
    if (!matches(r.scope, ctxScope)) continue;

    if (r.op === "+=" || r.op === "-=") postOps.push(r);
    else {
      if (!candidatesByKey.has(r.keyPathStr)) candidatesByKey.set(r.keyPathStr, []);
      candidatesByKey.get(r.keyPathStr).push(r);
    }
  }

  const out = {};
  const trace = new Map();

  for (const [key, cand] of candidatesByKey.entries()) {
    let winner = cand[0];
    let best = specificity(winner.scope);
    for (let i = 1; i < cand.length; i++) {
      const s = specificity(cand[i].scope);
      if (s > best) {
        best = s;
        winner = cand[i];
      } else if (s === best) {
        winner = cand[i];
      }
    }

    const existing = getDeep(out, winner.keyPath);

    if (winner.op === ":=") {
      if (existing === undefined) {
        setDeep(out, winner.keyPath, clone(winner.value));
        trace.set(key, packTrace(winner, best));
      }
      continue;
    }

    if (winner.op === "|=") {
      if (existing === undefined) {
        setDeep(out, winner.keyPath, clone(winner.value));
      } else if (isPlainObject(existing) && isPlainObject(winner.value)) {
        setDeep(out, winner.keyPath, deepMerge(existing, winner.value));
      } else {
        setDeep(out, winner.keyPath, clone(winner.value));
      }
      trace.set(key, packTrace(winner, best));
      continue;
    }

    setDeep(out, winner.keyPath, clone(winner.value));
    trace.set(key, packTrace(winner, best));
  }

  postOps.sort((a, b) => specificity(a.scope) - specificity(b.scope));

  for (const r of postOps) {
    const key = r.keyPathStr;
    const best = specificity(r.scope);

    const existing = getDeep(out, r.keyPath);
    const val = clone(r.value);

    if (r.op === "+=") {
      const add = Array.isArray(val) ? val : [val];
      if (existing === undefined) setDeep(out, r.keyPath, add);
      else if (Array.isArray(existing)) setDeep(out, r.keyPath, existing.concat(add));
      else setDeep(out, r.keyPath, [existing].concat(add));
      trace.set(key, packTrace(r, best));
      continue;
    }

    if (r.op === "-=") {
      const remove = new Set(Array.isArray(val) ? val : [val]);
      if (Array.isArray(existing)) {
        setDeep(out, r.keyPath, existing.filter((x) => !remove.has(x)));
        trace.set(key, packTrace(r, best));
      }
      continue;
    }
  }

  const finalCfg = applyInterpolationDeep(out, { ctx, vars, env, allowedEnvVars, allowedVars, warnings });

  Object.defineProperties(finalCfg, {
    // Core methods
    get: { enumerable: false, value: (p) => getByPath(finalCfg, p) },
    explain: { enumerable: false, value: (p) => explainByPath(trace, p) },

    // Serialization - returns a plain object copy without non-enumerable methods
    toJSON: {
      enumerable: false,
      value: () => {
        const plain = {};
        for (const [k, v] of Object.entries(finalCfg)) {
          plain[k] = clone(v);
        }
        return plain;
      },
    },

    // List all keys (dot-notation paths)
    keys: {
      enumerable: false,
      value: () => collectKeys(finalCfg),
    },

    // Diff against another config
    diff: {
      enumerable: false,
      value: (other) => diffConfigs(finalCfg, other),
    },

    // Internal trace data
    _trace: { enumerable: false, value: trace },
  });

  return finalCfg;
}

/**
 * Collect all leaf keys in dot notation
 * @param {object} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function collectKeys(obj, prefix = "") {
  const keys = [];

  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;

    if (isPlainObject(v)) {
      keys.push(...collectKeys(v, path));
    } else {
      keys.push(path);
    }
  }

  return keys.sort();
}

/**
 * Diff two configs, returning added, removed, and changed keys
 * @param {object} a - First config
 * @param {object} b - Second config
 * @returns {{ added: string[], removed: string[], changed: Array<{key: string, from: any, to: any}> }}
 */
function diffConfigs(a, b) {
  const aKeys = new Set(collectKeys(a));
  const bKeys = new Set(collectKeys(b));

  const added = [];
  const removed = [];
  const changed = [];

  // Keys in b but not in a
  for (const key of bKeys) {
    if (!aKeys.has(key)) {
      added.push(key);
    }
  }

  // Keys in a but not in b
  for (const key of aKeys) {
    if (!bKeys.has(key)) {
      removed.push(key);
    }
  }

  // Keys in both - check for changes
  for (const key of aKeys) {
    if (bKeys.has(key)) {
      const aVal = getByPath(a, key);
      const bVal = getByPath(b, key);

      if (!deepEqual(aVal, bVal)) {
        changed.push({ key, from: aVal, to: bVal });
      }
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort((x, y) => x.key.localeCompare(y.key)),
  };
}

/**
 * Deep equality check for config values.
 * Note: Does not handle circular references (will stack overflow).
 * Config values should never be circular in practice.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }

  return false;
}

function getByPath(obj, p) {
  const segs = String(p).split(".").filter(Boolean);
  return getDeep(obj, segs);
}

function explainByPath(trace, p) {
  const key = String(p);
  return trace.get(key) ?? null;
}

function matches(ruleScope, ctxScope) {
  for (let i = 0; i < ruleScope.length; i++) {
    const r = String(ruleScope[i]);
    const c = String(ctxScope[i]);
    if (r === "*") continue;
    if (r !== c) return false;
  }
  return true;
}

function specificity(ruleScope) {
  let s = 0;
  for (const seg of ruleScope) if (seg !== "*") s++;
  return s;
}

function packTrace(rule, spec) {
  return {
    op: rule.op,
    scope: rule.scope.map(String),
    specificity: spec,
    filePath: rule.filePath,
    line: rule.line,
    col: rule.col ?? 0,
    keyRaw: rule.keyRaw,
    // Source map style location
    source: `${rule.filePath}:${rule.line}:${rule.col ?? 0}`,
  };
}

function clone(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (typeof v === "object") return structuredClone(v);
  return v;
}
