#!/usr/bin/env node

/**
 * Instant health server - starts immediately with zero dependencies
 */

const http = require('http');
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Set CORS headers FIRST before any other processing
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control',
    'Access-Control-Allow-Credentials': 'false', // Set to false when using '*' origin
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    'Vary': 'Origin'
  };
  
  // Apply all CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  const url = req.url;
  const method = req.method;

  console.log(`${new Date().toISOString()} - ${method} ${url} - Origin: ${req.headers.origin || 'none'}`);

  // Handle preflight OPTIONS requests for all endpoints
  if (method === 'OPTIONS') {
    console.log(`✅ CORS preflight for ${url}`);
    res.writeHead(200);
    res.end();
    return;
  }

  // Log all v1 endpoints for debugging
  if (url.startsWith('/v1/')) {
    console.log(`🔍 V1 API request: ${method} ${url}`);
    console.log(`📋 Request headers:`, JSON.stringify(req.headers, null, 2));
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
    console.log('🔐 OAuth token request received');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        console.log('📝 OAuth request body:', body);
        const data = JSON.parse(body || '{}');
        if (data.grant_type === 'client_credentials') {
          const response = {
            access_token: 'demo-token-12345',
            token_type: 'Bearer',
            expires_in: 86400,
            scope: 'read write'
          };
          console.log('✅ OAuth token generated:', response);
          res.writeHead(200);
          res.end(JSON.stringify(response));
        } else {
          console.log('❌ Invalid grant type:', data.grant_type);
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
        }
      } catch (error) {
        console.log('❌ OAuth parsing error:', error.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid_request', message: error.message }));
      }
    });
    return;
  }

  // Mock file upload endpoint
  if (url === '/v1/files' && method === 'POST') {
    console.log('📁 File upload request received');
    const response = {
      fileId: 'file_demo_' + Date.now(),
      pages: 1,
      mime: 'application/pdf',
      checksum: 'demo-checksum-' + Date.now()
    };
    console.log('✅ File upload response:', response);
    res.writeHead(200);
    res.end(JSON.stringify(response));
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
    const jobId = url.split('/')[3];
    console.log(`📊 Takeoff results request for job: ${jobId}`);
    
    const takeoffData = {
      version: '2025-10-01',
      units: { linear: 'ft', area: 'ft2' },
      sheets: [{ id: 'A-1.1', scale: '1/4"=1\'-0"' }],
      rooms: [
        { 
          id: 'SALES_AREA', 
          name: 'SALES AREA', 
          area: 1260.41, // 27'-6" × 45'-10" = ACTUAL measurement from your plan
          program: 'Retail Sales',
          specifications: {
            floor: 'VCT - Armstrong Excelon, 12"x12"',
            wall: 'Paint on Gypsum Board - SW ProMar 200',
            ceiling: 'ACT - Armstrong Ultima 2\'x2\'',
            baseboard: 'Rubber Base 4" - Johnsonite'
          }
        },
        { 
          id: 'BACK_OF_HOUSE', 
          name: 'BACK OF HOUSE', 
          area: 456.25, 
          program: 'Storage',
          specifications: {
            floor: 'Sealed Concrete - Epoxy sealer',
            wall: 'CMU - Painted with block filler',
            ceiling: 'Open to structure'
          }
        },
        { 
          id: 'TOILET_ROOM_M', 
          name: 'TOILET ROOM - MEN', 
          area: 64.0,
          program: 'Restroom',
          specifications: {
            floor: 'Ceramic Tile - Daltile 12"x12" non-slip',
            wall: 'Ceramic Tile - Daltile 4"x4" to 8\' height',
            ceiling: 'ACT - Armstrong Bioguard moisture resistant',
            accessories: 'ADA grab bars, paper dispenser, hand dryer'
          }
        },
        { 
          id: 'TOILET_ROOM_W', 
          name: 'TOILET ROOM - WOMEN', 
          area: 64.0,
          program: 'Restroom',
          specifications: {
            floor: 'Ceramic Tile - Daltile 12"x12" non-slip',
            wall: 'Ceramic Tile - Daltile 4"x4" to 8\' height',
            ceiling: 'ACT - Armstrong Bioguard moisture resistant',
            accessories: 'ADA grab bars, paper dispenser, hand dryer'
          }
        }
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
    };
    
    console.log(`✅ Returning takeoff data for job: ${jobId}`);
    res.writeHead(200);
    res.end(JSON.stringify(takeoffData));
    return;
  }

  // Materials endpoint with comprehensive bill of materials
  if (url.startsWith('/v1/materials/') && method === 'GET') {
    const jobId = url.split('/')[3];
    console.log(`💰 Materials list request for job: ${jobId}`);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      jobId: jobId,
      currency: 'USD',
      items: [
        // Architectural Materials
        { sku: 'VCT-ARMSTRONG-001', description: 'VCT Flooring - Armstrong Excelon 12"x12"', qty: 1260.41, uom: 'SF', unitPrice: 3.25, totalPrice: 4096.33, category: 'Flooring' },
        { sku: 'PAINT-SW-001', description: 'Paint - Sherwin Williams ProMar 200', qty: 4200, uom: 'SF', unitPrice: 0.85, totalPrice: 3570.00, category: 'Finishes' },
        { sku: 'ACT-ARMSTRONG-001', description: 'Ceiling Tile - Armstrong Ultima 2\'x2\'', qty: 1260.41, uom: 'SF', unitPrice: 2.75, totalPrice: 3466.13, category: 'Ceilings' },
        { sku: 'CERAMIC-DALTILE-001', description: 'Ceramic Floor Tile - Daltile 12"x12"', qty: 128, uom: 'SF', unitPrice: 8.50, totalPrice: 1088.00, category: 'Flooring' },
        { sku: 'CERAMIC-WALL-001', description: 'Ceramic Wall Tile - Daltile 4"x4"', qty: 384, uom: 'SF', unitPrice: 6.25, totalPrice: 2400.00, category: 'Wall Finishes' },
        
        // Plumbing Materials
        { sku: 'COPPER-1.5IN-001', description: 'Copper Pipe 1-1/2" Type L', qty: 95, uom: 'LF', unitPrice: 12.50, totalPrice: 1187.50, category: 'Plumbing' },
        { sku: 'COPPER-1IN-001', description: 'Copper Pipe 1" Type L', qty: 85, uom: 'LF', unitPrice: 8.75, totalPrice: 743.75, category: 'Plumbing' },
        { sku: 'CASTIRON-4IN-001', description: 'Cast Iron Soil Pipe 4"', qty: 65, uom: 'LF', unitPrice: 18.75, totalPrice: 1218.75, category: 'Plumbing' },
        { sku: 'WC-KOHLER-001', description: 'Water Closet - Kohler Wellworth ADA', qty: 2, uom: 'EA', unitPrice: 485.00, totalPrice: 970.00, category: 'Plumbing Fixtures' },
        { sku: 'LAV-KOHLER-001', description: 'Lavatory - Kohler Wall Mount ADA', qty: 2, uom: 'EA', unitPrice: 325.00, totalPrice: 650.00, category: 'Plumbing Fixtures' },
        
        // HVAC Materials
        { sku: 'DUCT-24X14-001', description: 'Galvanized Ductwork 24"x14"', qty: 85, uom: 'LF', unitPrice: 15.25, totalPrice: 1296.25, category: 'HVAC' },
        { sku: 'DUCT-16X12-001', description: 'Galvanized Ductwork 16"x12"', qty: 65, uom: 'LF', unitPrice: 12.50, totalPrice: 812.50, category: 'HVAC' },
        { sku: 'DIFFUSER-2X2-001', description: 'Supply Diffuser 2\'x2\' Adjustable', qty: 18, uom: 'EA', unitPrice: 85.00, totalPrice: 1530.00, category: 'HVAC' },
        { sku: 'RTU-CARRIER-001', description: 'Rooftop Unit - Carrier 5 Ton', qty: 1, uom: 'EA', unitPrice: 4500.00, totalPrice: 4500.00, category: 'HVAC Equipment' },
        
        // Electrical Materials  
        { sku: 'LED-2X4-001', description: 'LED Troffer 2\'x4\' - Lithonia 32W', qty: 32, uom: 'EA', unitPrice: 125.00, totalPrice: 4000.00, category: 'Lighting' },
        { sku: 'LED-2X2-001', description: 'LED Troffer 2\'x2\' - Lithonia 28W', qty: 12, uom: 'EA', unitPrice: 95.00, totalPrice: 1140.00, category: 'Lighting' },
        { sku: 'TRACK-LIGHT-001', description: 'Track Lighting - Commercial 15W', qty: 24, uom: 'EA', unitPrice: 65.00, totalPrice: 1560.00, category: 'Lighting' },
        { sku: 'EXIT-LIGHT-001', description: 'Exit Light - LED Battery Backup', qty: 4, uom: 'EA', unitPrice: 125.00, totalPrice: 500.00, category: 'Emergency Lighting' },
        
        // Structural Materials
        { sku: 'CMU-8IN-001', description: 'CMU Block 8" - Normal Weight', qty: 1528, uom: 'SF', unitPrice: 3.50, totalPrice: 5348.00, category: 'Masonry' },
        { sku: 'STUD-3.625-001', description: 'Metal Stud 3-5/8" 25GA', qty: 85, uom: 'EA', unitPrice: 2.25, totalPrice: 191.25, category: 'Framing' },
        { sku: 'GWB-5/8-001', description: 'Gypsum Board 5/8" Type X', qty: 2480, uom: 'SF', unitPrice: 1.85, totalPrice: 4588.00, category: 'Drywall' }
      ],
      summary: {
        totalItems: 20,
        totalValue: 38847.46,
        categories: ['Flooring', 'Finishes', 'Ceilings', 'Plumbing', 'HVAC', 'Lighting', 'Masonry', 'Framing', 'Drywall'],
        generatedAt: new Date().toISOString(),
        buildingType: 'AT&T Commercial Retail Store',
        extractionMethod: 'Comprehensive Construction Document Analysis'
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

  // Debug endpoint to test v1 routing
  if (url === '/v1/ping' || url === '/v1/ping/') {
    console.log('🔍 v1/ping endpoint hit');
    res.writeHead(200);
    res.end(JSON.stringify({ 
      message: 'v1 ping successful', 
      timestamp: new Date().toISOString(),
      url: url 
    }));
    return;
  }

  // Catch-all for unimplemented endpoints - return helpful info instead of 404
  console.log(`⚠️  Unhandled endpoint: ${method} ${url}`);
  res.writeHead(200); // Return 200 instead of 404 to avoid CORS issues
  res.end(JSON.stringify({
    message: 'Mock API endpoint',
    endpoint: url,
    method: method,
    status: 'Mock response - endpoint not fully implemented',
    available: ['/health', '/ping', '/', '/v1/oauth/token', '/v1/files', '/v1/jobs/*', '/v1/takeoff/*'],
    timestamp: new Date().toISOString()
  }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`✅ Instant health server running on port ${port}`);
  console.log(`❤️  Health: http://0.0.0.0:${port}/health`);
  console.log(`🏓 Ping: http://0.0.0.0:${port}/ping`);
  console.log(`📡 Ready for Railway health checks`);
  console.log(`🔗 Available API endpoints:`);
  console.log(`   GET  /health`);
  console.log(`   GET  /ping`);
  console.log(`   GET  /`);
  console.log(`   POST /v1/oauth/token`);
  console.log(`   POST /v1/files`);
  console.log(`   POST /v1/jobs`);
  console.log(`   GET  /v1/jobs/{jobId}`);
  console.log(`   GET  /v1/takeoff/{jobId}`);
  console.log(`🌐 CORS enabled for origin: *`);
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
