# GCLegacy Backend - Deployment & Operations Guide

## Project Overview

GCLegacy is an AI-powered construction plan takeoff system that:
1. **Ingests PDFs** - Architectural/MEP construction drawings
2. **Extracts Features** - Rooms, walls, doors, pipes, ducts, fixtures using OpenAI Vision
3. **Generates Materials** - Applies rules to convert features into material quantities
4. **Outputs Takeoff** - Bill of materials with quantities and costs

### Tech Stack
- **Runtime:** Node.js 18 + NestJS
- **Database:** PostgreSQL 15 with PostGIS
- **Queue:** Redis + Bull
- **Storage:** Wasabi S3 (or local fallback)
- **AI:** OpenAI GPT-4 Vision
- **Container:** Docker + Docker Compose

---

## Server Requirements

| Usage Level | CPU | RAM | Storage | Cost (DO) |
|-------------|-----|-----|---------|-----------|
| Light (1 job at a time) | 2 vCPU | 8GB | 50GB | ~$48/mo |
| **Production (recommended)** | 4 vCPU | 16GB | 100GB | ~$96/mo |
| Heavy (5+ concurrent) | 8 vCPU | 32GB | 200GB | ~$192/mo |

### Memory Usage per Component
- Base API (idle): ~100MB
- Per PDF job: 500MB - 2GB (depends on page count)
- PostgreSQL: ~50MB
- Redis: ~20MB

---

## Fresh Server Setup

### 1. Install Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose (if not included)
apt install docker-compose-plugin -y

# Install Nginx & Certbot for SSL
apt install nginx certbot python3-certbot-nginx -y

# Install Git
apt install git -y
```

### 2. Clone Repository

```bash
cd /root
git clone https://github.com/jonathanbodnar/gclegacy.git
cd gclegacy/backend
```

### 3. Configure Environment

```bash
cat > .env << 'ENVEOF'
# Database (Docker internal)
DATABASE_URL="postgresql://plantakeoff:password@postgres:5432/plantakeoff?schema=public"

# JWT
JWT_SECRET="$(openssl rand -base64 32)"
JWT_EXPIRES_IN="24h"

# Redis (Docker internal)
REDIS_HOST="redis"
REDIS_PORT=6379
REDIS_URL="redis://redis:6379"

# OpenAI - REQUIRED
OPENAI_API_KEY="sk-proj-YOUR_KEY_HERE"

# Wasabi S3 Storage
WASABI_ENDPOINT="https://s3.wasabisys.com"
WASABI_REGION="us-central-1"
WASABI_ACCESS_KEY_ID="YOUR_ACCESS_KEY"
WASABI_SECRET_ACCESS_KEY="YOUR_SECRET_KEY"
WASABI_BUCKET_NAME="gclegacy"

# API Config
PORT=3000
NODE_ENV="production"
MINIMAL_START="false"

# PDF Processing
PDF_CONVERSION_TIMEOUT_MIN=45
PDF_PAGE_BATCH_SIZE=5
PDF_MAX_CONCURRENT_PAGES=1
PDF_RENDER_DPI=300
VISION_BATCH_SIZE=3
ENVEOF
```

### 4. Start Services

```bash
docker compose up -d
```

### 5. Seed Database (First Time Only)

```bash
docker exec backend-api-1 npx prisma db push
docker exec backend-api-1 npm run seed
```

### 6. Verify

```bash
curl http://localhost:3000/health
```

---

## SSL Setup with sslip.io (Free, No Domain Required)

```bash
# Get your server IP
SERVER_IP=$(curl -s ifconfig.me)

# Configure Nginx
cat > /etc/nginx/sites-available/gclegacy << NGINXEOF
server {
    listen 80;
    server_name ${SERVER_IP}.sslip.io;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXEOF

# Enable site
ln -sf /etc/nginx/sites-available/gclegacy /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL Certificate
certbot --nginx -d ${SERVER_IP}.sslip.io --non-interactive --agree-tos --email admin@example.com

# Increase upload limit (for large PDFs)
echo "client_max_body_size 150M;" > /etc/nginx/conf.d/upload-size.conf
systemctl reload nginx
```

**Your API will be available at:** `https://<YOUR_IP>.sslip.io`

---

## CI/CD Setup (GitHub Actions)

### 1. Generate SSH Key on Server

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -C "github-actions-deploy"
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key  # Copy this for GitHub
```

### 2. Add GitHub Secrets

Go to: `https://github.com/jonathanbodnar/gclegacy/settings/secrets/actions`

Add these secrets:
| Secret Name | Value |
|-------------|-------|
| `DROPLET_SSH_KEY` | Contents of `~/.ssh/deploy_key` (private key) |
| `GH_PAT` | Your GitHub Personal Access Token |

### 3. Update Workflow IP

Edit `.github/workflows/deploy-backend.yml` and update `DROPLET_IP` with your server IP.

### 4. Push to Deploy

Any push to `main` branch affecting `backend/**` will auto-deploy.

---

## Operations

### View Logs
```bash
docker logs backend-api-1 --tail 100 -f
```

### Restart Services
```bash
cd /root/gclegacy/backend
docker compose restart
```

### Check Job Status
```bash
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "SELECT status, COUNT(*) FROM jobs GROUP BY status;"
```

### Reset Stuck Jobs
```bash
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "UPDATE jobs SET status = 'FAILED', error = 'Manual reset' WHERE status = 'PROCESSING';"
```

### Monitor Resources
```bash
docker stats
free -h
```

### Clear All Jobs (Nuclear Option)
```bash
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "TRUNCATE jobs, features, materials, sheets CASCADE;"
```

---

## Known Optimizations Implemented

### 1. Memory Cleanup (job.processor.ts)
- Deletes temp image files after job completion
- Clears rasterData buffers from memory
- Forces garbage collection
- Runs on both success and failure

### 2. Comprehensive Material Rules
- Rules for all feature types: room, wall, opening, pipe, duct, fixture
- Aggregates materials by SKU
- Calculates quantities with waste factors

### 3. File Storage Volume
- Docker volume for local storage fallback
- Persists files across container restarts

---

## Recommended Future Optimizations

### 1. Job Concurrency Limit
Add to `job.processor.ts`:
```typescript
@Process({ name: 'process-job', concurrency: 1 })
```
This prevents multiple large PDFs from exhausting memory.

### 2. Periodic Cleanup Cron
- Delete temp files older than 24 hours
- Archive completed jobs older than 30 days
- Clean orphaned storage files

### 3. Health Check Improvements
- Add memory threshold alerts
- Auto-restart on high memory usage
- Job timeout monitoring

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/ping` | GET | Returns "pong" |
| `/v1/oauth/token` | POST | Get auth token |
| `/v1/files` | POST | Upload PDF |
| `/v1/jobs` | POST | Create takeoff job |
| `/v1/jobs/:id` | GET | Get job status |
| `/v1/materials/:jobId` | GET | Get materials list |
| `/v1/takeoff/:jobId` | GET | Get takeoff results |

---

## Troubleshooting

### Job Stuck at PROCESSING
```bash
# Check if API is processing
docker logs backend-api-1 --tail 50

# Reset stuck jobs
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "UPDATE jobs SET status = 'QUEUED' WHERE status = 'PROCESSING';"

# Restart API to re-process
docker compose restart api
```

### Out of Memory
```bash
# Check memory
free -h
docker stats

# Restart to clear memory
docker compose restart api
```

### SSL Certificate Renewal
Certbot auto-renews. To manual renew:
```bash
certbot renew
```

### Database Connection Issues
```bash
# Check if postgres is running
docker exec backend-postgres-1 pg_isready -U plantakeoff

# Restart postgres
docker compose restart postgres
```
