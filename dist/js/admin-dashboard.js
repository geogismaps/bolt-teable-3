const API_BASE = window.location.origin;

let adminSession = null;
let customers = [];

async function init() {
  adminSession = JSON.parse(localStorage.getItem('admin_session') || 'null');

  if (!adminSession) {
    window.location.href = '/admin-login.html';
    return;
  }

  document.getElementById('adminName').textContent = `${adminSession.firstName} ${adminSession.lastName}`;

  await loadCustomers();
  updateStats();

  document.getElementById('searchInput').addEventListener('input', filterCustomers);
}

async function loadCustomers() {
  try {
    const response = await fetch(`${API_BASE}/api/customers`);
    const data = await response.json();

    if (data.success) {
      customers = data.customers;
      renderCustomers(customers);
    }
  } catch (error) {
    console.error('Error loading customers:', error);
  }
}

function renderCustomers(customersToRender) {
  const tbody = document.getElementById('customersTableBody');

  if (customersToRender.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: #94a3b8;">
          No customers found
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customersToRender.map(customer => `
    <tr>
      <td>
        <strong>${customer.name}</strong>
      </td>
      <td>
        <code>${customer.subdomain}</code>
      </td>
      <td>
        <span class="status-badge status-${customer.status}">
          ${customer.status.toUpperCase()}
        </span>
      </td>
      <td>${customer.subscription_tier}</td>
      <td>${new Date(customer.created_at).toLocaleDateString()}</td>
      <td>
        <div class="action-buttons">
          <button class="btn-small btn-edit" onclick="editCustomer('${customer.id}')">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="btn-small btn-html" onclick="openHTMLEditor('${customer.id}')">
            <i class="fas fa-code"></i> HTML
          </button>
          <button class="btn-small btn-delete" onclick="deleteCustomer('${customer.id}', '${customer.name}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function updateStats() {
  document.getElementById('totalCustomers').textContent = customers.length;

  document.getElementById('activeCustomers').textContent =
    customers.filter(c => c.status === 'active').length;

  document.getElementById('trialCustomers').textContent =
    customers.filter(c => c.status === 'trial').length;

  document.getElementById('totalUsers').textContent =
    customers.reduce((sum, c) => sum + (c.max_users || 0), 0);
}

function filterCustomers() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm) ||
    c.subdomain.toLowerCase().includes(searchTerm)
  );
  renderCustomers(filtered);
}

function showNewCustomerModal() {
  const name = prompt('Customer Name:');
  if (!name) return;

  const subdomain = prompt('Subdomain (lowercase, no spaces):');
  if (!subdomain) return;

  createCustomer(name, subdomain);
}

async function createCustomer(name, subdomain) {
  try {
    const response = await fetch(`${API_BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        subdomain: subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        adminEmail: adminSession.email
      })
    });

    const data = await response.json();

    if (data.success) {
      alert('Customer created successfully!');
      await loadCustomers();
      updateStats();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    console.error('Error creating customer:', error);
    alert('Failed to create customer');
  }
}

function editCustomer(customerId) {
  window.location.href = `/customer-edit.html?id=${customerId}`;
}

function openHTMLEditor(customerId) {
  window.location.href = `/html-editor.html?customerId=${customerId}`;
}

async function deleteCustomer(customerId, customerName) {
  if (!confirm(`Are you sure you want to delete "${customerName}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/customers/${customerId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      alert('Customer deleted successfully');
      await loadCustomers();
      updateStats();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    console.error('Error deleting customer:', error);
    alert('Failed to delete customer');
  }
}

function logout() {
  localStorage.removeItem('admin_session');
  window.location.href = '/admin-login.html';
}

document.addEventListener('DOMContentLoaded', init);
