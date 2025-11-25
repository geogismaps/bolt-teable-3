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
      try {
        customer = await getCustomerBySubdomain(subdomain);
      } catch (subdomainError) {
        console.error('Error fetching customer by subdomain:', subdomainError);
      }
    }

    if (!customer) {
      try {
        customer = await getCustomerByDomain(host);
      } catch (domainError) {
        console.error('Error fetching customer by domain:', domainError);
      }
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
