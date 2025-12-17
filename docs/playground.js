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
  const examplesSelect = document.getElementById('examples');
  const shareBtn = document.getElementById('share-btn');
  const tabs = document.querySelectorAll('.tab');

  // State
  let currentTab = 'resolved';
  let editor = null;
  let currentDims = ['env'];
  let dimValues = { env: 'prod' };

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
    dimInputsContainer.innerHTML = '';

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
      input.value = dimValues[dim] || '';
      input.addEventListener('input', debounce(() => {
        dimValues[dim] = input.value || '*';
        update();
      }, 150));

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      dimInputsContainer.appendChild(wrapper);
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

  // Syntax highlight JSON output
  function highlightJson(json) {
    return json
      .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
      .replace(/: "([^"]+)"/g, ': <span class="string">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="boolean">$1</span>')
      .replace(/: null/g, ': <span class="null">null</span>');
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
        for (const dim of dims) {
          newDimValues[dim] = dimValues[dim] || (dim === 'env' ? 'prod' : '*');
        }
        dimValues = newDimValues;
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
