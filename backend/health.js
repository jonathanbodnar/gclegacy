#!/usr/bin/env node

/**
 * Standalone health check for Railway
 * This runs independently of the main NestJS application
 */

const http = require('http');

const port = process.env.PORT || 3000;

const options = {
  hostname: 'localhost',
  port: port,
  path: '/health',
  method: 'GET',
  timeout: 5000,
};

console.log(`Checking health at http://localhost:${port}/health`);

const req = http.request(options, (res) => {
  console.log(`Health check response: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Health check passed');
      console.log('Response:', data);
      process.exit(0);
    } else {
      console.log('❌ Health check failed with status:', res.statusCode);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.log('❌ Health check failed with error:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  console.log('❌ Health check timed out');
  process.exit(1);
});

req.end();
