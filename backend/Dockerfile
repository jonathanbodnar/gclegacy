# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ src/
COPY prisma/ prisma/

# Generate Prisma client and build application
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install system dependencies for PostGIS and image processing
RUN apk add --no-cache \
    postgresql-client \
    vips-dev \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Copy built application and dependencies
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --chown=nestjs:nodejs prisma/ prisma/

# Generate Prisma client for production
RUN npx prisma generate

USER nestjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/health-check.js || exit 1

CMD ["node", "dist/main"]
