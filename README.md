# PlanTakeoff Platform

AI-powered architectural/MEP plan analysis and takeoff platform. Upload plan files, extract geometry and dimensions, generate normalized takeoff data, and automatically build materials lists using configurable rules.

This is a monorepo containing both the backend API and frontend React application.

## Features

- **Multi-format support**: PDF, DWG/DXF, RVT/IFC files
- **AI-powered extraction**: Automatic detection of rooms, walls, doors, windows, pipes, ducts, and fixtures
- **Scale detection**: Auto-detect scale and units from title blocks and dimension strings
- **Materials mapping**: Configurable YAML/JSON rules to generate materials lists from extracted features
- **Cloud-native**: Containerized services with S3 storage and PostGIS database
- **API-first**: RESTful API with OpenAPI documentation
- **Webhooks**: Real-time job status notifications

## Project Structure

```
plantakeoff-platform/
├── backend/               # NestJS API server
│   ├── src/              # API source code
│   ├── prisma/           # Database schema & migrations
│   ├── scripts/          # Deployment scripts
│   └── package.json
├── frontend/             # React web application
│   ├── src/              # Frontend source code
│   ├── public/           # Static assets
│   └── package.json
├── package.json          # Root package.json (monorepo)
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL with PostGIS extension (for backend)
- Redis (for job queues)
- AWS S3 bucket (or compatible storage)

### Installation

1. **Clone the repository**:
   ```bash
   git clone git@github.com:jonathanbodnar/gclegacy.git
   cd gclegacy
   ```

2. **Install all dependencies**:
   ```bash
   npm run install:all
   ```

3. **Set up backend environment**:
   ```bash
   cp backend/env.example backend/.env
   # Edit backend/.env with your database and AWS credentials
   ```

4. **Set up frontend environment**:
   ```bash
   echo "VITE_API_BASE_URL=http://localhost:3000/v1" > frontend/.env.local
   ```

5. **Set up database** (backend):
   ```bash
   # Create PostgreSQL database with PostGIS
   createdb plantakeoff
   psql plantakeoff -c "CREATE EXTENSION postgis;"
   
   # Run database setup
   npm run db:setup
   ```

6. **Start development servers**:
   ```bash
   # Start both backend and frontend
   npm run dev
   
   # Or start individually:
   npm run dev:backend    # API at http://localhost:3000
   npm run dev:frontend   # Web app at http://localhost:5173
   ```

### Access Points

- **Frontend Web App**: http://localhost:5173
- **Backend API**: http://localhost:3000/v1
- **API Documentation**: http://localhost:3000/docs

## API Usage

### 1. Get Access Token

```bash
curl -X POST http://localhost:3000/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret"
  }'
```

### 2. Upload a Plan File

```bash
curl -X POST http://localhost:3000/v1/files \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@plan.pdf" \
  -F "projectId=proj_123"
```

### 3. Start Analysis Job

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "file_abc123",
    "disciplines": ["A", "P", "M", "E"],
    "targets": ["rooms", "walls", "doors", "windows", "pipes", "ducts", "fixtures"],
    "materialsRuleSetId": "mrs_001",
    "webhookUrl": "https://yourapp.com/hooks/plan"
  }'
```

### 4. Check Job Status

```bash
curl -X GET http://localhost:3000/v1/jobs/job_xyz789 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### 5. Get Results

```bash
# Takeoff data
curl -X GET http://localhost:3000/v1/takeoff/job_xyz789 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Materials list
curl -X GET http://localhost:3000/v1/materials/job_xyz789 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Artifacts (overlays, vectors, reports)
curl -X GET http://localhost:3000/v1/artifacts/job_xyz789 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Architecture

```
Client → REST API → Ingest → Orchestrator (queue) →
  ├─ 2D Vision Pipeline (PDF/DWG)
  ├─ BIM Pipeline (RVT/IFC)
  ├─ OCR/Dimension Resolver
  └─ Rules Engine (Materials Mapper)
        ↓
   Object Store (files, tiles) + DB (jobs, sheets, geometry)
        ↓
   Webhook/Callback + REST fetch of results
```

### Core Services

- **api-gateway**: Authentication, rate limiting, OpenAPI docs
- **ingest**: File processing and routing by type
- **orchestrator**: Job queue management and state machine
- **vision-2d**: Computer vision for feature extraction from 2D plans
- **bim-qto**: BIM model quantity takeoff
- **rules-engine**: Configurable materials mapping
- **storage**: S3-compatible file and artifact storage

## Materials Rules

Create custom materials mapping rules using YAML:

```yaml
version: 1
units:
  linear: ft
  area: ft2
vars:
  height_ft: 10
  waste_pct: 0.07
rules:
  - when: { feature: wall, partitionType: "PT-1" }
    materials:
      - sku: "STUD-362-20GA"
        qty: "length * 0.75"  # studs @16" o.c.
      - sku: "GWB-58X-TypeX"
        qty: "length * height_ft * 2 / 32"  # 4x8 sheets both sides
  - when: { feature: pipe, service: "CW", diameterIn: 1 }
    materials:
      - sku: "PVC-1IN"
        qty: "length * (1 + waste_pct)"
```

## Development

### Backend Structure

```
backend/src/
├── modules/
│   ├── auth/           # JWT authentication
│   ├── files/          # File upload and storage
│   ├── jobs/           # Job orchestration
│   ├── ingest/         # File processing
│   ├── rules-engine/   # Materials mapping
│   ├── takeoff/        # Results API
│   ├── materials/      # Materials list API
│   ├── artifacts/      # Overlays and reports
│   └── webhooks/       # Notifications
├── common/
│   └── prisma/         # Database service
└── main.ts
```

### Frontend Structure

```
frontend/src/
├── components/         # Reusable UI components
├── pages/             # Page components
├── hooks/             # Custom React hooks
├── services/          # API service functions
├── types/             # TypeScript definitions
├── utils/             # Utility functions
└── App.tsx            # Main app component
```

### Key Technologies

**Backend:**
- **NestJS**: TypeScript framework
- **Prisma**: Database ORM with PostGIS support
- **Bull**: Redis-based job queues
- **AWS SDK**: S3 storage integration
- **Sharp**: Image processing
- **pdf-parse**: PDF text extraction
- **js-yaml**: YAML rules parsing

**Frontend:**
- **React 18**: Modern React with hooks
- **TypeScript**: Type-safe development
- **Vite**: Fast build tool and dev server
- **TailwindCSS**: Utility-first CSS framework
- **React Query**: API state management
- **React Router**: Client-side routing

### Testing

```bash
# Run all tests
npm run test

# Backend tests only
npm run test:backend

# Frontend tests only
npm run test:frontend
```

### Database Schema

The API uses PostgreSQL with PostGIS for spatial data:

- **files**: Uploaded plan files
- **jobs**: Analysis job tracking
- **sheets**: Individual plan sheets/pages
- **features**: Extracted geometric features with PostGIS geometry
- **materials**: Generated materials list items
- **materials_rule_sets**: Configurable mapping rules

## Deployment

### Docker

```bash
# Build image
docker build -t plantakeoff-api .

# Run with docker-compose
docker-compose up -d
```

### Environment Variables

Key configuration options:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_HOST`: Redis server for queues
- `AWS_*`: S3 credentials and bucket
- `JWT_SECRET`: Token signing key
- `WEBHOOK_SECRET`: Webhook signature key

## API Reference

Complete API documentation is available at `/docs` when the server is running. Key endpoints:

- `POST /v1/oauth/token` - Get access token
- `POST /v1/files` - Upload plan file
- `POST /v1/jobs` - Start analysis job
- `GET /v1/jobs/{jobId}` - Get job status
- `GET /v1/takeoff/{jobId}` - Get takeoff results
- `GET /v1/materials/{jobId}` - Get materials list
- `GET /v1/artifacts/{jobId}` - Get overlay images and reports
- `POST /v1/webhooks/test` - Test webhook endpoint

## Webhook Events

The API sends webhook notifications for job status changes:

```json
{
  "event": "job.completed",
  "jobId": "job_xyz789",
  "status": "COMPLETED",
  "timestamp": "2025-10-17T10:30:00Z",
  "data": {
    "results": { "features": 1250, "materials": 45 },
    "message": "Job completed successfully"
  }
}
```

## Support

For questions and support:
- API Documentation: `/docs`
- GitHub Issues: [repository-url]/issues
- Email: support@plantakeoff.com

## License

Copyright (c) 2025 PlanTakeoff. All rights reserved.
