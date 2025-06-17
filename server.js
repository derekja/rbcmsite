const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const { fromIni } = require('@aws-sdk/credential-providers');
const { randomUUID } = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001", "*"],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type"]
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const AWS_PROFILE_NAME = process.env.AWS_PROFILE || 'bedrock-test';
// Force us-east-1 region for Bedrock Nova Sonic model availability
const AWS_REGION = 'us-east-1';

// Enable CORS for development
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Serve static files from the React build
app.use(express.static(path.join(__dirname, 'build')));

// Explicitly serve images from public/images
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// API routes can be added here
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// API endpoint to list images in the images directory
app.get('/api/list-images', (req, res) => {
  try {
    const imagesDir = path.join(__dirname, 'public/images');
    if (!fs.existsSync(imagesDir)) {
      return res.status(404).json({ error: 'Images directory not found' });
    }
    
    // Read files in the directory
    const files = fs.readdirSync(imagesDir);
    
    // Filter to only include image files (exclude manifest, metadata, etc)
    const imageFiles = files.filter(file => {
      // Skip hidden files, directories, and known non-image files
      if (file.startsWith('.') || 
          file === 'manifest.json' || 
          file === 'metadata.json') {
        return false;
      }
      
      // Check if it has an image extension
      const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];
      return validExtensions.some(ext => file.toLowerCase().endsWith(ext));
    });
    
    return res.json(imageFiles);
  } catch (error) {
    console.error('Error listing images directory:', error);
    return res.status(500).json({ error: 'Failed to list images' });
  }
});

// Define paths to use for importing client modules
const clientModulePath = path.join(__dirname, 'src', 'components', 'nova-sonic');

// Serve key client JS files that may be needed
app.get('/nova-sonic-client.js', (req, res) => {
  res.sendFile(path.join(clientModulePath, 'NovaSonicClient.js'));
});

app.get('/audio-player.js', (req, res) => {
  res.sendFile(path.join(clientModulePath, 'AudioPlayer.js'));
});

app.get('/chat-history-manager.js', (req, res) => {
  res.sendFile(path.join(clientModulePath, 'ChatHistoryManager.js'));
});

app.get('/types.js', (req, res) => {
  res.sendFile(path.join(clientModulePath, 'types.js'));
});

// Import Nova Sonic client dynamically
let NovaSonicBidirectionalStreamClient, DefaultSystemPrompt;
try {
  const serverClient = require('./src/components/nova-sonic/server-client');
  NovaSonicBidirectionalStreamClient = serverClient.NovaSonicBidirectionalStreamClient;
  
  // Also import the types
  const types = require('./src/components/nova-sonic/types');
  DefaultSystemPrompt = types.DefaultSystemPrompt;
  
  console.log('Successfully imported Nova Sonic client and types');
} catch (error) {
  console.error('Error importing Nova Sonic client:', error);
}

// Create the AWS Bedrock client
let bedrockClient;
try {
  console.log('Initializing AWS Bedrock client...');
  console.log(`AWS Region: ${AWS_REGION}`);
  console.log(`AWS Profile: ${AWS_PROFILE_NAME}`);
  
  bedrockClient = new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
      maxConcurrentStreams: 10,
      requestTimeout: 300000, // 5 minutes
      connectionTimeout: 300000 // 5 minutes
    },
    clientConfig: {
      region: AWS_REGION,
      credentials: fromIni({ profile: AWS_PROFILE_NAME })
    }
  });
  
  // Log available methods for debugging
  console.log('AWS Bedrock client initialized successfully');
  console.log('Available methods on bedrockClient:', 
    Object.getOwnPropertyNames(Object.getPrototypeOf(bedrockClient))
      .filter(method => typeof bedrockClient[method] === 'function')
  );
} catch (error) {
  console.error('Error initializing AWS Bedrock client:', error);
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack
  });
}

// Periodically check for and close inactive sessions (every minute)
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  if (!bedrockClient) return;
  
  console.log("Session cleanup check");
  const now = Date.now();

  // Check all active sessions
  bedrockClient.getActiveSessions().forEach(sessionId => {
    const lastActivity = bedrockClient.getLastActivityTime(sessionId);

    // If no activity for timeout period, force close
    if (now - lastActivity > SESSION_TIMEOUT) {
      console.log(`Closing inactive session ${sessionId} after ${SESSION_TIMEOUT/60000} minutes of inactivity`);
      try {
        bedrockClient.forceCloseSession(sessionId);
      } catch (error) {
        console.error(`Error force closing inactive session ${sessionId}:`, error);
      }
    }
  });
}, 60000);

// Set up detailed Socket.IO event logging
io.engine.on('connection', (rawSocket) => {
  console.log(`Raw Socket.IO connection established (transport: ${rawSocket.transport.name})`);
  
  // Log transport upgrade events
  rawSocket.on('upgrading', (transport) => {
    console.log(`Socket upgrading from ${rawSocket.transport.name} to ${transport}`);
  });
  
  rawSocket.on('upgrade', (transport) => {
    console.log(`Socket upgraded from ${rawSocket.transport.name} to ${transport}`);
  });
  
  rawSocket.on('error', (err) => {
    console.error(`Raw socket error:`, err);
  });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  console.log(`Transport used: ${socket.conn.transport.name}`);
  
  // Log socket ID so we can match client and server logs
  console.log(`Socket ID: ${socket.id}`);
  
  if (!bedrockClient) {
    console.error('AWS Bedrock client not initialized');
    socket.emit('error', { message: 'AWS Bedrock client not initialized' });
    return;
  }

  // Register all incoming event listeners for debugging
  const originalOn = socket.on;
  socket.on = function(event, listener) {
    console.log(`Registering listener for event: ${event}`);
    return originalOn.call(this, event, function() {
      console.log(`Received event ${event} with args:`, Array.from(arguments).slice(0, 1));
      return listener.apply(this, arguments);
    });
  };
  
  // Create a unique session ID for this client
  const sessionId = socket.id;

  try {
    console.log(`Creating stream session for: ${sessionId}`);
    // Create session with the Nova Sonic client
    const session = bedrockClient.createStreamSession(sessionId);
    console.log(`Stream session created for: ${sessionId}`);
    
    // We'll initiate the session later after setting up event handlers
    // DON'T call bedrockClient.initiateSession(sessionId) yet

    // Log active connections every minute
    const connectionInterval = setInterval(() => {
      const connectionCount = Object.keys(io.sockets.sockets).length;
      console.log(`Active socket connections: ${connectionCount}`);
    }, 60000);

    // Set up event handlers
    session.onEvent('contentStart', (data) => {
      console.log('contentStart:', data);
      socket.emit('contentStart', data);
    });

    session.onEvent('textOutput', (data) => {
      console.log('Text output:', data);
      socket.emit('textOutput', data);
    });

    session.onEvent('audioOutput', (data) => {
      console.log('Audio output received, sending to client');
      socket.emit('audioOutput', data);
    });

    session.onEvent('error', (data) => {
      console.error('Error in session:', data);
      socket.emit('error', data);
    });

    session.onEvent('toolUse', (data) => {
      console.log('Tool use detected:', data.toolName);
      socket.emit('toolUse', data);
    });

    session.onEvent('toolResult', (data) => {
      console.log('Tool result received');
      socket.emit('toolResult', data);
    });

    session.onEvent('contentEnd', (data) => {
      console.log('Content end received: ', data);
      socket.emit('contentEnd', data);
    });

    session.onEvent('streamComplete', () => {
      console.log('Stream completed for client:', socket.id);
      socket.emit('streamComplete');
    });

    // Handle audio input from client
    let audioPacketsReceived = 0;
    let lastAudioLog = Date.now();
    
    socket.on('audioInput', async (audioData) => {
      try {
        audioPacketsReceived++;
        
        // Log audio packet receipt periodically
        const now = Date.now();
        if (now - lastAudioLog > 5000) {
          console.log(`Received ${audioPacketsReceived} audio packets in last 5 seconds for session ${sessionId}`);
          lastAudioLog = now;
          audioPacketsReceived = 0;
        }
        
        // Convert base64 string to Buffer
        const audioBuffer = typeof audioData === 'string'
          ? Buffer.from(audioData, 'base64')
          : Buffer.from(audioData);
        
        // Debug first few audio packets
        if (audioPacketsReceived < 3) {
          console.log(`Audio packet ${audioPacketsReceived} size: ${audioBuffer.length} bytes`);
          // Log first few bytes for debugging
          if (audioBuffer.length > 0) {
            console.log(`Audio data sample: ${audioBuffer.slice(0, 10).toString('hex')}`);
          }
        }

        // Stream the audio
        await session.streamAudio(audioBuffer);

      } catch (error) {
        console.error('Error processing audio:', error);
        socket.emit('error', {
          message: 'Error processing audio',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Initialize the session sequence when client's ready
    socket.on('initSession', async (data, acknowledge) => {
      try {
        console.log(`==== INITIALIZING FULL SESSION SEQUENCE FOR ${sessionId} ====`);
        
        // Acknowledge receipt of the event if the client provided a callback
        if (typeof acknowledge === 'function') {
          acknowledge({ received: true });
          console.log('Sent acknowledgement to client');
        }
        
        // Check if we have a valid prompt
        if (!data || (!data.prompt && !DefaultSystemPrompt)) {
          const errorMsg = 'No prompt received and no default prompt available';
          console.error(errorMsg);
          socket.emit('error', { message: errorMsg });
          return;
        }
        
        const systemPrompt = data?.prompt || DefaultSystemPrompt;
        console.log('Prompt received:', systemPrompt.substring(0, 50) + '...');
        
        console.log('Session current state:', {
          active: bedrockClient.isSessionActive(sessionId)
        });
        
        // First call initiateSession to create the bidirectional stream with AWS Bedrock
        console.log('1. Creating bidirectional stream with AWS Bedrock');
        try {
          console.log('   Attempting to create bidirectional stream...');
          
          // Make sure the session exists in bedrockClient
          if (!bedrockClient.isSessionActive(sessionId)) {
            console.log('   Session not active, asking if it exists in client...');
            // Log methods available on bedrockClient for debugging
            console.log('   Available methods on bedrockClient:', 
              Object.getOwnPropertyNames(Object.getPrototypeOf(bedrockClient))
                .filter(method => typeof bedrockClient[method] === 'function')
            );
          }
          
          await bedrockClient.initiateSession(sessionId);
          console.log('   bidirectional stream created successfully');
        } catch (err) {
          console.error('Error creating bidirectional stream:', err);
          // Add more detailed diagnostic info
          console.error('Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack,
            code: err.code
          });
          socket.emit('error', {
            message: 'Failed to create bidirectional stream',
            details: err instanceof Error ? err.message : String(err)
          });
          return;
        }
        
        // Allow time for initialization to complete
        console.log('2. Waiting for stream to stabilize (1000ms)');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Setup required sequence for Nova Sonic
        console.log('3. Setting up promptStart event');
        try {
          await session.setupPromptStart();
          console.log('   promptStart event setup complete');
        } catch (err) {
          console.error('Error setting up promptStart:', err);
          socket.emit('error', {
            message: 'Failed to setup promptStart',
            details: err instanceof Error ? err.message : String(err)
          });
          return;
        }
        
        // Use custom prompt if provided, otherwise use default
        console.log('4. Setting up systemPrompt:', systemPrompt.substring(0, 50) + '...');
        try {
          await session.setupSystemPrompt(undefined, systemPrompt);
          console.log('   systemPrompt setup complete');
        } catch (err) {
          console.error('Error setting up systemPrompt:', err);
          socket.emit('error', {
            message: 'Failed to setup systemPrompt',
            details: err instanceof Error ? err.message : String(err)
          });
          return;
        }
        
        // Setup audio content to receive user's speech
        console.log('5. Setting up audioStart event');
        try {
          await session.setupStartAudio();
          console.log('   audioStart event setup complete');
        } catch (err) {
          console.error('Error setting up audioStart:', err);
          socket.emit('error', {
            message: 'Failed to setup audioStart',
            details: err instanceof Error ? err.message : String(err)
          });
          return;
        }
        
        console.log('6. Full initialization sequence complete!');
        
        // Signal client that initialization is complete
        socket.emit('sessionInitialized', { 
          success: true,
          sessionId: sessionId
        });
        console.log('Sent sessionInitialized event to client');
        
      } catch (error) {
        console.error('Error initializing session sequence:', error);
        socket.emit('error', {
          message: 'Failed to initialize session sequence',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Keep individual handlers for debugging/manual calls
    socket.on('promptStart', async () => {
      try {
        console.log('Prompt start received');
        await session.setupPromptStart();
      } catch (error) {
        console.error('Error processing prompt start:', error);
        socket.emit('error', {
          message: 'Error processing prompt start',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on('systemPrompt', async (data) => {
      try {
        console.log('System prompt received', data);
        await session.setupSystemPrompt(undefined, data);
      } catch (error) {
        console.error('Error processing system prompt:', error);
        socket.emit('error', {
          message: 'Error processing system prompt',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on('audioStart', async (data) => {
      try {
        console.log('Audio start received', data);
        await session.setupStartAudio();
      } catch (error) {
        console.error('Error processing audio start:', error);
        socket.emit('error', {
          message: 'Error processing audio start',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on('stopAudio', async () => {
      try {
        console.log('Stop audio requested, beginning proper shutdown sequence');

        // Chain the closing sequence
        await Promise.all([
          session.endAudioContent()
            .then(() => session.endPrompt())
            .then(() => session.close())
            .then(() => console.log('Session cleanup complete'))
        ]);
      } catch (error) {
        console.error('Error processing streaming end events:', error);
        socket.emit('error', {
          message: 'Error processing streaming end events',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log('Client disconnected abruptly:', socket.id);
      clearInterval(connectionInterval);

      if (bedrockClient && bedrockClient.isSessionActive(sessionId)) {
        try {
          console.log(`Beginning cleanup for abruptly disconnected session: ${socket.id}`);

          // Add explicit timeouts to avoid hanging promises
          const cleanupPromise = Promise.race([
            (async () => {
              await session.endAudioContent();
              await session.endPrompt();
              await session.close();
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Session cleanup timeout')), 3000)
            )
          ]);

          await cleanupPromise;
          console.log(`Successfully cleaned up session after abrupt disconnect: ${socket.id}`);
        } catch (error) {
          console.error(`Error cleaning up session after disconnect: ${socket.id}`, error);
          try {
            bedrockClient.forceCloseSession(sessionId);
            console.log(`Force closed session: ${sessionId}`);
          } catch (e) {
            console.error(`Failed even force close for session: ${sessionId}`, e);
          } finally {
            // Make sure socket is fully closed in all cases
            if (socket.connected) {
              socket.disconnect(true);
            }
          }
        }
      }
    });

  } catch (error) {
    console.error('Error creating session:', error);
    socket.emit('error', {
      message: 'Failed to initialize session',
      details: error instanceof Error ? error.message : String(error)
    });
    socket.disconnect();
  }
});

// Catch-all handler to serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to access the application`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  const forceExitTimer = setTimeout(() => {
    console.error('Forcing server shutdown after timeout');
    process.exit(1);
  }, 5000);

  try {
    // First close Socket.IO server which manages WebSocket connections
    await new Promise(resolve => io.close(resolve));
    console.log('Socket.IO server closed');

    // Then close all active sessions
    if (bedrockClient) {
      const activeSessions = bedrockClient.getActiveSessions();
      console.log(`Closing ${activeSessions.length} active sessions...`);

      await Promise.all(activeSessions.map(async (sessionId) => {
        try {
          await bedrockClient.closeSession(sessionId);
          console.log(`Closed session ${sessionId} during shutdown`);
        } catch (error) {
          console.error(`Error closing session ${sessionId} during shutdown:`, error);
          bedrockClient.forceCloseSession(sessionId);
        }
      }));
    }

    // Now close the HTTP server with a promise
    await new Promise(resolve => server.close(resolve));
    clearTimeout(forceExitTimer);
    console.log('Server shut down');
    process.exit(0);
  } catch (error) {
    console.error('Error during server shutdown:', error);
    process.exit(1);
  }
});