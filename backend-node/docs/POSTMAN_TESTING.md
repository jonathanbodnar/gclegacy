# Postman Testing Guide

This walkthrough shows how to exercise **every** API endpoint with Postman (or any HTTP client). Assume the server is running at `http://localhost:4000/v1` and you copied `env.example` to `.env`.

## 1. Create a Collection + Environment

1. Add a new environment with variables:
   - `baseUrl` → `http://localhost:4000/v1`
   - `client_id` → `demo-client`
   - `client_secret` → `demo-secret`
   - `access_token` → *(initially blank)*
2. In your collection, set the auth type to `Bearer Token` and use `{{access_token}}`. Each request will automatically pick up the token after step 2 below.

## 2. `POST /oauth/token`

- **Body (JSON)**
  ```json
  {
    "grant_type": "client_credentials",
    "client_id": "{{client_id}}",
    "client_secret": "{{client_secret}}"
  }
  ```
- **Tests tab**
  ```javascript
  const json = pm.response.json();
  pm.environment.set('access_token', json.access_token);
  ```
- **Expected 200 response**
  ```json
  {
    "access_token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": 3600
  }
  ```

## 3. `POST /files`

- **Headers**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: multipart/form-data`
- **Body (form-data)**
  - Key `file` → type *File*, pick any `.pdf`, `.dwg`, `.ifc`, `.zip`, `.png`, or `.jpg`
  - Key `projectId` → e.g. `proj-123`
  - Key `metadata` (optional) → JSON string such as `{"source":"postman"}`
- **Sample 201 response**
  ```json
  {
    "id": "673b3b1e8109bd0cb6f1ad41",
    "projectId": "proj-123",
    "originalName": "plan.pdf",
    "status": "READY",
    "uploadedAt": "2025-11-27T19:07:00.123Z"
  }
  ```
- Save `id` as Postman variable `file_id`.

## 4. `POST /jobs`

- **Headers**: `Authorization` bearer token.
- **Body (JSON)**
  ```json
  {
    "fileId": "{{file_id}}",
    "disciplines": ["A", "M", "E", "P"],
    "targets": ["rooms", "walls", "doors", "windows"],
    "materialsRuleSetId": "mrs_demo",
    "options": {
      "inferScale": true,
      "defaultStoryHeightFt": 12
    },
    "webhookUrl": "https://webhook.site/your-temp-url"
  }
  ```
- **Sample 202 response**
  ```json
  {
    "id": "673b3b9f8109bd0cb6f1ad45",
    "status": "PENDING",
    "createdAt": "2025-11-27T19:09:19.254Z",
    "targets": ["rooms", "walls", "doors", "windows"]
  }
  ```
- Save `id` as `job_id`.

## 5. `GET /jobs/:jobId`

- **URL**: `{{baseUrl}}/jobs/{{job_id}}`
- **Sample 200 response**
  ```json
  {
    "id": "673b3b9f8109bd0cb6f1ad45",
    "status": "PROCESSING",
    "history": [
      { "status": "PENDING", "timestamp": "...", "message": "Job created" },
      { "status": "PROCESSING", "timestamp": "...", "message": "Analysis started" }
    ],
    "targets": ["rooms","walls","doors","windows"],
    "disciplines": ["A","M","E","P"],
    "fileId": "673b3b1e8109bd0cb6f1ad41",
    "webhookUrl": "https://webhook.site/..."
  }
  ```
- Poll every ~2 seconds until `status` becomes `COMPLETED`.

## 6. `GET /takeoff/:jobId`

- **URL**: `{{baseUrl}}/takeoff/{{job_id}}`
- **Expected 200 after completion**
  ```json
  {
    "features": 184,
    "materials": 147,
    "targets": {
      "rooms": 40,
      "walls": 62,
      "doors": 38,
      "windows": 44
    }
  }
  ```
- If the job is still running you’ll receive `409 Takeoff results not available yet`.

## 7. `GET /materials/:jobId`

- **URL**: `{{baseUrl}}/materials/{{job_id}}`
- **Sample response**
  ```json
  {
    "jobId": "673b3b9f8109bd0cb6f1ad45",
    "materials": [
      { "sku": "SKU-ROOMS-0", "description": "rooms allowance", "quantity": 44, "unit": "ea" }
      // ...
    ]
  }
  ```

## 8. `GET /artifacts/:jobId`

- **URL**: `{{baseUrl}}/artifacts/{{job_id}}`
- **Sample**
  ```json
  {
    "jobId": "673b3b9f8109bd0cb6f1ad45",
    "artifacts": [
      {
        "label": "Annotated overlay",
        "kind": "overlay",
        "url": "https://storage.local/jobs/673b3b9f8109bd0cb6f1ad45/overlay.png"
      }
    ]
  }
  ```

## 9. `POST /webhooks/test`

- Use any bearer token.
- **Body**
  ```json
  {
    "url": "https://webhook.site/your-temp-url",
    "event": "job.test",
    "payload": { "message": "hello from Postman" }
  }
  ```
- Confirms outbound connectivity and shows you the exact JSON that real job events send.

## 10. `GET /health`

- Optional guard request to `{{baseUrl}}/health` to ensure the service is alive. Returns `{ "status": "ok", "timestamp": "..." }`.

---

Following the steps above validates authentication, uploads, job orchestration, all read endpoints, and webhook delivery without touching the original NestJS backend.

