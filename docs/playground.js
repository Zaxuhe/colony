/**
 * Colony Playground - Interactive config editor
 */

(function() {
  'use strict';

  // Elements
  const editorEl = document.getElementById('editor');
  const outputEl = document.getElementById('output');
  const errorEl = document.getElementById('error');
  const dimInputsContainer = document.getElementById('dim-inputs');
  const dimInputsContainer2 = document.getElementById('dim-inputs-2');
  const diffContextEl = document.getElementById('diff-context');
  const contextLabelEl = document.getElementById('context-label');
  const examplesSelect = document.getElementById('examples');
  const shareBtn = document.getElementById('share-btn');
  const tabs = document.querySelectorAll('.tab');

  // State
  let currentTab = 'resolved';
  let editor = null;
  let currentDims = ['env'];
  let dimValues = { env: 'prod' };
  let dimValues2 = { env: 'dev' }; // Second context for diff

  // Example configs
  const examples = {
    basic: `@dims env;

# Default for all environments
*.log.level = "info";
*.debug = false;
*.app.name = "MyApp";

# Development overrides
dev.log.level = "debug";
dev.debug = true;

# Production settings
prod.log.level = "warn";
prod.cache.enabled = true;
`,
    'multi-env': `@dims env, region;

# Global defaults
*.*.api.timeout = 5000;
*.*.api.retries = 3;

# Environment defaults
prod.*.log.level = "warn";
dev.*.log.level = "debug";
staging.*.log.level = "info";

# Region-specific
*.us-east-1.api.endpoint = "https://api-east.example.com";
*.eu-west-1.api.endpoint = "https://api-eu.example.com";

# Production US-East gets special treatment
prod.us-east-1.api.timeout = 3000;
prod.us-east-1.features.beta = false;
`,
    operators: `@dims env;

# = : Set value (overwrites)
*.database.host = "localhost";
*.database.port = 5432;

# := : Set if not already set (default)
*.log.level := "info";
prod.log.level = "warn";  # This wins over :=

# |= : Deep merge objects
*.database |= { pool: { min: 2, max: 10 } };
prod.database |= { pool: { max: 50 }, ssl: true };

# += : Append to array
*.features += ["auth"];
*.features += ["logging"];
prod.features += ["caching", "compression"];

# -= : Remove from array
dev.features -= ["compression"];
`,
    scopes: `@dims env, realm, region;

# Most general (specificity: 0)
*.*.*.timeout = 30000;
*.*.*.retries = 3;

# One dimension specified (specificity: 1)
prod.*.*.timeout = 10000;
*.US.*.maxConnections = 100;
*.*.us-east-1.datacenter = "DC1";

# Two dimensions (specificity: 2)
prod.US.*.timeout = 5000;
prod.*.us-east-1.primary = true;

# Most specific (specificity: 3)
prod.US.us-east-1.timeout = 3000;
prod.US.us-east-1.features = ["fast-path", "edge-cache"];
`
  };

  // Initialize CodeMirror if available
  function initEditor() {
    if (typeof CodeMirror !== 'undefined') {
      editor = CodeMirror.fromTextArea(editorEl, {
        mode: null,
        theme: 'default',
        lineNumbers: true,
        lineWrapping: true,
        tabSize: 2,
        indentWithTabs: false,
      });

      // Style CodeMirror for dark theme
      const cm = document.querySelector('.CodeMirror');
      if (cm) {
        cm.style.background = 'var(--bg-primary)';
        cm.style.color = 'var(--text-primary)';
        cm.style.height = '100%';
        cm.style.fontFamily = 'var(--font-mono)';
      }

      editor.on('change', debounce(update, 150));
      return;
    }

    // Fallback to textarea
    editorEl.addEventListener('input', debounce(update, 150));
  }

  // Get editor content
  function getEditorContent() {
    return editor ? editor.getValue() : editorEl.value;
  }

  // Set editor content
  function setEditorContent(content) {
    if (editor) {
      editor.setValue(content);
    } else {
      editorEl.value = content;
    }
  }

  // Render dimension inputs based on detected dims
  function renderDimInputs(dims) {
    renderDimInputsTo(dimInputsContainer, dims, dimValues, (dim, value) => {
      dimValues[dim] = value || '*';
      update();
    });
    renderDimInputsTo(dimInputsContainer2, dims, dimValues2, (dim, value) => {
      dimValues2[dim] = value || '*';
      update();
    });
  }

  function renderDimInputsTo(container, dims, values, onChange) {
    container.innerHTML = '';

    for (const dim of dims) {
      const wrapper = document.createElement('div');
      wrapper.className = 'dim-input-wrapper';

      const label = document.createElement('span');
      label.className = 'dim-label';
      label.textContent = dim + ':';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'dim-input';
      input.dataset.dim = dim;
      input.placeholder = '*';
      input.value = values[dim] || '';
      input.addEventListener('input', debounce(() => {
        onChange(dim, input.value);
      }, 150));

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      container.appendChild(wrapper);
    }
  }

  // Get current context from dimension inputs
  function getContext() {
    const ctx = {};
    for (const dim of currentDims) {
      ctx[dim] = dimValues[dim] || '*';
    }
    return ctx;
  }

  // Get second context for diff mode
  function getContext2() {
    const ctx = {};
    for (const dim of currentDims) {
      ctx[dim] = dimValues2[dim] || '*';
    }
    return ctx;
  }

  // Syntax highlight JSON output
  function highlightJson(json) {
    return json
      .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
      .replace(/: "([^"]+)"/g, ': <span class="string">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="boolean">$1</span>')
      .replace(/: null/g, ': <span class="null">null</span>');
  }

  // Collect all leaf keys from an object
  function collectKeys(obj, prefix = '') {
    const keys = [];
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        keys.push(...collectKeys(v, path));
      } else {
        keys.push(path);
      }
    }
    return keys.sort();
  }

  // Get value by dot-notation path
  function getByPath(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  // Compute diff between two configs
  function computeDiff(cfg1, cfg2) {
    const keys1 = new Set(collectKeys(cfg1));
    const keys2 = new Set(collectKeys(cfg2));

    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];

    // Keys in cfg2 but not in cfg1
    for (const key of keys2) {
      if (!keys1.has(key)) {
        added.push({ key, value: getByPath(cfg2, key) });
      }
    }

    // Keys in cfg1 but not in cfg2
    for (const key of keys1) {
      if (!keys2.has(key)) {
        removed.push({ key, value: getByPath(cfg1, key) });
      }
    }

    // Keys in both - check for changes
    for (const key of keys1) {
      if (keys2.has(key)) {
        const v1 = getByPath(cfg1, key);
        const v2 = getByPath(cfg2, key);
        if (JSON.stringify(v1) !== JSON.stringify(v2)) {
          changed.push({ key, from: v1, to: v2 });
        } else {
          unchanged.push({ key, value: v1 });
        }
      }
    }

    return { added, removed, changed, unchanged };
  }

  // Render diff as HTML
  function renderDiff(diff, ctx1, ctx2) {
    const ctx1Str = Object.entries(ctx1).map(([k,v]) => `${k}=${v}`).join(' ');
    const ctx2Str = Object.entries(ctx2).map(([k,v]) => `${k}=${v}`).join(' ');

    let html = `<div class="diff-header">
  <span class="diff-ctx diff-ctx-1">${escapeHtml(ctx1Str)}</span>
  <span class="diff-arrow">→</span>
  <span class="diff-ctx diff-ctx-2">${escapeHtml(ctx2Str)}</span>
</div>\n`;

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
      html += '<div class="diff-empty">No differences</div>';
      return html;
    }

    if (diff.added.length > 0) {
      html += '<div class="diff-section diff-added">\n';
      html += `<div class="diff-section-header">+ Added (${diff.added.length})</div>\n`;
      for (const { key, value } of diff.added) {
        html += `<div class="diff-line"><span class="diff-key">${escapeHtml(key)}</span>: ${formatValue(value)}</div>\n`;
      }
      html += '</div>\n';
    }

    if (diff.removed.length > 0) {
      html += '<div class="diff-section diff-removed">\n';
      html += `<div class="diff-section-header">- Removed (${diff.removed.length})</div>\n`;
      for (const { key, value } of diff.removed) {
        html += `<div class="diff-line"><span class="diff-key">${escapeHtml(key)}</span>: ${formatValue(value)}</div>\n`;
      }
      html += '</div>\n';
    }

    if (diff.changed.length > 0) {
      html += '<div class="diff-section diff-changed">\n';
      html += `<div class="diff-section-header">~ Changed (${diff.changed.length})</div>\n`;
      for (const { key, from, to } of diff.changed) {
        html += `<div class="diff-line"><span class="diff-key">${escapeHtml(key)}</span>: ${formatValue(from)} <span class="diff-arrow">→</span> ${formatValue(to)}</div>\n`;
      }
      html += '</div>\n';
    }

    if (diff.unchanged.length > 0) {
      html += '<div class="diff-section diff-unchanged">\n';
      html += `<div class="diff-section-header">= Unchanged (${diff.unchanged.length})</div>\n`;
      for (const { key, value } of diff.unchanged) {
        html += `<div class="diff-line"><span class="diff-key">${escapeHtml(key)}</span>: ${formatValue(value)}</div>\n`;
      }
      html += '</div>\n';
    }

    return html;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatValue(value) {
    if (typeof value === 'string') return `<span class="string">"${escapeHtml(value)}"</span>`;
    if (typeof value === 'number') return `<span class="number">${value}</span>`;
    if (typeof value === 'boolean') return `<span class="boolean">${value}</span>`;
    if (value === null) return '<span class="null">null</span>';
    if (Array.isArray(value)) return `<span class="array">${escapeHtml(JSON.stringify(value))}</span>`;
    return escapeHtml(JSON.stringify(value));
  }

  // Update output
  function update() {
    const content = getEditorContent();

    try {
      // Parse the config
      const parsed = Colony.parseColony(content, { filePath: 'playground.colony' });
      const dims = parsed.dims || ['env'];

      // Update dimension inputs if dims changed
      if (JSON.stringify(dims) !== JSON.stringify(currentDims)) {
        currentDims = dims;
        // Preserve existing values, reset ones that no longer exist
        const newDimValues = {};
        const newDimValues2 = {};
        for (const dim of dims) {
          newDimValues[dim] = dimValues[dim] || (dim === 'env' ? 'prod' : '*');
          newDimValues2[dim] = dimValues2[dim] || (dim === 'env' ? 'dev' : '*');
        }
        dimValues = newDimValues;
        dimValues2 = newDimValues2;
        renderDimInputs(dims);
      }

      if (currentTab === 'parsed') {
        // Show parsed AST
        const output = {
          dims: parsed.dims,
          rules: parsed.rules.map(r => ({
            scope: r.keySegments.slice(0, dims.length),
            key: r.keySegments.slice(dims.length).join('.'),
            op: r.op,
            value: r.value,
            line: r.line
          }))
        };
        outputEl.innerHTML = highlightJson(JSON.stringify(output, null, 2));
      } else if (currentTab === 'diff') {
        // Diff mode - compare two contexts
        const ctx1 = getContext();
        const ctx2 = getContext2();

        const resolved1 = Colony.resolveRules({
          rules: parsed.rules,
          dims: dims,
          ctx: ctx1,
          vars: {},
          warnings: []
        });

        const resolved2 = Colony.resolveRules({
          rules: parsed.rules,
          dims: dims,
          ctx: ctx2,
          vars: {},
          warnings: []
        });

        const plain1 = resolved1.toJSON ? resolved1.toJSON() : { ...resolved1 };
        const plain2 = resolved2.toJSON ? resolved2.toJSON() : { ...resolved2 };

        // Compute diff
        const diff = computeDiff(plain1, plain2);
        outputEl.innerHTML = renderDiff(diff, ctx1, ctx2);
      } else {
        // Resolve with context
        const ctx = getContext();

        const resolved = Colony.resolveRules({
          rules: parsed.rules,
          dims: dims,
          ctx: ctx,
          vars: {},
          warnings: []
        });

        // Get plain object (exclude methods)
        const plain = resolved.toJSON ? resolved.toJSON() : { ...resolved };
        outputEl.innerHTML = highlightJson(JSON.stringify(plain, null, 2));
      }

      errorEl.classList.add('hidden');
      outputEl.classList.remove('hidden');

    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      outputEl.classList.add('hidden');
    }

    // Update URL hash
    updateUrl();
  }

  // Debounce helper
  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // URL hash for sharing
  function updateUrl() {
    const content = getEditorContent();
    const ctxStr = Object.entries(dimValues).map(([k, v]) => `${k}=${v}`).join(' ');
    const hash = `config=${btoa(encodeURIComponent(content))}&ctx=${encodeURIComponent(ctxStr)}`;
    history.replaceState(null, '', '#' + hash);
  }

  function loadFromUrl() {
    const hash = location.hash.slice(1);
    if (!hash) return false;

    try {
      const params = new URLSearchParams(hash);
      const config = params.get('config');
      const ctx = params.get('ctx');

      if (config) {
        setEditorContent(decodeURIComponent(atob(config)));
      }
      if (ctx) {
        // Parse context string into dimValues
        const parts = decodeURIComponent(ctx).trim().split(/\s+/);
        for (const part of parts) {
          const [key, value] = part.split('=');
          if (key && value) {
            dimValues[key.trim()] = value.trim();
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  // Share button
  function copyShareUrl() {
    navigator.clipboard.writeText(location.href).then(() => {
      const originalText = shareBtn.textContent;
      shareBtn.textContent = 'Copied!';
      setTimeout(() => {
        shareBtn.textContent = originalText;
      }, 1500);
    });
  }

  // Tab switching
  function switchTab(tab) {
    currentTab = tab;
    tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Show/hide diff context inputs
    if (tab === 'diff') {
      diffContextEl.classList.remove('hidden');
      contextLabelEl.textContent = 'From:';
    } else {
      diffContextEl.classList.add('hidden');
      contextLabelEl.textContent = 'Context:';
    }

    update();
  }

  // Load example
  function loadExample(name) {
    if (examples[name]) {
      setEditorContent(examples[name]);
      update();
    }
    examplesSelect.value = '';
  }

  // Event listeners
  examplesSelect.addEventListener('change', (e) => loadExample(e.target.value));
  shareBtn.addEventListener('click', copyShareUrl);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Initialize
  initEditor();

  // Load from URL if available
  loadFromUrl();

  // Initial render of dimension inputs
  renderDimInputs(currentDims);

  // Initial update
  update();
})();
