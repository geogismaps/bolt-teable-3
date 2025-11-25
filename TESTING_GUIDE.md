# GIS System Testing Guide

## Complete Flow Test

### Step 1: Dashboard - Data Source Setup

1. Navigate to `https://mapz.in/` (or your deployment URL)
2. You'll be redirected to `/dashboard.html`
3. Select your data source:
   - **Option A: Teable**
     - Enter Base URL
     - Enter Space ID
     - Enter Base ID
     - Enter Access Token
   - **Option B: Google Sheets**
     - Enter Spreadsheet ID
     - Enter Sheet Name

4. Click **"Validate & Load Tables"**
5. Verify:
   - ✅ Connection validates successfully
   - ✅ List of available tables is displayed
   - ✅ Each table shows name and description

6. Click **"Proceed to Users & Permissions"**

### Step 2: Users & Permissions Setup

1. You should now be on `/users.html`
2. Click **"Add New User"**
3. Fill in user details:
   - Email: `test.viewer@example.com`
   - First Name: `Test`
   - Last Name: `Viewer`
   - Role: `Viewer`

4. Click **"Save User"**
5. Verify:
   - ✅ User appears in the list
   - ✅ Success message is shown

6. Click **"Set Permissions"** for the user
7. For each table, configure field-level permissions:
   - Set some fields to "No Access"
   - Set some fields to "View Only"
   - Set some fields to "View & Edit"

8. Click **"Save Permissions"**
9. Verify:
   - ✅ Success message is shown
   - ✅ Permissions are saved

10. Repeat steps 2-9 to add more users with different roles:
    - Add an Editor: `test.editor@example.com`
    - Add an Admin: `test.admin@example.com`

11. Click **"Proceed to Map"**

### Step 3: Map View - Test Permissions

1. You should now be on `/map.html`
2. At the top of the page, you'll see a user selector dropdown
3. Select a user from the dropdown (e.g., "Test Viewer")
4. Verify:
   - ✅ User selection is saved
   - ✅ Page reloads to apply permissions
   - ✅ User display shows current user email

5. Add a layer from a table:
   - Click on "Add Layer" or similar button
   - Select a table
   - Verify:
     - ✅ Only fields the user can "view" or "edit" are displayed
     - ✅ Fields marked as "No Access" are hidden

6. Try to edit a feature:
   - Click on a feature on the map
   - Try to edit field values
   - Verify:
     - ✅ Fields marked as "View Only" are read-only
     - ✅ Fields marked as "View & Edit" are editable
     - ✅ Fields marked as "No Access" are not visible

7. Switch to a different user:
   - Select another user from the dropdown
   - Wait for page reload
   - Verify:
     - ✅ Different field visibility based on new user's permissions
     - ✅ Different edit capabilities based on new user's permissions

### Step 4: Table View - Test Permissions

1. Navigate to `/table.html`
2. Select a user from the user selector
3. Select a table to view
4. Verify:
   - ✅ Only columns the user can view are shown
   - ✅ Fields marked as "No Access" are hidden
   - ✅ Edit buttons only appear for fields the user can edit

## Database Verification

### Check Supabase Tables

1. Open Supabase Dashboard
2. Navigate to Table Editor

#### customer_users Table
- Verify users were created with correct:
  - customer_id
  - email
  - first_name
  - last_name
  - role

#### user_field_permissions Table
- Verify permissions were created with correct:
  - user_id (references customer_users)
  - table_id
  - field_id
  - permission (none/view/edit)

## Expected Behavior

### Permission Levels

| Permission | Can See Field | Can Edit Field |
|------------|--------------|----------------|
| none       | ❌ No        | ❌ No         |
| view       | ✅ Yes       | ❌ No         |
| edit       | ✅ Yes       | ✅ Yes        |

### Role Defaults

- **Viewer**: Can view most fields, cannot edit
- **Editor**: Can view and edit most fields
- **Admin**: Full access to all fields

## Troubleshooting

### Common Issues

1. **"No tables found"**
   - Go back to dashboard
   - Re-validate data source connection
   - Check credentials

2. **"Failed to load users"**
   - Check browser console for errors
   - Verify Supabase connection
   - Check customer_id in localStorage

3. **"Permissions not applying"**
   - Switch user and reload page
   - Check user_field_permissions table in Supabase
   - Verify user_id matches in both tables

4. **"Cannot add user"**
   - Check Supabase RLS policies
   - Verify customer_id is set in localStorage
   - Check browser console for errors

## Success Criteria

✅ Data source validates and loads tables
✅ Users can be added with roles
✅ Field-level permissions can be configured
✅ Permissions are stored in Supabase
✅ Map respects field-level permissions
✅ Table view respects field-level permissions
✅ Switching users applies different permissions
✅ No errors in browser console
✅ All data persists after page reload

## Test Data

### Sample Customer ID
```
default-customer
```

### Sample Users
```
test.viewer@example.com - Viewer role
test.editor@example.com - Editor role
test.admin@example.com - Admin role
```

### Sample Permissions
- Viewer: View only on most fields
- Editor: Edit access on data fields, view only on system fields
- Admin: Full access to all fields
