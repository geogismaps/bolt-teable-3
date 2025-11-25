/**
 * Data Source Indicator Component
 * Displays the current data source (Teable or Google Sheets) in page headers
 */

class DataSourceIndicator {
  constructor() {
    this.dataSource = null;
    this.customerId = null;
  }

  async initialize() {
    try {
      const session = this.getSession();
      if (!session || !session.customerId) {
        return;
      }

      this.customerId = session.customerId;
      this.dataSource = await this.fetchDataSource();
      this.render();
    } catch (error) {
      console.error('Error initializing data source indicator:', error);
    }
  }

  async fetchDataSource() {
    try {
      const response = await fetch(`${window.location.origin}/api/customers/${this.customerId}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch customer data');
      }

      const data = await response.json();
      return data.customer?.data_source || 'teable';
    } catch (error) {
      console.error('Error fetching data source:', error);
      return 'teable';
    }
  }

  render() {
    const containers = document.querySelectorAll('[data-data-source-indicator]');

    containers.forEach(container => {
      const icon = this.getIcon();
      const name = this.getName();
      const badgeClass = this.getBadgeClass();

      container.innerHTML = `
        <div class="data-source-badge ${badgeClass}">
          ${icon}
          <span class="ms-2">${name}</span>
        </div>
      `;
    });
  }

  getIcon() {
    return this.dataSource === 'google_sheets'
      ? '<i class="fab fa-google"></i>'
      : '<i class="fas fa-database"></i>';
  }

  getName() {
    return this.dataSource === 'google_sheets' ? 'Google Sheets' : 'Teable';
  }

  getBadgeClass() {
    return this.dataSource === 'google_sheets' ? 'badge-google' : 'badge-teable';
  }

  getSession() {
    const sessionStr = localStorage.getItem('customer_session');
    return sessionStr ? JSON.parse(sessionStr) : null;
  }

  static addStyles() {
    const styleId = 'data-source-indicator-styles';
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .data-source-badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
      }

      .data-source-badge.badge-teable {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
      }

      .data-source-badge.badge-google {
        background: linear-gradient(135deg, #4285f4 0%, #34a853 100%);
        color: white;
        box-shadow: 0 2px 8px rgba(66, 133, 244, 0.3);
      }

      .data-source-badge i {
        font-size: 14px;
      }

      .data-source-badge:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
    `;
    document.head.appendChild(style);
  }
}

window.DataSourceIndicator = DataSourceIndicator;

DataSourceIndicator.addStyles();

document.addEventListener('DOMContentLoaded', async () => {
  const indicator = new DataSourceIndicator();
  await indicator.initialize();
});
