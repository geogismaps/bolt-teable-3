# Google Sheets Integration Setup Guide

## Overview

Your Teable GIS System now supports both **Teable** and **Google Sheets** as data sources. This allows customers to choose where their parcel/land data is stored, while all system data (users, permissions, logs) remains in Supabase.

## Architecture

- **System Database (Supabase)**: Stores users, permissions, customers, activity logs
- **Data Sources**:
  - **Teable**: Original data source for parcel data
  - **Google Sheets**: New option for parcel data storage
- **Unified API**: Same GeoJSON API works with both data sources
- **UI**: Existing UI works with both sources transparently

## Setup Instructions

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google Sheets API
   - Google Drive API

### 2. Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client ID**
3. If prompted, configure the OAuth consent screen:
   - User Type: External
   - App name: Your GIS System Name
   - Support email: Your email
   - Developer contact: Your email
4. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: GIS System OAuth Client
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback` (for development)
     - `https://yourdomain.com/api/auth/google/callback` (for production)
5. **Save the Client ID and Client Secret**

### 3. Update Environment Variables

Edit your `.env` file and update these values:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_actual_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_actual_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# Encryption Key (generate a random 32-character string)
ENCRYPTION_KEY=generate_a_random_32_char_key_here
```

**To generate a secure encryption key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run Database Migration

Apply the Google Sheets migration to your Supabase database:

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `supabase/migrations/20251111201054_add_google_sheets_support.sql`
4. Paste and run the migration

This creates:
- `customer_google_sheets_config` table
- `google_oauth_state` table
- Adds `data_source_type` column to `customers` table

### 5. Test the Setup

1. Start your server:
   ```bash
   npm run server
   ```

2. Open `http://localhost:3000/super-admin.html`

3. Create a new client:
   - Fill in Client Name and Owner Email
   - Select **Google Sheets** as data source
   - Click **Connect Google Account**
   - Complete OAuth flow
   - Select a spreadsheet and sheet
   - Click **Auto-Detect Fields** to map columns
   - Preview data to verify
   - Create the client

## Using Google Sheets as Data Source

### Spreadsheet Requirements

Your Google Sheet should have:
- A header row (first row) with column names
- A geometry column containing:
  - WKT format (e.g., `POINT(-122.4194 37.7749)`)
  - Or separate latitude and longitude columns
- An ID column for unique record identification
- A name/label column for display

### Example Sheet Structure

| ID | Name | Latitude | Longitude | Description |
|----|------|----------|-----------|-------------|
| 1  | Plot A | 37.7749 | -122.4194 | Residential |
| 2  | Plot B | 37.7849 | -122.4094 | Commercial |

Or with WKT:

| ID | Name | Geometry | Description |
|----|------|----------|-------------|
| 1  | Plot A | POINT(-122.4194 37.7749) | Residential |
| 2  | Plot B | POLYGON((...)) | Commercial |

### Field Mapping

The system automatically detects:
- **Geometry Column**: Columns containing WKT strings or named "geometry"
- **ID Column**: Columns named "id", "objectid", or the first column
- **Name Column**: Columns containing "name", "title", or "label"
- **Lat/Lng Columns**: Columns named "latitude"/"longitude" or "lat"/"lng"

You can manually adjust these mappings before creating the client.

## API Usage

### Fetching Records

The unified API works identically for both data sources:

```javascript
// Fetch records from any data source
fetch(`/api/data/${customerId}/records`)
  .then(res => res.json())
  .then(geojson => {
    // GeoJSON FeatureCollection
    console.log(geojson.features);
    console.log(geojson.dataSource); // "teable" or "google_sheets"
  });
```

### Creating Records

```javascript
const feature = {
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [-122.4194, 37.7749]
  },
  properties: {
    name: 'New Plot',
    description: 'A new parcel'
  }
};

fetch(`/api/data/${customerId}/records`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(feature)
});
```

### Updating Records

```javascript
fetch(`/api/data/${customerId}/records/${recordId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(updatedFeature)
});
```

## Security Notes

1. **OAuth Tokens**: Access and refresh tokens are encrypted before storage using AES-256-GCM
2. **Token Refresh**: Access tokens auto-refresh when expired
3. **RLS Policies**: Only system admins can access Google Sheets configurations
4. **State Tokens**: OAuth state tokens expire after 15 minutes

## Troubleshooting

### OAuth Redirect Error

**Problem**: "Redirect URI mismatch" error

**Solution**:
- Verify `GOOGLE_REDIRECT_URI` in `.env` matches exactly what's in Google Cloud Console
- Include protocol (http/https) and port if needed
- No trailing slashes

### Connection Failed

**Problem**: "Failed to connect to Google Sheets"

**Solution**:
- Verify OAuth tokens are not expired
- Check spreadsheet is shared with the OAuth email
- Ensure Google Sheets API is enabled

### Field Detection Issues

**Problem**: Auto-detect doesn't find geometry column

**Solution**:
- Manually select the correct column
- Ensure geometry data is in WKT format or use lat/lng columns
- Check for typos in column headers

### Rate Limiting

**Problem**: "Too many requests" error

**Solution**:
- Google Sheets API has limits: 100 requests per 100 seconds
- The adapter includes caching (30 second cache duration)
- Consider batching operations

## Performance Considerations

1. **Caching**: Google Sheets data is cached for 30 seconds to reduce API calls
2. **Batch Operations**: Use batch endpoints when updating multiple records
3. **Rate Limits**: Google Sheets has stricter rate limits than Teable
4. **Large Datasets**: For datasets >10,000 rows, Teable is recommended

## Migration Between Data Sources

If you need to move a customer from one data source to another:

1. Export data from current source
2. Import data into new source
3. Update customer configuration in super-admin
4. Test data loading
5. Update `data_source_type` in database

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify environment variables are set correctly
3. Test OAuth flow in incognito mode
4. Check Supabase logs for database errors
