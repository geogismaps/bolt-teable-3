import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { customerRouter } from './routes/customers.js';
import { htmlEditorRouter } from './routes/html-editor.js';
import { authRouter } from './routes/auth.js';
import { dataRouter } from './routes/data.js';
import { googleOAuthRouter } from './routes/google-oauth.js';
import { googleSheetsRouter } from './routes/google-sheets.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { serveCustomerHTML } from './middleware/customer-html.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function validateEnvironment() {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'ENCRYPTION_KEY'
  ];

  const optional = {
    'GOOGLE_CLIENT_ID': 'Google OAuth',
    'GOOGLE_CLIENT_SECRET': 'Google OAuth',
    'GOOGLE_REDIRECT_URI': 'Google OAuth'
  };

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  const missingOptional = Object.keys(optional).filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn('⚠️  Optional features disabled - missing environment variables:');
    missingOptional.forEach(key => {
      console.warn(`   - ${key} (${optional[key]} will not work)`);
    });
  }

  const hasGoogleOAuth = process.env.GOOGLE_CLIENT_ID &&
                         process.env.GOOGLE_CLIENT_SECRET &&
                         process.env.GOOGLE_REDIRECT_URI;

  return {
    googleOAuthEnabled: hasGoogleOAuth
  };
}

const config = validateEnvironment();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(tenantMiddleware);

app.use('/api/auth/google', googleOAuthRouter);
app.use('/api/google-sheets', googleSheetsRouter);
app.use('/api/auth', authRouter);
app.use('/api/customers', customerRouter);
app.use('/api/html-editor', htmlEditorRouter);
app.use('/api/data', dataRouter);

app.use(serveCustomerHTML);

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    features: {
      googleOAuth: config.googleOAuthEnabled
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Multi-tenant GIS Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Google OAuth: ${config.googleOAuthEnabled ? 'ENABLED' : 'DISABLED'}`);
  if (config.googleOAuthEnabled) {
    console.log(`   Redirect URI: ${process.env.GOOGLE_REDIRECT_URI}`);
  }
});
