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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Multi-tenant GIS Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
