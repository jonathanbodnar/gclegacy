# Railway Deployment Guide

## Quick Deploy to Railway

### Option 1: One-Click Deploy (Recommended)

1. **Click the Railway Deploy Button:**
   [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

### Option 2: Manual Deployment

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway:**
   ```bash
   railway login
   ```

3. **Clone and Deploy:**
   ```bash
   git clone git@github.com:jonathanbodnar/gclegacy.git
   cd gclegacy
   railway init
   ```

4. **Add Services:**
   ```bash
   # Add PostgreSQL database
   railway add --database postgresql
   
   # Add Redis
   railway add --database redis
   ```

5. **Set Environment Variables:**
   ```bash
   # Core app settings
   railway variables set NODE_ENV=production
   railway variables set JWT_SECRET=$(openssl rand -base64 32)
   railway variables set WEBHOOK_SECRET=$(openssl rand -base64 32)
   
   # OAuth demo credentials
   railway variables set OAUTH_CLIENT_ID=demo-client
   railway variables set OAUTH_CLIENT_SECRET=$(openssl rand -base64 32)
   
   # AWS S3 (replace with your values)
   railway variables set AWS_REGION=us-east-1
   railway variables set AWS_ACCESS_KEY_ID=your-access-key
   railway variables set AWS_SECRET_ACCESS_KEY=your-secret-key
   railway variables set S3_BUCKET_NAME=your-bucket-name
   ```

6. **Deploy:**
   ```bash
   railway up
   ```

7. **Initialize Database:**
   ```bash
   # After first deployment completes
   railway run npm run db:push
   railway run npm run seed
   ```

8. **Get Your API URL:**
   ```bash
   railway domain
   ```

## Post-Deployment Setup

### 1. Test the API

```bash
# Get your Railway domain
RAILWAY_DOMAIN=$(railway domain)

# Test health endpoint
curl https://$RAILWAY_DOMAIN/health

# Get access token
curl -X POST https://$RAILWAY_DOMAIN/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "demo-client",
    "client_secret": "your-oauth-secret"
  }'
```

### 2. Set Up S3 Bucket

1. Create an S3 bucket in AWS
2. Create IAM user with S3 permissions
3. Update Railway environment variables with your AWS credentials

### 3. Configure Webhooks (Optional)

Set up webhook endpoints to receive job completion notifications:

```bash
curl -X POST https://$RAILWAY_DOMAIN/v1/webhooks/test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.com/webhooks/plantakeoff"}'
```

## Environment Variables Reference

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection | ✅ | Auto-set by Railway |
| `REDIS_HOST` | Redis host | ✅ | Auto-set by Railway |
| `JWT_SECRET` | JWT signing secret | ✅ | Generate with openssl |
| `AWS_REGION` | S3 region | ✅ | us-east-1 |
| `AWS_ACCESS_KEY_ID` | AWS access key | ✅ | Your AWS key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret | ✅ | Your AWS secret |
| `S3_BUCKET_NAME` | S3 bucket name | ✅ | Your bucket |
| `OAUTH_CLIENT_ID` | OAuth client ID | ✅ | demo-client |
| `OAUTH_CLIENT_SECRET` | OAuth secret | ✅ | Generate with openssl |
| `WEBHOOK_SECRET` | Webhook signing secret | ❌ | Generate with openssl |
| `NODE_ENV` | Environment | ❌ | production |
| `LOG_LEVEL` | Logging level | ❌ | info |

## API Usage Examples

### 1. Upload a Plan File

```bash
curl -X POST https://$RAILWAY_DOMAIN/v1/files \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@plan.pdf" \
  -F "projectId=proj_123"
```

### 2. Start Analysis Job

```bash
curl -X POST https://$RAILWAY_DOMAIN/v1/jobs \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "file_abc123",
    "disciplines": ["A", "P", "M", "E"],
    "targets": ["rooms", "walls", "doors", "windows", "pipes", "ducts", "fixtures"],
    "materialsRuleSetId": "mrs_001"
  }'
```

### 3. Get Results

```bash
# Check job status
curl https://$RAILWAY_DOMAIN/v1/jobs/job_xyz789 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get takeoff data
curl https://$RAILWAY_DOMAIN/v1/takeoff/job_xyz789 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get materials list
curl https://$RAILWAY_DOMAIN/v1/materials/job_xyz789 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Monitoring & Logs

### View Logs
```bash
railway logs
```

### Monitor Services
```bash
railway status
```

### Database Management
```bash
# Connect to database
railway connect postgres

# Run Prisma Studio
railway run npx prisma studio
```

## Scaling & Production

### Enable Autoscaling
Railway automatically scales based on traffic. For high-volume usage:

1. Upgrade to Pro plan for better performance
2. Consider separate services for CPU-intensive tasks
3. Use Railway's metrics to monitor performance

### Security Checklist

- [ ] Change default OAuth credentials
- [ ] Set strong JWT and webhook secrets
- [ ] Configure proper CORS origins
- [ ] Set up monitoring and alerting
- [ ] Enable Railway's security features
- [ ] Use environment-specific S3 buckets

## Troubleshooting

### Common Issues

1. **Database Connection Issues:**
   ```bash
   railway run npx prisma db push
   ```

2. **Missing Environment Variables:**
   ```bash
   railway variables
   ```

3. **Build Failures:**
   ```bash
   railway logs --deployment
   ```

### Support

- Railway Docs: https://docs.railway.app
- GitHub Issues: https://github.com/jonathanbodnar/gclegacy/issues
- API Documentation: https://your-railway-domain.railway.app/docs
