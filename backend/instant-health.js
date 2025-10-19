#!/usr/bin/env node

/**
 * Instant health server - starts immediately with zero dependencies
 */

const http = require('http');
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  const url = req.url;
  const method = req.method;

  console.log(`${new Date().toISOString()} - ${method} ${url}`);

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url === '/health' || url === '/health/') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'plantakeoff-api-instant',
      version: '0.1.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      message: 'Instant health server running'
    }));
    return;
  }

  if (url === '/' || url === '') {
    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'PlanTakeoff API Instant Health Server',
      health: '/health',
      status: 'Health server running - Main API starting in background...',
      endpoints: {
        health: '/health',
        ping: '/ping'
      }
    }));
    return;
  }

  if (url === '/ping' || url === '/ping/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }

  // 404 for other routes
  res.writeHead(404);
  res.end(JSON.stringify({
    error: 'Not Found',
    message: 'Health server - limited endpoints available',
    available: ['/health', '/ping', '/']
  }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`✅ Instant health server running on port ${port}`);
  console.log(`❤️  Health: http://0.0.0.0:${port}/health`);
  console.log(`🏓 Ping: http://0.0.0.0:${port}/ping`);
  console.log(`📡 Ready for Railway health checks`);
});

// Error handling
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Keep alive
setInterval(() => {
  console.log(`💓 Health server alive - uptime: ${Math.floor(process.uptime())}s`);
}, 30000); // Log every 30 seconds
