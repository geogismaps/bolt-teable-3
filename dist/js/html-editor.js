const API_BASE = window.location.origin;

let customerId = null;
let currentPage = 'dashboard';
let htmlEditor, cssEditor, jsEditor;
let currentTab = 'html';
let customer = null;

async function init() {
  const params = new URLSearchParams(window.location.search);
  customerId = params.get('customerId');

  if (!customerId) {
    alert('No customer ID provided');
    window.location.href = '/admin-dashboard.html';
    return;
  }

  await loadCustomer();
  initializeEditors();
  await loadCurrentPage();
  loadVersionHistory();

  document.querySelectorAll('.page-item').forEach(item => {
    item.addEventListener('click', () => {
      const pageName = item.dataset.page;
      selectPage(pageName);
    });
  });
}

async function loadCustomer() {
  try {
    const response = await fetch(`${API_BASE}/api/customers/${customerId}`);
    const data = await response.json();

    if (data.success) {
      customer = data.customer;
      document.getElementById('customerName').textContent = customer.name;
    }
  } catch (error) {
    console.error('Error loading customer:', error);
  }
}

function initializeEditors() {
  htmlEditor = CodeMirror.fromTextArea(document.getElementById('htmlEditor'), {
    mode: 'htmlmixed',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseTags: true,
    autoCloseBrackets: true,
    lineWrapping: true
  });

  cssEditor = CodeMirror.fromTextArea(document.getElementById('cssEditor'), {
    mode: 'css',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    lineWrapping: true
  });

  jsEditor = CodeMirror.fromTextArea(document.getElementById('jsEditor'), {
    mode: 'javascript',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    lineWrapping: true
  });

  htmlEditor.on('change', () => refreshPreview());
  cssEditor.on('change', () => refreshPreview());
  jsEditor.on('change', () => refreshPreview());
}

async function loadCurrentPage() {
  try {
    const response = await fetch(`${API_BASE}/api/html-editor/customers/${customerId}/pages/${currentPage}`);
    const data = await response.json();

    if (data.success && data.page) {
      htmlEditor.setValue(data.page.html_content || '');
      cssEditor.setValue(data.page.css_content || '');
      jsEditor.setValue(data.page.js_content || '');
    } else {
      const defaultHTML = await loadDefaultHTML(currentPage);
      htmlEditor.setValue(defaultHTML);
      cssEditor.setValue('');
      jsEditor.setValue('');
    }

    refreshPreview();
  } catch (error) {
    console.error('Error loading page:', error);
  }
}

async function loadDefaultHTML(pageName) {
  try {
    const response = await fetch(`/${pageName}.html`);
    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    console.error('Error loading default HTML:', error);
  }
  return '<html><head><title>New Page</title></head><body><h1>New Page</h1></body></html>';
}

function selectPage(pageName) {
  currentPage = pageName;

  document.querySelectorAll('.page-item').forEach(item => {
    item.classList.remove('active');
  });

  document.querySelector(`[data-page="${pageName}"]`).classList.add('active');

  document.getElementById('currentPageTitle').textContent =
    pageName.charAt(0).toUpperCase() + pageName.slice(1);

  loadCurrentPage();
  loadVersionHistory();
}

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  const editors = {
    html: htmlEditor,
    css: cssEditor,
    js: jsEditor
  };

  Object.entries(editors).forEach(([name, editor]) => {
    editor.getWrapperElement().style.display = name === tab ? 'block' : 'none';
  });

  editors[tab].refresh();
}

async function saveCurrentPage() {
  const adminSession = JSON.parse(localStorage.getItem('admin_session') || 'null');

  if (!adminSession) {
    alert('Please login as admin');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/html-editor/customers/${customerId}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageName: currentPage,
        htmlContent: htmlEditor.getValue(),
        cssContent: cssEditor.getValue(),
        jsContent: jsEditor.getValue(),
        createdBy: adminSession.email
      })
    });

    const data = await response.json();

    if (data.success) {
      alert('Page saved successfully!');
      loadVersionHistory();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    console.error('Error saving page:', error);
    alert('Failed to save page');
  }
}

function resetCurrentPage() {
  if (confirm('Reset to last saved version?')) {
    loadCurrentPage();
  }
}

function refreshPreview() {
  const frame = document.getElementById('previewFrame');
  const doc = frame.contentDocument || frame.contentWindow.document;

  let html = htmlEditor.getValue();
  const css = cssEditor.getValue();
  const js = jsEditor.getValue();

  if (css) {
    html = html.replace('</head>', `<style>${css}</style></head>`);
  }

  if (js) {
    html = html.replace('</body>', `<script>${js}<\/script></body>`);
  }

  doc.open();
  doc.write(html);
  doc.close();
}

async function loadVersionHistory() {
  try {
    const response = await fetch(`${API_BASE}/api/html-editor/customers/${customerId}/pages/${currentPage}/versions`);
    const data = await response.json();

    const versionList = document.getElementById('versionList');

    if (data.success && data.versions && data.versions.length > 0) {
      versionList.innerHTML = data.versions.map(version => `
        <div class="version-item">
          <div>
            <strong>v${version.version}</strong>
            <div style="font-size: 12px; color: #64748b;">
              ${new Date(version.created_at).toLocaleDateString()}
            </div>
          </div>
          <button class="btn-icon" onclick="rollbackToVersion(${version.version})" title="Rollback">
            <i class="fas fa-undo"></i>
          </button>
        </div>
      `).join('');
    } else {
      versionList.innerHTML = '<p style="color: #94a3b8; font-size: 13px;">No version history</p>';
    }
  } catch (error) {
    console.error('Error loading version history:', error);
  }
}

async function rollbackToVersion(version) {
  if (!confirm(`Rollback to version ${version}?`)) {
    return;
  }

  const adminSession = JSON.parse(localStorage.getItem('admin_session') || 'null');

  try {
    const response = await fetch(`${API_BASE}/api/html-editor/customers/${customerId}/pages/${currentPage}/rollback/${version}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        createdBy: adminSession.email
      })
    });

    const data = await response.json();

    if (data.success) {
      alert('Rollback successful!');
      await loadCurrentPage();
      await loadVersionHistory();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    console.error('Error rolling back:', error);
    alert('Failed to rollback');
  }
}

function openInNewTab() {
  if (customer) {
    const url = `http://${customer.subdomain}.${window.location.host}/${currentPage}.html`;
    window.open(url, '_blank');
  }
}

function showNewPageModal() {
  const pageName = prompt('Enter page name (lowercase, no spaces):');
  if (!pageName) return;

  const cleanName = pageName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const li = document.createElement('li');
  li.className = 'page-item';
  li.dataset.page = cleanName;
  li.innerHTML = `<span>${cleanName}</span>`;
  li.addEventListener('click', () => selectPage(cleanName));

  document.getElementById('pageList').appendChild(li);

  selectPage(cleanName);
}

document.addEventListener('DOMContentLoaded', init);
