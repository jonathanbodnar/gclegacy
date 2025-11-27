# Node.js + MongoDB Backend

This folder contains a standalone Express + MongoDB implementation of the PlanTakeoff API contract. It mirrors the original NestJS endpoints while keeping the existing `backend/` folder untouched, allowing you to experiment with a lighter Node.js stack.

## Tech Stack

- **Express 4** for HTTP routing
- **MongoDB + Mongoose** for persistence
- **Multer** for plan uploads to local storage
- **Zod** for runtime validation
- **JWT** bearer tokens for client authentication
- **OpenAI Vision (GPT-4o family)** for plan analysis (PDF → images via `pdfjs-dist` + `@napi-rs/canvas`)
- **Optional Wasabi S3** storage for long-lived artifacts/uploads

## Prerequisites

- Node.js 18+
- npm 10+
- Running MongoDB instance (local Docker or Atlas)

## Quick Start

```bash
cd backend-node
cp env.example .env            # adjust secrets + Mongo URI
npm install
npm run dev                    # starts server with ts-node-dev on http://localhost:4000/v1
```

### Scripts

| Script        | Description                                  |
| ------------- | -------------------------------------------- |
| `npm run dev` | Hot reload development server                |
| `npm run build` | Compiles TypeScript to `dist/`            |
| `npm start`   | Starts compiled JavaScript from `dist/`      |

## Environment Variables

| Key | Description |
| --- | ----------- |
| `PORT` | API port (default `4000`) |
| `API_PREFIX` | Prefix mounted in Express (default `/v1`) |
| `MONGODB_URI` | Mongo connection string |
| `JWT_SECRET` | Random string used to sign access tokens |
| `DEFAULT_CLIENT_*` | Seed client credentials for Postman tests |
| `STORAGE_DIR` | Directory used by Multer to persist uploads |
| `JOB_PROCESSING_DELAY_MS` | Simulated processing delay before results are ready |
| `ALLOW_ORIGINS` | Comma-separated list for CORS |

## Folder Layout

```
backend-node/
├── docs/                 # package + Postman instructions
├── src/
│   ├── controllers/      # route handlers
│   ├── jobs/             # fake processor to generate results
│   ├── middleware/       # auth, validation, upload, errors
│   ├── models/           # Mongoose schemas
│   ├── routes/           # Express routers
│   └── services/         # persistence + webhook helpers
└── storage/uploads       # on-disk plan files (gitignored)
```

## API Coverage

| Endpoint | Description |
| -------- | ----------- |
| `POST /v1/oauth/token` | Client credentials → JWT |
| `POST /v1/files` | Authenticated plan upload (multipart) |
| `POST /v1/jobs` | Start an analysis run for an uploaded file |
| `GET /v1/jobs/:jobId` | Poll job status + history (includes progress + errors) |
| `DELETE /v1/jobs/:jobId` | Cancel a queued/processing job |
| `DELETE /v1/jobs` | Clear all queued/processing jobs + related data |
| `POST /v1/jobs/process-queued` | Manually kick queued jobs when Redis is unavailable |
| `GET /v1/takeoff/:jobId` | Retrieve normalized takeoff graph sourced from Mongo |
| `GET /v1/materials/:jobId` | Retrieve generated materials list (from `materials` collection) |
| `GET /v1/artifacts/:jobId` | Retrieve artifact links |
| `POST /v1/webhooks/test` | Fire a sample webhook to an external URL |
| `GET /v1/health` | Liveness check |

Each job run now stitches together the same phases as the NestJS service (ingest → analysis → feature extraction → materials + artifacts). Sheets, features, and materials are persisted in MongoDB so the `/takeoff`, `/materials`, and `/artifacts` endpoints can stream real data rather than synthetic placeholders. Queueing still runs in-process by default, but you can manually re-trigger queued jobs if Redis is unavailable.

## Testing with Postman

A step-by-step walkthrough (including example payloads and expected responses) is documented in `docs/POSTMAN_TESTING.md`. Use it to exercise every endpoint with zero coding.

## Package Reference

`docs/PACKAGES.md` lists every runtime and dev dependency with rationale so you know exactly what to install on another environment or CI runner.

### Data Model Overview

| Collection | Purpose |
| ---------- | ------- |
| `files` | Uploaded plan metadata (checksum, page count, tags, storage URLs) |
| `jobs` | Job configuration, state machine, takeoff/material snapshots, artifacts |
| `sheets` | Sheet-level metadata emitted during ingest |
| `features` | Room/wall/pipe/etc. features captured per sheet + provenance |
| `materials` | Bill-of-materials line items derived from rules |

These extra collections bring the Express backend to parity with the NestJS implementation while keeping MongoDB as the source of truth.

### OpenAI Configuration

Set the following vars in `.env` to enable vision-powered takeoff analysis (falls back to synthetic data if omitted):

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini     # any Vision-capable model
OPENAI_MAX_PAGES=5           # safety limit for PDF rendering
```

The worker renders PDFs to PNGs with `pdfjs-dist`/`@napi-rs/canvas` and streams each page to OpenAI, producing structured JSON that is persisted to Mongo (`sheets`, `features`, `materials`).

---

Feel free to adapt the processor/service layers to real inference pipelines or external storage providers—the Express surface already matches the NestJS API, so swapping implementations should be straightforward.

