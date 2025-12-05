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

### 5. Initialize Database (First Time Only)

```bash
# Push schema to database
docker exec backend-api-1 npx prisma db push
```

**Seed material rule sets (REQUIRED - without this, no materials will be generated!)**

> Note: `npm run seed` requires ts-node which isn't in production container. Use the manual SQL below.

**What needs to be seeded:**
- `Standard Commercial Rules v1.0` - Rules for commercial buildings (metal studs, ACT ceiling, VCT flooring)
- `Residential Rules v1.0` - Rules for residential (wood studs, drywall ceiling, hardwood flooring)

**Manual seed (recommended):**
```bash
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "
INSERT INTO materials_rule_sets (id, name, version, rules, \"createdAt\", \"updatedAt\")
VALUES (
  'default-rules-v1',
  'Standard Commercial Rules',
  '1.0',
  '{
    \"version\": 1,
    \"units\": {\"linear\": \"ft\", \"area\": \"ft2\"},
    \"vars\": {
      \"wall_height\": 9,
      \"perimeter_ratio\": 0.4,
      \"waste_floor\": 1.07,
      \"waste_paint\": 1.15,
      \"waste_ceiling\": 1.05
    },
    \"rules\": [
      {\"when\": {\"feature\": \"room\"}, \"materials\": [
        {\"sku\": \"ARM-EXCELON-51910\", \"qty\": \"area * waste_floor\", \"uom\": \"SF\", \"description\": \"Armstrong Excelon VCT Flooring\"},
        {\"sku\": \"SW-7006-PAINT\", \"qty\": \"area * perimeter_ratio * waste_paint\", \"uom\": \"SF\", \"description\": \"Interior Paint\"},
        {\"sku\": \"ARM-CIRRUS-ACT\", \"qty\": \"area * waste_ceiling\", \"uom\": \"SF\", \"description\": \"ACT Ceiling Tiles\"},
        {\"sku\": \"RUBBER-BASE-4IN\", \"qty\": \"area * perimeter_ratio\", \"uom\": \"LF\", \"description\": \"Rubber Base Molding\"}
      ]},
      {\"when\": {\"feature\": \"wall\"}, \"materials\": [
        {\"sku\": \"STUD-362-20GA\", \"qty\": \"length * 0.75\", \"uom\": \"LF\", \"description\": \"Metal Studs 3-5/8 20GA\"},
        {\"sku\": \"GWB-58-TYPEX\", \"qty\": \"length * wall_height * 2 / 32\", \"uom\": \"SHT\", \"description\": \"5/8 Type X Gypsum Board\"},
        {\"sku\": \"JOINT-COMPOUND\", \"qty\": \"length * wall_height * 0.05\", \"uom\": \"GAL\", \"description\": \"Joint Compound\"},
        {\"sku\": \"DRYWALL-TAPE\", \"qty\": \"length * 1.1\", \"uom\": \"LF\", \"description\": \"Drywall Tape\"}
      ]},
      {\"when\": {\"feature\": \"opening\"}, \"materials\": [
        {\"sku\": \"DOOR-FRAME-HM\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Hollow Metal Door Frame\"},
        {\"sku\": \"DOOR-SOLID-SC\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Solid Core Door\"},
        {\"sku\": \"HARDWARE-SET\", \"qty\": \"count\", \"uom\": \"SET\", \"description\": \"Door Hardware Set\"}
      ]},
      {\"when\": {\"feature\": \"pipe\"}, \"materials\": [
        {\"sku\": \"PIPE-COPPER-L\", \"qty\": \"length\", \"uom\": \"LF\", \"description\": \"Copper Pipe Type L\"},
        {\"sku\": \"PIPE-FITTING\", \"qty\": \"length * 0.1\", \"uom\": \"EA\", \"description\": \"Pipe Fittings\"},
        {\"sku\": \"PIPE-HANGER\", \"qty\": \"length / 4\", \"uom\": \"EA\", \"description\": \"Pipe Hangers\"},
        {\"sku\": \"PIPE-INSUL\", \"qty\": \"length\", \"uom\": \"LF\", \"description\": \"Pipe Insulation\"}
      ]},
      {\"when\": {\"feature\": \"duct\"}, \"materials\": [
        {\"sku\": \"DUCT-GALV-RECT\", \"qty\": \"length\", \"uom\": \"LF\", \"description\": \"Galvanized Ductwork\"},
        {\"sku\": \"DUCT-FITTING\", \"qty\": \"length * 0.15\", \"uom\": \"EA\", \"description\": \"Duct Fittings\"},
        {\"sku\": \"DUCT-HANGER\", \"qty\": \"length / 5\", \"uom\": \"EA\", \"description\": \"Duct Hangers\"},
        {\"sku\": \"DUCT-INSUL\", \"qty\": \"length * 2\", \"uom\": \"SF\", \"description\": \"Duct Insulation\"}
      ]},
      {\"when\": {\"feature\": \"fixture\"}, \"materials\": [
        {\"sku\": \"FIXTURE-UNIT\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Plumbing/Electrical Fixture\"},
        {\"sku\": \"FIXTURE-CONN\", \"qty\": \"count * 2\", \"uom\": \"EA\", \"description\": \"Fixture Connections\"},
        {\"sku\": \"FIXTURE-MOUNT\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Mounting Hardware\"}
      ]}
    ]
  }'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;
"

# Seed Residential Rules
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "
INSERT INTO materials_rule_sets (id, name, version, rules, \"createdAt\", \"updatedAt\")
VALUES (
  'residential-rules-v1',
  'Residential Rules',
  '1.0',
  '{
    \"version\": 1,
    \"units\": {\"linear\": \"ft\", \"area\": \"ft2\"},
    \"vars\": {\"wall_height\": 8, \"perimeter_ratio\": 0.35, \"waste_floor\": 1.05, \"waste_paint\": 1.10, \"waste_ceiling\": 1.03},
    \"rules\": [
      {\"when\": {\"feature\": \"room\"}, \"materials\": [
        {\"sku\": \"HARDWOOD-OAK\", \"qty\": \"area * waste_floor\", \"uom\": \"SF\", \"description\": \"Oak Hardwood Flooring\"},
        {\"sku\": \"INT-PAINT-FLAT\", \"qty\": \"area * perimeter_ratio * waste_paint\", \"uom\": \"SF\", \"description\": \"Interior Flat Paint\"},
        {\"sku\": \"DRYWALL-CEILING\", \"qty\": \"area * waste_ceiling\", \"uom\": \"SF\", \"description\": \"Drywall Ceiling\"},
        {\"sku\": \"WOOD-BASE-3IN\", \"qty\": \"area * perimeter_ratio\", \"uom\": \"LF\", \"description\": \"Wood Base Molding\"}
      ]},
      {\"when\": {\"feature\": \"wall\"}, \"materials\": [
        {\"sku\": \"STUD-WOOD-2X4\", \"qty\": \"length * 0.75\", \"uom\": \"LF\", \"description\": \"Wood Studs 2x4 @ 16 OC\"},
        {\"sku\": \"GWB-12-REG\", \"qty\": \"length * wall_height * 2 / 32\", \"uom\": \"SHT\", \"description\": \"1/2 Regular Drywall\"}
      ]},
      {\"when\": {\"feature\": \"opening\"}, \"materials\": [
        {\"sku\": \"DOOR-FRAME-WOOD\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Wood Door Frame\"},
        {\"sku\": \"DOOR-HOLLOW\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Hollow Core Door\"},
        {\"sku\": \"HARDWARE-RES\", \"qty\": \"count\", \"uom\": \"SET\", \"description\": \"Residential Hardware\"}
      ]},
      {\"when\": {\"feature\": \"pipe\"}, \"materials\": [
        {\"sku\": \"PEX-PIPE\", \"qty\": \"length\", \"uom\": \"LF\", \"description\": \"PEX Pipe\"},
        {\"sku\": \"PEX-FITTING\", \"qty\": \"length * 0.08\", \"uom\": \"EA\", \"description\": \"PEX Fittings\"}
      ]},
      {\"when\": {\"feature\": \"duct\"}, \"materials\": [
        {\"sku\": \"FLEX-DUCT\", \"qty\": \"length\", \"uom\": \"LF\", \"description\": \"Flexible Ductwork\"},
        {\"sku\": \"DUCT-STRAP\", \"qty\": \"length / 3\", \"uom\": \"EA\", \"description\": \"Duct Straps\"}
      ]},
      {\"when\": {\"feature\": \"fixture\"}, \"materials\": [
        {\"sku\": \"FIXTURE-RES\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Residential Fixture\"},
        {\"sku\": \"FIXTURE-SUPPLY\", \"qty\": \"count\", \"uom\": \"EA\", \"description\": \"Supply Lines\"}
      ]}
    ]
  }'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;
"
```

### Verify Database Setup

```bash
# Check rule sets exist
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "SELECT id, name, version FROM materials_rule_sets;"

# Expected output:
#          id          |           name            | version
# ---------------------+---------------------------+---------
# default-rules-v1     | Standard Commercial Rules | 1.0
# residential-rules-v1 | Residential Rules         | 1.0
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

### No Materials Generated (Jobs Complete but Empty Materials)
This happens when material rule sets are not seeded.

```bash
# Check if rule sets exist
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "SELECT COUNT(*) FROM materials_rule_sets;"

# If count is 0, run the seed
docker exec backend-api-1 npm run seed

# Or manually insert rules (see "Initialize Database" section above)
```

### Materials Not Applied to Existing Jobs
If jobs completed before rules were seeded, materials won't exist. Re-apply rules:

```bash
# Check features exist for a job
docker exec backend-postgres-1 psql -U plantakeoff -d plantakeoff -c "SELECT type, COUNT(*) FROM features WHERE \"jobId\" = 'YOUR_JOB_ID' GROUP BY type;"

# If features exist but materials don't, you need to re-process the job
# or manually trigger the rules engine (requires code changes)
```

---

## Quick Reference: What Gets Seeded

| Table | Seeded Data | Purpose |
|-------|-------------|---------|
| `materials_rule_sets` | Standard Commercial Rules v1.0 | Converts features → materials |
| `materials_rule_sets` | Residential Rules v1.0 | Alternative rule set |

**Without these seeds, jobs will:**
- ✅ Extract features (rooms, walls, pipes, etc.)
- ❌ Generate zero materials
- ❌ Show empty materials list in frontend
