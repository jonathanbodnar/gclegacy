# Railway PostGIS Setup Guide

## Problem
Railway's managed PostgreSQL service (created via `railway add --database postgresql`) does **not** include PostGIS extensions. This application requires PostGIS for geospatial features.

## Solution

You have two options:

### Option 1: Use the Container Service (Recommended)

The `railway.toml` file is already configured to use a PostGIS-enabled PostgreSQL container. However, if you have a managed PostgreSQL service, you need to:

1. **Remove the managed PostgreSQL service:**
   - Go to your Railway project dashboard
   - Find the managed PostgreSQL service (usually named "PostgreSQL" or "postgres")
   - Delete/Remove it

2. **Ensure the container service is used:**
   - The `railway.toml` already defines a PostGIS container service
   - Railway will automatically link services and set `DATABASE_URL`
   - Redeploy your application

3. **Verify the connection:**
   - After deployment, check that `DATABASE_URL` points to the container service
   - The container service will be accessible via the service name "postgres"

### Option 2: Use Railway's PostGIS Template

1. **Deploy Railway's PostGIS template:**
   - Visit: https://railway.com/template/postgis
   - Click "Deploy Now"
   - This creates a PostgreSQL service with PostGIS pre-installed

2. **Link to your application:**
   - In your Railway project, link the PostGIS service to your backend service
   - Railway will automatically set the `DATABASE_URL` environment variable

3. **Update your application:**
   - Ensure your `DATABASE_URL` points to the PostGIS service
   - Redeploy your application

## Verification

After setup, your application should:
- Successfully connect to the database
- Enable PostGIS extension without errors
- Log: "✅ PostGIS extension enabled"

If you still see PostGIS errors, check:
1. That no managed PostgreSQL service exists in your Railway project
2. That `DATABASE_URL` points to the PostGIS container service
3. That the container service is running and healthy

## Troubleshooting

### Error: "extension postgis is not available"

This means you're still connected to a managed PostgreSQL service. Solution:
1. Remove any managed PostgreSQL services
2. Ensure only the container service from `railway.toml` is used
3. Redeploy

### Error: "Could not open extension control file"

This confirms you're using a PostgreSQL instance without PostGIS. Follow Option 1 or Option 2 above.

