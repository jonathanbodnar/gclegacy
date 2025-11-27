# Dependency Inventory

The tables below summarize every package required by the Node.js backend, grouped by purpose so you can reproduce the environment elsewhere.

## Runtime Dependencies

| Package | Reason |
| ------- | ------ |
| `express` | Core HTTP server and routing |
| `cors` | Configurable CORS headers for the React app |
| `helmet` | Baseline security headers |
| `morgan` | Request logging during development |
| `dotenv` | Loads the `.env` file before config parsing |
| `mongoose` | ODM for MongoDB models/queries |
| `multer` | Multipart parsing and disk storage for plans |
| `axios` | Triggering outbound webhooks |
| `jsonwebtoken` | Signing + verifying Bearer tokens |
| `bcryptjs` | Hashing integration-client secrets |
| `uuid` | Utility for generating ids (reserved for future use) |
| `zod` | Runtime validation for incoming payloads |
| `express-async-errors` | Propagates async/await errors to the global handler |

## Dev / Build Dependencies

| Package | Reason |
| ------- | ------ |
| `typescript` | Type-safe source files |
| `ts-node-dev` | Fast reload loop for local development |
| `@types/node` | Node.js ambient types |
| `@types/express` | Express request/response typings |
| `@types/cors` | Type support for cors config |
| `@types/morgan` | Type support for HTTP logging |
| `@types/jsonwebtoken` | JWT typings |
| `@types/bcryptjs` | bcrypt typings |
| `@types/multer` | Multer typings |
| `@types/uuid` | UUID typings |
| `@types/axios` | Axios typings |

> **Tip:** Running `npm install` from `backend-node/` automatically installs everything above—these tables are primarily for documentation, air-gapped environments, or change reviews.

