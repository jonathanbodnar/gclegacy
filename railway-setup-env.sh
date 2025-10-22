#!/bin/bash

# Railway Environment Setup for PlanTakeoff API
# Run this script to set all required environment variables

echo "🚀 Setting up Railway environment variables for PlanTakeoff API..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
    echo "Please run 'railway login' first, then run this script again."
    exit 1
fi

# Core Application Variables
echo "⚙️ Setting core application variables..."
railway variables set NODE_ENV=production
railway variables set API_PREFIX=v1
railway variables set LOG_LEVEL=info
railway variables set PORT=3000

# JWT Configuration
echo "🔐 Setting JWT configuration..."
JWT_SECRET=$(openssl rand -base64 32)
railway variables set JWT_SECRET="$JWT_SECRET"
railway variables set JWT_EXPIRES_IN=24h

# OAuth Demo Credentials (change these for production)
echo "🔑 Setting OAuth demo credentials..."
OAUTH_CLIENT_SECRET=$(openssl rand -base64 32)
railway variables set OAUTH_CLIENT_ID=demo-client
railway variables set OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET"

# Rate Limiting
echo "🚦 Setting rate limiting..."
railway variables set RATE_LIMIT_TTL=60
railway variables set RATE_LIMIT_MAX=100

# File Upload Configuration
echo "📁 Setting file upload limits..."
railway variables set MAX_FILE_SIZE=104857600
railway variables set SUPPORTED_MIME_TYPES="application/pdf,image/vnd.dwg,application/vnd.dwg,model/vnd.ifc"

# Webhook Configuration
echo "🔔 Setting webhook configuration..."
WEBHOOK_SECRET=$(openssl rand -base64 32)
railway variables set WEBHOOK_SECRET="$WEBHOOK_SECRET"
railway variables set WEBHOOK_TIMEOUT=30000
railway variables set WEBHOOK_RETRIES=3

# CORS Configuration
echo "🌐 Setting CORS configuration..."
railway variables set CORS_ORIGIN="*"

echo ""
echo "✅ Core environment variables set successfully!"
echo ""
echo "🔧 MANUAL SETUP REQUIRED:"
echo "You still need to set these Wasabi storage variables manually:"
echo ""
echo "railway variables set WASABI_ENDPOINT=https://s3.wasabisys.com"
echo "railway variables set WASABI_REGION=us-east-1"
echo "railway variables set WASABI_ACCESS_KEY_ID=your-wasabi-access-key"
echo "railway variables set WASABI_SECRET_ACCESS_KEY=your-wasabi-secret-key"
echo "railway variables set WASABI_BUCKET_NAME=your-bucket-name"
echo ""
echo "📝 Your OAuth credentials for testing:"
echo "Client ID: demo-client"
echo "Client Secret: $OAUTH_CLIENT_SECRET"
echo ""
echo "🚀 After setting AWS variables, redeploy with:"
echo "railway up"
