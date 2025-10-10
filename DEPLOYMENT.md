# Deployment Guide - Multi-Tenant GIS System

This guide walks you through deploying the multi-tenant GIS system from development to production.

## Overview

**Deployment Strategy:**
1. Phase 1: Test on Bolt.new with first 10 customers
2. Phase 2: Migrate to Linode for production
3. Phase 3: Use GitHub Actions for automated deployments

---

## Phase 1: Bolt.new Deployment (Testing)

### Prerequisites
- Bolt.new account
- Custom domain configured
- Supabase database already set up

### Steps

1. **Push Code to GitHub**

```bash
git add .
git commit -m "Initial multi-tenant GIS system"
git remote add origin https://github.com/yourusername/teable-gis-system.git
git push -u origin main
```

2. **Configure Bolt.new**

- Link your GitHub repository to Bolt.new
- Add environment variables in Bolt settings:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `PORT=3000`
  - `NODE_ENV=production`

3. **Configure Custom Domain**

In your DNS provider:

```dns
Type    Name    Value
A       @       75.2.60.5
A       *       75.2.60.5
CNAME   www     site-dns.bolt.host
```

This enables wildcard subdomains like `customer1.mapz.in`

4. **Deploy**

- Bolt.new will automatically deploy when you push to `main` branch
- Server will be available at your custom domain

5. **Create First Admin Account**

- Navigate to `http://mapz.in/admin-register.html`
- Create your super admin account
- Login at `http://mapz.in/admin-login.html`

6. **Test with 10 Customers**

Create test customers and gather feedback:

```bash
# Example subdomains:
customer1.mapz.in
customer2.mapz.in
...
customer10.mapz.in
```

---

## Phase 2: Linode Production Deployment

### Prerequisites
- Linode account
- Domain name configured
- SSH access to Linode server

### 1. Server Setup

**Create Linode Instance:**
- Distribution: Ubuntu 22.04 LTS
- Plan: Shared CPU 4GB ($24/month minimum)
- Region: Choose closest to your users
- Add SSH key for secure access

**Connect to Server:**
```bash
ssh root@<your-linode-ip>
```

### 2. Install Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install Nginx
apt install -y nginx

# Install PM2 globally
npm install -g pm2

# Install Git
apt install -y git

# Install Certbot for SSL
apt install -y certbot python3-certbot-nginx
```

### 3. Clone Repository

```bash
# Create directory
mkdir -p /var/www
cd /var/www

# Clone your repository
git clone https://github.com/yourusername/teable-gis-system.git
cd teable-gis-system

# Install dependencies
npm install --production
```

### 4. Configure Environment Variables

```bash
nano /var/www/teable-gis-system/.env
```

Add:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
PORT=3000
NODE_ENV=production
```

### 5. Build the Application

```bash
npm run build
```

### 6. Configure Nginx

```bash
nano /etc/nginx/sites-available/teable-gis
```

Add configuration:
```nginx
server {
    listen 80;
    server_name mapz.in *.mapz.in;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
ln -s /etc/nginx/sites-available/teable-gis /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 7. Start Application with PM2

```bash
cd /var/www/teable-gis-system
pm2 start server/index.js --name teable-gis
pm2 save
pm2 startup
```

### 8. Configure SSL with Let's Encrypt

```bash
certbot --nginx -d mapz.in -d *.mapz.in
```

Follow prompts to obtain SSL certificates.

### 9. Configure Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 10. Update DNS

Point your domain to Linode server:

```dns
Type    Name    Value
A       @       <linode-ip>
A       *       <linode-ip>
CNAME   www     mapz.in
```

---

## Phase 3: GitHub Actions Automated Deployment

### 1. Setup GitHub Secrets

In your GitHub repository, go to Settings → Secrets and variables → Actions

Add the following secrets:
- `LINODE_HOST` - Your Linode server IP
- `LINODE_USERNAME` - SSH username (usually `root`)
- `LINODE_SSH_KEY` - Your private SSH key

### 2. GitHub Actions Workflow

The workflow file is already created at `.github/workflows/deploy.yml`

It will automatically:
- Run on every push to `main` branch
- Install dependencies
- Build the project
- Deploy to Linode
- Restart the server with PM2

### 3. Deploy by Pushing to Main

```bash
git add .
git commit -m "Feature: Add customer dashboard"
git push origin main
```

GitHub Actions will automatically deploy to Linode!

---

## Post-Deployment

### Verify Deployment

1. **Check server status:**
```bash
pm2 status
pm2 logs teable-gis
```

2. **Test main domain:**
```bash
curl https://mapz.in
```

3. **Test subdomain:**
```bash
curl https://customer1.mapz.in
```

4. **Check Nginx:**
```bash
systemctl status nginx
nginx -t
```

### Monitoring

**PM2 Monitoring:**
```bash
pm2 monit
```

**View Logs:**
```bash
pm2 logs teable-gis
pm2 logs teable-gis --lines 100
```

**Server Resources:**
```bash
htop
df -h
```

### Backup Strategy

**Database Backups:**
- Supabase automatically backs up your database
- Configure point-in-time recovery in Supabase dashboard

**Code Backups:**
- Git repository serves as version control
- Consider setting up automated GitHub backups

**Server Backups:**
- Use Linode Backup service (additional cost)
- Or set up automated snapshots

---

## Rollback Procedure

### Quick Rollback

If a deployment causes issues:

```bash
# SSH to server
ssh root@<linode-ip>

# Navigate to project
cd /var/www/teable-gis-system

# Rollback to previous commit
git log --oneline  # Find previous commit hash
git reset --hard <previous-commit-hash>

# Reinstall dependencies
npm install --production

# Rebuild
npm run build

# Restart
pm2 restart teable-gis
```

### Database Rollback

Use Supabase dashboard to restore from backup if needed.

---

## Scaling Considerations

### When to Scale

Monitor these metrics:
- Server CPU > 80% consistently
- Memory usage > 80%
- Response times > 500ms
- More than 50 active customers

### Scaling Options

1. **Vertical Scaling (Easier)**
   - Upgrade Linode plan
   - More CPU/RAM for same server

2. **Horizontal Scaling (Better for growth)**
   - Add load balancer
   - Multiple application servers
   - Separate database server
   - CDN for static assets

3. **Database Scaling**
   - Upgrade Supabase plan
   - Connection pooling
   - Read replicas

---

## Troubleshooting

### Server Won't Start

```bash
# Check logs
pm2 logs teable-gis --lines 50

# Check port availability
netstat -tulpn | grep 3000

# Restart manually
pm2 restart teable-gis
```

### Subdomain Not Working

```bash
# Check DNS propagation
dig customer1.mapz.in

# Check Nginx config
nginx -t

# Check logs
tail -f /var/log/nginx/error.log
```

### Database Connection Issues

```bash
# Test Supabase connection
curl -H "Authorization: Bearer YOUR_ANON_KEY" \
  https://your-project.supabase.co/rest/v1/customers

# Check environment variables
cat /var/www/teable-gis-system/.env
```

### SSL Certificate Issues

```bash
# Renew certificates
certbot renew

# Test SSL
curl -I https://yourdomain.com
```

---

## Maintenance

### Regular Tasks

**Weekly:**
- Check error logs
- Monitor customer usage metrics
- Review system performance

**Monthly:**
- Update dependencies (test first!)
- Review and archive old logs
- Check SSL certificate expiration
- Backup verification

**Quarterly:**
- Security audit
- Performance optimization
- Cost review
- Customer feedback review

### Updates

```bash
# Update system packages
apt update && apt upgrade -y

# Update Node dependencies (test first!)
npm outdated
npm update

# Restart after updates
pm2 restart teable-gis
```

---

## Support Contacts

- **Linode Support**: https://www.linode.com/support
- **Supabase Support**: https://supabase.com/support
- **GitHub Support**: https://support.github.com

---

## Success Checklist

### Phase 1 Complete
- [ ] Code pushed to GitHub
- [ ] Deployed on Bolt.new
- [ ] Custom domain configured
- [ ] Admin account created
- [ ] 10 test customers onboarded
- [ ] Feedback collected

### Phase 2 Complete
- [ ] Linode server provisioned
- [ ] Application deployed
- [ ] Nginx configured
- [ ] SSL certificates installed
- [ ] DNS updated
- [ ] PM2 running stable
- [ ] Customers migrated from Bolt

### Phase 3 Complete
- [ ] GitHub Actions configured
- [ ] Automated deployments working
- [ ] Monitoring in place
- [ ] Backup strategy implemented
- [ ] Documentation updated
- [ ] Team trained

---

**Current Status:** Phase 1 - Ready for Bolt.new deployment and testing

**Next Steps:**
1. Push code to GitHub
2. Deploy on Bolt.new
3. Create admin account
4. Onboard first customer
5. Customize their HTML
6. Test subdomain routing
7. Gather feedback from 10 customers
8. Iterate and improve
9. Plan Linode migration
