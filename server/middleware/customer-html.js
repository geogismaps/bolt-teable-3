import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { getCustomerHTMLCustomization, getCustomerTeableConfig } from '../config/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function serveCustomerHTML(req, res, next) {
  if (!req.customer) {
    return next();
  }

  const requestedPath = req.path;
  let pageName = requestedPath.replace(/^\//, '').replace('.html', '') || 'index';

  if (pageName === '' || pageName === '/') {
    pageName = 'dashboard';
  }

  try {
    const customization = await getCustomerHTMLCustomization(req.customer.id, pageName);

    if (customization && customization.html_content) {
      const teableConfig = await getCustomerTeableConfig(req.customer.id);

      let html = customization.html_content;

      if (customization.css_content) {
        html = html.replace('</head>', `<style>${customization.css_content}</style></head>`);
      }

      if (customization.js_content) {
        html = html.replace('</body>', `<script>${customization.js_content}</script></body>`);
      }

      const customerConfig = {
        name: req.customer.name,
        subdomain: req.customer.subdomain,
        logoUrl: req.customer.logo_url,
        primaryColor: req.customer.primary_color,
        secondaryColor: req.customer.secondary_color,
        settings: req.customer.settings,
        teableConfig: teableConfig ? {
          baseUrl: teableConfig.base_url,
          spaceId: teableConfig.space_id,
          baseId: teableConfig.base_id,
          accessToken: teableConfig.access_token
        } : null
      };

      html = html.replace('</head>', `
        <script>
          window.CUSTOMER_CONFIG = ${JSON.stringify(customerConfig)};
        </script>
      </head>`);

      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    const defaultHTMLPath = path.join(__dirname, '../../public', `${pageName}.html`);
    try {
      let html = readFileSync(defaultHTMLPath, 'utf-8');

      const teableConfig = await getCustomerTeableConfig(req.customer.id);

      const customerConfig = {
        name: req.customer.name,
        subdomain: req.customer.subdomain,
        logoUrl: req.customer.logo_url,
        primaryColor: req.customer.primary_color,
        secondaryColor: req.customer.secondary_color,
        settings: req.customer.settings,
        teableConfig: teableConfig ? {
          baseUrl: teableConfig.base_url,
          spaceId: teableConfig.space_id,
          baseId: teableConfig.base_id,
          accessToken: teableConfig.access_token
        } : null
      };

      html = html.replace('</head>', `
        <script>
          window.CUSTOMER_CONFIG = ${JSON.stringify(customerConfig)};
        </script>
      </head>`);

      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (fileError) {
      return next();
    }
  } catch (error) {
    console.error('Error serving customer HTML:', error);
    return next();
  }
}
