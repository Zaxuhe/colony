export function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function getDeep(obj, pathSegs) {
  let cur = obj;
  for (const k of pathSegs) {
    if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[k];
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function setDeep(obj, pathSegs, value) {
  let cur = obj;
  for (let i = 0; i < pathSegs.length; i++) {
    const k = pathSegs[i];
    if (i === pathSegs.length - 1) {
      cur[k] = value;
      return;
    }
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  }
}

export function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return b;
}

/**
 * Get a value from an object using dot-notation path string
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., "database.password")
 * @returns {any}
 */
export function getByPath(obj, path) {
  const parts = String(path).split(".").filter(Boolean);
  return getDeep(obj, parts);
}
