#!/usr/bin/env node

/**
 * Simple Express health server for Railway
 * Starts immediately without any dependencies
 */

const express = require('express');
const app = express();

const port = process.env.PORT || 3000;

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'plantakeoff-api-health',
    version: '0.1.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'PlanTakeoff API Health Server',
    health: '/health',
    status: 'Health server running - Main API starting...'
  });
});

// Ping endpoint
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Health server running on port ${port}`);
  console.log(`❤️  Health endpoint: http://localhost:${port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Health server shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Health server shutting down gracefully');
  process.exit(0);
});
