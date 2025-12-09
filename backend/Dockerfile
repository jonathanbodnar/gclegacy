# Build stage
FROM node:18 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm install --only=production && npm cache clean --force

# Copy source code
COPY src/ src/
COPY prisma/ prisma/

# Generate Prisma client and build application
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:18 AS production

# Install system dependencies for PostGIS and image processing
RUN apt-get update && apt-get install -y \
    postgresql-client \
    libvips-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN groupadd -g 1001 nodejs || true
RUN useradd -u 1001 -g nodejs -s /bin/bash nestjs || true

# Copy built application and dependencies
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --chown=nestjs:nodejs prisma/ prisma/

# Ensure writable temp upload directory
RUN mkdir -p /app/temp/uploads && chown -R nestjs:nodejs /app/temp

# Generate Prisma client for production
RUN npx prisma generate

USER nestjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/health-check.js || exit 1

CMD ["node", "dist/main"]