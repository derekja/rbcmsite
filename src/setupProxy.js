const { createProxyMiddleware } = require('http-proxy-middleware');

// The WebSocket server runs on port 3000
const WEBSOCKET_SERVER_URL = 'http://localhost:3000';

module.exports = function(app) {
  console.log('Setting up proxy middleware for development');
  
  // Proxy socket.io requests to the WebSocket server
  app.use(
    '/socket.io',
    createProxyMiddleware({
      target: WEBSOCKET_SERVER_URL,
      ws: true, // Enable WebSocket proxying
      changeOrigin: true,
      logLevel: 'debug', // More verbose logging
      // Add timing options to match server
      onProxyReq: (proxyReq, req, res) => {
        // Log proxy requests for debugging
        console.log(`Proxying request: ${req.method} ${req.url}`);
      },
      // WebSocket proxy options
      websocket: {
        pingTimeout: 60000, // Match server timeout settings
        pingInterval: 25000 // Match server interval settings
      }
    })
  );
  
  // WebSocket for webpack-dev-server is now disabled via environment variables
  
  // Proxy API requests to the WebSocket server
  app.use(
    '/api',
    createProxyMiddleware({
      target: WEBSOCKET_SERVER_URL,
      changeOrigin: true,
    })
  );
  
  console.log(`Proxy configured: WebSocket and API requests will be forwarded to ${WEBSOCKET_SERVER_URL}`);
};