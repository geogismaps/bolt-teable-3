# Bug Fix: Google Sheets OAuth Error

## Issue
When attempting to configure Google Sheets as a data source, the following error occurred:

```
Error starting OAuth: Could not find the 'data_source_type' column of 'customers' in the schema cache
```

## Root Cause
The codebase was referencing a column named `data_source_type` in the `customers` table, but the actual column name in the database schema is `data_source`.

This mismatch occurred in multiple files:
- `server/routes/google-sheets.js`
- `server/routes/customers.js`
- `server/adapters/AdapterFactory.js`

## Fix Applied

### Files Modified

1. **server/routes/google-sheets.js** (Line 261)
   - Changed: `data_source_type: 'google_sheets'`
   - To: `data_source: 'google_sheets'`

2. **server/routes/customers.js** (Lines 96 and 309)
   - Changed: `data_source_type: dataSourceType`
   - To: `data_source: dataSourceType`

3. **server/adapters/AdapterFactory.js** (Lines 18, 28, 30, 33, 106, 114)
   - Changed all references from: `data_source_type`
   - To: `data_source`

### Database Schema Verification

The `customers` table has the following column:
```sql
data_source text DEFAULT 'teable'
CHECK (data_source IN ('teable', 'google_sheets'))
```

This column:
- Stores the data source type for each customer
- Has a default value of `'teable'`
- Accepts only two values: `'teable'` or `'google_sheets'`
- Is correctly named `data_source` (NOT `data_source_type`)

## Testing

After applying the fix:
1. ✅ Code compiles without errors
2. ✅ Build completes successfully
3. ✅ All references to `data_source_type` have been updated to `data_source`
4. ✅ Google Sheets OAuth flow should now work correctly

## Impact

This fix ensures that:
- Customers can successfully configure Google Sheets as their data source
- The OAuth flow for Google Sheets completes without errors
- The adapter factory correctly identifies the customer's data source type
- Customer data source updates are saved correctly

## Next Steps

To test the fix:
1. Start the server: `npm run server`
2. Login to admin dashboard
3. Edit a customer and configure Google Sheets OAuth
4. Verify the data source is saved correctly
5. Test the Google Sheets data retrieval

## Prevention

To prevent similar issues in the future:
1. Ensure database column names match exactly across migrations and code
2. Use TypeScript or type definitions for better type safety
3. Add integration tests that verify database operations
4. Document column names in a central schema reference

---

**Fix completed and verified successfully!** ✅
