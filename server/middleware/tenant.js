import { getCustomerBySubdomain, getCustomerByDomain } from '../config/supabase.js';

export async function tenantMiddleware(req, res, next) {
  try {
    const host = req.get('host');

    if (!host) {
      return next();
    }

    const parts = host.split('.');

    let customer = null;

    if (parts.length > 2) {
      const subdomain = parts[0];
      customer = await getCustomerBySubdomain(subdomain);
    }

    if (!customer) {
      customer = await getCustomerByDomain(host);
    }

    if (customer) {
      req.customer = customer;
      req.customerId = customer.id;
    }

    next();
  } catch (error) {
    console.error('Tenant middleware error:', error);
    next();
  }
}
