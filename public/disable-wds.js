// This script runs before the app loads and disables webpack-dev-server WebSockets
(function() {
  // Store the original WebSocket
  var originalWebSocket = window.WebSocket;
  
  // Override WebSocket constructor
  window.WebSocket = function(url, protocols) {
    // Check if this is webpack-dev-server trying to connect
    if (url && typeof url === 'string' && 
        (url.includes('/ws') || url.includes('hot-update')) && 
        (url.includes('localhost:3001') || url.includes('127.0.0.1:3001'))) {
      console.log('Blocking webpack-dev-server WebSocket connection:', url);
      
      // Return a dummy WebSocket object
      return {
        url: url,
        readyState: 3, // CLOSED
        protocol: '',
        extensions: '',
        bufferedAmount: 0,
        binaryType: 'blob',
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3,
        onopen: null,
        onclose: null,
        onmessage: null,
        onerror: null,
        close: function(){},
        send: function(){},
        addEventListener: function(){},
        removeEventListener: function(){},
        dispatchEvent: function(){ return false; }
      };
    }
    
    // For any other WebSocket connections, use the original implementation
    return new originalWebSocket(url, protocols);
  };
  
  // Copy prototype and constants from original WebSocket
  window.WebSocket.prototype = originalWebSocket.prototype;
  window.WebSocket.CONNECTING = originalWebSocket.CONNECTING;
  window.WebSocket.OPEN = originalWebSocket.OPEN;
  window.WebSocket.CLOSING = originalWebSocket.CLOSING;
  window.WebSocket.CLOSED = originalWebSocket.CLOSED;
  
  console.log('webpack-dev-server WebSocket connections have been disabled');
})();