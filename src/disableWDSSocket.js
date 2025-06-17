// This script disables webpack-dev-server WebSocket connections
// to prevent conflicts with Socket.IO

console.log('Disabling webpack-dev-server WebSocket connections...');

// Execute immediately when script is loaded
(function disableWDSSocket() {
  // Override the WebSocket constructor for webpack-dev-server
  const originalWebSocket = window.WebSocket;
  
  window.WebSocket = function(url, protocols) {
    // Block webpack-dev-server WebSocket connections
    if (url.includes('/ws') && (url.includes('localhost:3001') || url.includes('127.0.0.1:3001'))) {
      console.log(`Blocked WebSocket connection to ${url}`);
      // Return a mock WebSocket that does nothing
      return {
        send: () => {},
        close: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      };
    }
    
    // Allow all other WebSocket connections (like Socket.IO)
    return new originalWebSocket(url, protocols);
  };
  
  // Copy over static properties
  Object.keys(originalWebSocket).forEach(key => {
    window.WebSocket[key] = originalWebSocket[key];
  });
  
  console.log('webpack-dev-server WebSocket connections disabled');
})();