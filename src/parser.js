import JSON5 from "json5";

const RX_DIMS = /^@dims\s+([^;]+);/;
const RX_INCLUDE = /^@include\s+(.+);/;
const RX_REQUIRE = /^@require\s+([^;]+);/;
const RX_ENVDEFAULTS = /^@envDefaults\s+([^;]+);/;

// Rule: <scoped.key.path> <op> <value>;
// Using [\s\S] instead of . to match newlines in multi-line values
const RX_RULE = /^(.+?)\s*(\:=|\|\=|\+\=|\-\=|\=)\s*([\s\S]+)\s*;$/;

// Heredoc: <<EOF ... EOF
const RX_HEREDOC_START = /<<([A-Z_][A-Z0-9_]*)\s*$/;

/**
 * Remove block comments from text (slash-star to star-slash)
 * @param {string} text
 * @returns {{ text: string, lineMap: number[] }} - cleaned text and mapping from new line numbers to original
 */
function stripBlockComments(text) {
  const result = [];
  const lineMap = []; // lineMap[newLineNo] = originalLineNo
  let inComment = false;
  let commentDepth = 0;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const originalLineNo = i + 1;
    let line = lines[i];
    let cleanLine = "";
    let j = 0;

    while (j < line.length) {
      if (!inComment) {
        // Check for comment start
        if (line[j] === "/" && line[j + 1] === "*") {
          inComment = true;
          commentDepth = 1;
          j += 2;
          continue;
        }
        cleanLine += line[j];
        j++;
      } else {
        // Inside block comment
        if (line[j] === "/" && line[j + 1] === "*") {
          commentDepth++;
          j += 2;
        } else if (line[j] === "*" && line[j + 1] === "/") {
          commentDepth--;
          if (commentDepth === 0) {
            inComment = false;
          }
          j += 2;
        } else {
          j++;
        }
      }
    }

    result.push(cleanLine);
    lineMap.push(originalLineNo);
  }

  return { text: result.join("\n"), lineMap };
}

/**
 * Parse a key path with escaped dots
 * "foo\.bar.baz" => ["foo.bar", "baz"]
 * @param {string} keyRaw
 * @returns {string[]}
 */
function parseKeyPath(keyRaw) {
  const segments = [];
  let current = "";
  let i = 0;

  while (i < keyRaw.length) {
    if (keyRaw[i] === "\\" && keyRaw[i + 1] === ".") {
      // Escaped dot - include literal dot
      current += ".";
      i += 2;
    } else if (keyRaw[i] === ".") {
      // Segment separator
      if (current.trim()) segments.push(current.trim());
      current = "";
      i++;
    } else {
      current += keyRaw[i];
      i++;
    }
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

/**
 * Format a parse error with line context and caret
 * @param {string} message
 * @param {string[]} lines
 * @param {number} lineNo - 1-indexed line number
 * @param {number=} col - 0-indexed column (optional)
 * @param {string} filePath
 * @returns {string}
 */
function formatParseError(message, lines, lineNo, col, filePath) {
  const idx = lineNo - 1;
  const contextLines = [];

  // Show up to 2 lines before
  for (let i = Math.max(0, idx - 2); i < idx; i++) {
    contextLines.push(`  ${String(i + 1).padStart(4)} | ${lines[i]}`);
  }

  // Show the error line
  if (idx >= 0 && idx < lines.length) {
    contextLines.push(`> ${String(lineNo).padStart(4)} | ${lines[idx]}`);

    // Show caret if column is specified
    if (typeof col === "number" && col >= 0) {
      const padding = " ".repeat(col + 9); // account for "> XXXX | "
      contextLines.push(`${padding}^`);
    }
  }

  // Show up to 1 line after
  if (idx + 1 < lines.length) {
    contextLines.push(`  ${String(idx + 2).padStart(4)} | ${lines[idx + 1]}`);
  }

  return `${filePath}:${lineNo}: ${message}\n\n${contextLines.join("\n")}`;
}

export function parseColony(text, { filePath = "<memory>", parseOnlyDirectives = false } = {}) {
  // Strip block comments first, keeping track of original line numbers
  const { text: cleanedText, lineMap } = stripBlockComments(text);
  const lines = cleanedText.split(/\r?\n/);
  const originalLines = text.split(/\r?\n/);

  const rules = [];
  const includes = [];
  const requires = [];
  const envDefaults = {};
  let dims = null;

  let buf = "";
  let bufStartLine = 0;
  let bufStartOriginalLine = 0;

  // Heredoc state
  let inHeredoc = false;
  let heredocDelimiter = "";
  let heredocContent = "";
  let heredocStartLine = 0;
  let heredocKey = "";
  let heredocOp = "";

  const getOriginalLine = (lineNo) => lineMap[lineNo - 1] || lineNo;

  const flush = () => {
    const raw = buf.trim();
    buf = "";
    if (!raw) return;

    const origLine = bufStartOriginalLine;

    const mDims = raw.match(RX_DIMS);
    if (mDims) {
      dims = mDims[1].split(",").map((s) => s.trim()).filter(Boolean);
      return;
    }

    const mInc = raw.match(RX_INCLUDE);
    if (mInc) {
      includes.push(stripQuotes(mInc[1].trim()));
      return;
    }

    const mReq = raw.match(RX_REQUIRE);
    if (mReq) {
      const keys = mReq[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      requires.push(...keys);
      return;
    }

    const mEnvDef = raw.match(RX_ENVDEFAULTS);
    if (mEnvDef) {
      const parts = mEnvDef[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const p of parts) {
        const idx = p.indexOf("=");
        if (idx === -1) {
          throw new Error(formatParseError(
            `Bad @envDefaults entry: ${p}`,
            originalLines,
            origLine,
            undefined,
            filePath
          ));
        }
        const k = p.slice(0, idx).trim();
        const vRaw = p.slice(idx + 1).trim();
        envDefaults[k] = stripQuotes(vRaw);
      }
      return;
    }

    if (parseOnlyDirectives) return;

    const mRule = raw.match(RX_RULE);
    if (!mRule) {
      throw new Error(formatParseError(
        "Invalid statement",
        originalLines,
        origLine,
        undefined,
        filePath
      ));
    }

    const keyRaw = mRule[1].trim();
    const op = mRule[2];
    const valueRaw = mRule[3].trim();

    const keySegments = parseKeyPath(keyRaw);
    if (keySegments.length === 0) {
      throw new Error(formatParseError(
        "Empty key",
        originalLines,
        origLine,
        0,
        filePath
      ));
    }

    const value = parseValue(valueRaw, { filePath, line: origLine, lines: originalLines });

    rules.push({
      filePath,
      line: origLine,
      col: 0,
      keyRaw,
      keySegments,
      op,
      value,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const originalLineNo = getOriginalLine(lineNo);
    const line = lines[i];
    const trimmed = line.trim();

    // Handle heredoc mode
    if (inHeredoc) {
      if (trimmed === heredocDelimiter) {
        // End of heredoc
        const keySegments = parseKeyPath(heredocKey);
        if (keySegments.length === 0) {
          throw new Error(formatParseError(
            "Empty key in heredoc",
            originalLines,
            heredocStartLine,
            0,
            filePath
          ));
        }

        rules.push({
          filePath,
          line: heredocStartLine,
          col: 0,
          keyRaw: heredocKey,
          keySegments,
          op: heredocOp,
          value: heredocContent,
        });

        inHeredoc = false;
        heredocContent = "";
        continue;
      }

      // Add line to heredoc content
      heredocContent += (heredocContent ? "\n" : "") + line;
      continue;
    }

    // Skip empty lines and line comments
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    // Check for heredoc start: key = <<EOF
    const heredocMatch = trimmed.match(/^(.+?)\s*(\:=|\|\=|\+\=|\-\=|\=)\s*<<([A-Z_][A-Z0-9_]*)$/);
    if (heredocMatch) {
      inHeredoc = true;
      heredocKey = heredocMatch[1].trim();
      heredocOp = heredocMatch[2];
      heredocDelimiter = heredocMatch[3];
      heredocStartLine = originalLineNo;
      heredocContent = "";
      continue;
    }

    if (!buf) {
      bufStartLine = lineNo;
      bufStartOriginalLine = originalLineNo;
    }
    buf += (buf ? "\n" : "") + line;

    if (trimmed.endsWith(";")) flush();
  }

  if (inHeredoc) {
    throw new Error(formatParseError(
      `Unterminated heredoc (missing ${heredocDelimiter})`,
      originalLines,
      heredocStartLine,
      undefined,
      filePath
    ));
  }

  if (buf.trim()) {
    throw new Error(formatParseError(
      "Unterminated statement (missing ';')",
      originalLines,
      bufStartOriginalLine,
      undefined,
      filePath
    ));
  }

  return { dims, includes, requires, envDefaults, rules };
}

function parseValue(raw, { filePath, line, lines }) {
  const r = raw.trim();

  if (/^(true|false|null)$/.test(r)) return JSON5.parse(r);
  if (/^-?\d+(\.\d+)?$/.test(r)) return Number(r);

  const starts = r[0];
  const ends = r[r.length - 1];
  const looksJsonish =
    (starts === "{" && ends === "}") ||
    (starts === "[" && ends === "]") ||
    (starts === `"` && ends === `"`) ||
    (starts === `'` && ends === `'`);

  if (looksJsonish) {
    try {
      return JSON5.parse(r);
    } catch (e) {
      throw new Error(formatParseError(
        `Bad JSON5 value: ${e.message}`,
        lines,
        line,
        undefined,
        filePath
      ));
    }
  }

  return r; // bareword => string
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
