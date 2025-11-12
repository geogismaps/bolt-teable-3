# Google OAuth Setup Guide

## Overview
The Google OAuth integration for Google Sheets is now ready to use! When you click the "Connect Google Account" button in the Super Admin portal, it will:

1. Create a customer record in the database
2. Open a Google OAuth window for authentication
3. Store the encrypted OAuth tokens in your Supabase database
4. Allow you to select spreadsheets and configure field mappings

## Important: Environment Variables Are Already Configured

**Good news!** The required environment variables are automatically configured in your Supabase project:

- ✅ `GOOGLE_CLIENT_ID` - Already set
- ✅ `GOOGLE_CLIENT_SECRET` - Already set
- ✅ `GOOGLE_REDIRECT_URI` - Already set to `https://mapz.in/api/auth/google/callback`
- ✅ `ENCRYPTION_KEY` - Already set for secure token storage

These variables are managed by Supabase and are available to all Edge Functions automatically.

## Testing the OAuth Configuration

To verify that Google OAuth is properly configured, you can test the endpoint:

```bash
curl https://prnfolxusxppqwukwasx.supabase.co/functions/v1/google-oauth/test
```

Expected response:
```json
{
  "success": true,
  "message": "Google OAuth router is working",
  "timestamp": "2025-01-12T...",
  "configured": true,
  "environment": {
    "GOOGLE_CLIENT_ID": "SET",
    "GOOGLE_CLIENT_SECRET": "SET",
    "GOOGLE_REDIRECT_URI": "SET",
    "ENCRYPTION_KEY": "SET"
  }
}
```

If `configured` is `true`, you're all set!

## How to Use Google Sheets OAuth

### Step 1: Navigate to Super Admin Portal
1. Open your application at `/super-admin.html`
2. Fill in the client configuration form:
   - Client Name (e.g., "Acme Corporation")
   - Owner Email (e.g., "admin@acme.com")
   - Owner Password (secure password)

### Step 2: Select Google Sheets as Data Source
1. Click the "Google Sheets" option in the Data Source section
2. The form will show Google Sheets configuration options

### Step 3: Connect Google Account
1. Click the "Connect Google Account" button
2. You'll be redirected to Google's OAuth consent screen
3. Sign in with your Google account
4. Grant permissions for:
   - View and manage your spreadsheets
   - View your Google Drive files
   - View your email address

### Step 4: Configure Spreadsheet Mapping
After successful authentication:
1. Select a spreadsheet from your Google Drive
2. Select the sheet/tab within the spreadsheet
3. Click "Auto-Detect Fields" or manually map columns:
   - Geometry Column (for WKT geometry data)
   - ID Column (unique identifier)
   - Name Column (parcel name/label)
   - Latitude/Longitude Columns (optional, if using lat/lng instead of geometry)

### Step 5: Complete Setup
1. Review the configuration
2. Click "Create Client" to finalize
3. The system will create the customer and admin user account

## OAuth Flow Details

### What Happens During OAuth?

1. **Customer Creation**: A customer record is created in the database with `data_source: 'google_sheets'`

2. **OAuth Initiation**: The system generates a secure state token and stores it temporarily in the `google_oauth_state` table

3. **Google Authentication**: User is redirected to Google's OAuth consent screen

4. **Token Exchange**: Google returns an authorization code, which is exchanged for:
   - Access Token (expires in 1 hour)
   - Refresh Token (long-lived, used to get new access tokens)

5. **Token Storage**: Tokens are encrypted using AES-256-GCM and stored in `customer_google_sheets_config`

6. **User Creation**: Admin user account is created with the specified email and password

### Security Features

- **Encryption**: All OAuth tokens are encrypted before storage using PBKDF2 + AES-GCM
- **State Validation**: CSRF protection using state tokens that expire after 10 minutes
- **Secure Storage**: Tokens are stored in Supabase with Row Level Security enabled
- **Automatic Refresh**: Access tokens are automatically refreshed when expired

## Troubleshooting

### "Google OAuth is not configured on the server"

This means one or more environment variables are missing. Test the configuration endpoint:
```bash
curl https://prnfolxusxppqwukwasx.supabase.co/functions/v1/google-oauth/test
```

Check which variables show as "MISSING" in the response.

### OAuth Redirect Issues

If you're redirected to an error page after authenticating with Google:

1. Verify the redirect URI in your Google Cloud Console matches: `https://mapz.in/api/auth/google/callback`
2. Check that the callback endpoint is working
3. Look for errors in the Supabase Edge Function logs

### Token Expiration

Access tokens expire after 1 hour. The system automatically:
- Checks token expiration before API calls
- Uses the refresh token to get a new access token
- Updates the stored tokens in the database

## System Architecture

```
User Browser
    ↓
Super Admin Portal (Frontend)
    ↓
Supabase Edge Function: google-oauth/start
    ↓
Google OAuth Consent Screen
    ↓
Google OAuth Callback → Supabase Edge Function: google-oauth/callback
    ↓
Token Storage (Encrypted) → customer_google_sheets_config table
    ↓
Spreadsheet Access → Google Sheets API
    ↓
GIS Application (Map Display)
```

## Next Steps

After OAuth is configured:
1. Your customer can now use Google Sheets as their parcel data source
2. The system will automatically sync data from the configured spreadsheet
3. Updates to the spreadsheet will be reflected in the GIS map
4. Admin users can manage permissions and access through the dashboard

## Support

If you encounter any issues:
1. Check the Supabase Edge Function logs
2. Test the OAuth endpoint using the curl command above
3. Verify your Google Cloud Console configuration
4. Ensure the spreadsheet has the correct column structure

---

**Status**: ✅ Google OAuth is fully configured and ready to use!
