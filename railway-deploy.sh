#!/bin/bash

# Railway deployment script for PlanTakeoff API

echo "🚀 Starting Railway deployment for PlanTakeoff API..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Login to Railway (if not already logged in)
echo "🔐 Checking Railway authentication..."
if ! railway whoami &> /dev/null; then
    echo "Please login to Railway:"
    railway login
fi

# Create new Railway project
echo "📦 Creating Railway project..."
railway login
railway init

# Add PostgreSQL database
echo "🗄️ Adding PostgreSQL database..."
railway add --database postgresql

# Add Redis
echo "🔴 Adding Redis..."
railway add --database redis

# Set environment variables
echo "⚙️ Setting environment variables..."

# Core application variables
railway variables set NODE_ENV=production
railway variables set API_PREFIX=v1
railway variables set LOG_LEVEL=info

# JWT Configuration
railway variables set JWT_SECRET=$(openssl rand -base64 32)
railway variables set JWT_EXPIRES_IN=24h

# Rate limiting
railway variables set RATE_LIMIT_TTL=60
railway variables set RATE_LIMIT_MAX=100

# File upload limits
railway variables set MAX_FILE_SIZE=104857600
railway variables set SUPPORTED_MIME_TYPES="application/pdf,image/vnd.dwg,application/vnd.dwg,model/vnd.ifc"

# Webhook configuration
railway variables set WEBHOOK_TIMEOUT=30000
railway variables set WEBHOOK_RETRIES=3
railway variables set WEBHOOK_SECRET=$(openssl rand -base64 32)

# OAuth demo credentials (change these in production)
railway variables set OAUTH_CLIENT_ID=demo-client
railway variables set OAUTH_CLIENT_SECRET=$(openssl rand -base64 32)

echo "🌐 Environment variables set. Please manually configure:"
echo "  - AWS_REGION (your S3 region)"
echo "  - AWS_ACCESS_KEY_ID (your AWS access key)"
echo "  - AWS_SECRET_ACCESS_KEY (your AWS secret key)" 
echo "  - S3_BUCKET_NAME (your S3 bucket name)"
echo ""
echo "You can set these with:"
echo "  railway variables set AWS_REGION=us-east-1"
echo "  railway variables set AWS_ACCESS_KEY_ID=your-key"
echo "  railway variables set AWS_SECRET_ACCESS_KEY=your-secret"
echo "  railway variables set S3_BUCKET_NAME=your-bucket"

# Deploy the application
echo "🚀 Deploying to Railway..."
railway up

echo "✅ Deployment initiated! Check your Railway dashboard for progress."
echo "📊 Dashboard: https://railway.app/dashboard"
echo ""
echo "After deployment completes:"
echo "1. Run database migrations: railway run npm run db:push"
echo "2. Seed the database: railway run npm run seed"
echo "3. Your API will be available at your Railway domain"
echo ""
echo "🔗 Get your domain with: railway domain"
