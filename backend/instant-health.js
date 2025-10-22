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

  // Basic OAuth endpoint for frontend testing
  if (url === '/v1/oauth/token' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.grant_type === 'client_credentials') {
          res.writeHead(200);
          res.end(JSON.stringify({
            access_token: 'demo-token-12345',
            token_type: 'Bearer',
            expires_in: 86400,
            scope: 'read write'
          }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
        }
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid_request' }));
      }
    });
    return;
  }

  // Mock file upload endpoint
  if (url === '/v1/files' && method === 'POST') {
    res.writeHead(200);
    res.end(JSON.stringify({
      fileId: 'file_demo_' + Date.now(),
      pages: 1,
      mime: 'application/pdf',
      checksum: 'demo-checksum-' + Date.now()
    }));
    return;
  }

  // Mock job creation endpoint
  if (url === '/v1/jobs' && method === 'POST') {
    const jobId = 'job_demo_' + Date.now();
    res.writeHead(201);
    res.end(JSON.stringify({
      jobId: jobId,
      status: 'QUEUED'
    }));
    return;
  }

  // Mock job status endpoint
  if (url.startsWith('/v1/jobs/') && method === 'GET') {
    const jobId = url.split('/')[3];
    res.writeHead(200);
    res.end(JSON.stringify({
      jobId: jobId,
      status: 'COMPLETED',
      progress: 100,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    }));
    return;
  }

  // Mock takeoff results
  if (url.startsWith('/v1/takeoff/') && method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({
      version: '2025-10-01',
      units: { linear: 'ft', area: 'ft2' },
      sheets: [{ id: 'A-1.1', scale: '1/4"=1\'-0"' }],
      rooms: [
        { id: 'R100', name: 'OFFICE', area: 150.5, program: 'Office' },
        { id: 'R101', name: 'CONFERENCE', area: 200.0, program: 'Meeting' }
      ],
      walls: [
        { id: 'W1', length: 20.5, partitionType: 'PT-1' },
        { id: 'W2', length: 15.0, partitionType: 'PT-2' }
      ],
      openings: [
        { id: 'D1', openingType: 'door', width: 3.0 },
        { id: 'W1', openingType: 'window', width: 4.0 }
      ],
      pipes: [
        { id: 'P1', service: 'CW', diameterIn: 1.0, length: 50.0 },
        { id: 'P2', service: 'HW', diameterIn: 0.75, length: 45.0 }
      ],
      ducts: [
        { id: 'D1', size: '12x10', length: 80.0 },
        { id: 'D2', size: '8x8', length: 60.0 }
      ],
      fixtures: [
        { id: 'F1', fixtureType: 'Toilet', count: 2 },
        { id: 'F2', fixtureType: 'LED Light', count: 12 }
      ],
      meta: {
        fileId: 'file_demo',
        jobId: jobId,
        generatedAt: new Date().toISOString()
      }
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
