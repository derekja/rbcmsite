import express from 'express';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import http from 'http';
import { Server } from 'socket.io';
import { fromIni } from '@aws-sdk/credential-providers';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { NovaSonicBidirectionalStreamClient, StreamSession } from './src/client';
import { DefaultSystemPrompt } from './src/consts';

dotenv.config();

// Log AWS configuration for debugging
console.log('AWS Configuration:');
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_DEFAULT_REGION:', process.env.AWS_DEFAULT_REGION);
console.log('AWS_PROFILE:', process.env.AWS_PROFILE);
console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '****' + process.env.AWS_ACCESS_KEY_ID.substring(-4) : 'not set');
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? 'exists' : 'not set');
console.log('AWS_SESSION_TOKEN:', process.env.AWS_SESSION_TOKEN ? 'exists' : 'not set');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001", "*"],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000, // Increase ping timeout to 60 seconds
  pingInterval: 25000  // Ping interval to 25 seconds
});

const PORT = process.env.PORT || 3000;
// Check for AWS credentials in environment variables first, then fallback to profile
const AWS_PROFILE_NAME = process.env.AWS_PROFILE || 'bedrock-test';
const HAS_ENV_CREDENTIALS = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
// Force us-east-1 region for Bedrock Nova Sonic model availability
const AWS_REGION = 'us-east-1';

console.log('Using credentials strategy:', HAS_ENV_CREDENTIALS ? 'Environment Variables' : `AWS Profile (${AWS_PROFILE_NAME})`);

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

// Create the AWS Bedrock client
let bedrockClient: NovaSonicBidirectionalStreamClient;
try {
  console.log('Initializing AWS Bedrock client...');
  console.log(`AWS Region: ${AWS_REGION}`);
  console.log(`AWS Profile: ${AWS_PROFILE_NAME}`);
  console.log('FORCING us-east-1 for Nova Sonic regardless of environment settings');
  
  // Get credentials based on what's available
  let credentials;
  
  if (HAS_ENV_CREDENTIALS) {
    console.log('Using AWS credentials from environment variables');
    // When using environment variables, credentials are automatically loaded
    credentials = undefined; // Let AWS SDK use env vars automatically
  } else {
    console.log(`Retrieving credentials from profile: ${AWS_PROFILE_NAME}`);
    credentials = fromIni({ profile: AWS_PROFILE_NAME });
    
    // Verify the credentials can be resolved
    console.log('Verifying credentials from profile...');
    credentials()
      .then(creds => {
        console.log('✅ Credentials verified successfully!');
        console.log(`Access key ID starts with: ${creds.accessKeyId.substring(0, 4)}...`); 
        console.log(`Secret key exists: ${!!creds.secretAccessKey}`);
        console.log(`Session token exists: ${!!creds.sessionToken}`);
      })
      .catch(err => {
        console.error('❌ Failed to verify credentials:', err);
      });
  }
  
  // Create client config based on credential strategy
  const clientConfig: any = {
    region: 'us-east-1' // HARDCODED - Nova Sonic only available in us-east-1
  };
  
  // Only add credentials if using profile (not needed for env vars)
  if (!HAS_ENV_CREDENTIALS && credentials) {
    clientConfig.credentials = credentials;
  }
  
  bedrockClient = new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
      maxConcurrentStreams: 10,
      requestTimeout: 300000, // 5 minutes
      sessionTimeout: 300000 // 5 minutes
    },
    clientConfig
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
    name: error instanceof Error ? error.name : 'Unknown',
    message: error instanceof Error ? error.message : String(error)
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
io.engine.on('connection', (rawSocket: any) => {
  console.log(`Raw Socket.IO connection established (transport: ${rawSocket.transport.name})`);
  
  // Log transport upgrade events
  rawSocket.on('upgrading', (transport: string) => {
    console.log(`Socket upgrading from ${rawSocket.transport.name} to ${transport}`);
  });
  
  rawSocket.on('upgrade', (transport: string) => {
    console.log(`Socket upgraded from ${rawSocket.transport.name} to ${transport}`);
  });
  
  rawSocket.on('error', (err: Error) => {
    console.error(`Raw socket error:`, err);
  });
});

// Track all active sessions for debugging
interface SessionInfo {
  createdAt: Date;
  socketId: string;
}

declare global {
  var activeSessions: Map<string, SessionInfo>;
}

if (!global.activeSessions) {
  global.activeSessions = new Map<string, SessionInfo>();
}

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
  socket.on = function(event: string, listener: (...args: any[]) => void) {
    console.log(`Registering listener for event: ${event}`);
    return originalOn.call(this, event, function() {
      console.log(`Received event ${event} with args:`, Array.from(arguments).slice(0, 1));
      return listener.apply(this, arguments);
    });
  };
  
  // Create a unique session ID for this client
  const sessionId = socket.id;
  console.log(`Creating session with ID: ${sessionId}, socket ID: ${socket.id}`);
  
  global.activeSessions.set(sessionId, { createdAt: new Date(), socketId: socket.id });
  console.log(`Active sessions: ${global.activeSessions.size}`);
  global.activeSessions.forEach((session, id) => {
    console.log(`  - Session ${id}: created at ${session.createdAt}, socket ID: ${session.socketId}`);
  });
  
  // Declare session variable at a higher scope so it can be modified later
  let streamSession: StreamSession;

  try {
    console.log(`Creating stream session for: ${sessionId}`);
    // Create session with the Nova Sonic client
    streamSession = bedrockClient.createStreamSession(sessionId);
    console.log(`Stream session created for: ${sessionId}`);

    // Log active connections every minute
    const connectionInterval = setInterval(() => {
      const connectionCount = Object.keys(io.sockets.sockets).length;
      console.log(`Active socket connections: ${connectionCount}`);
    }, 60000);

    // Set up event handlers
    streamSession.onEvent('contentStart', (data) => {
      console.log('contentStart:', data);
      socket.emit('contentStart', data);
    });

    streamSession.onEvent('textOutput', (data) => {
      console.log('Text output:', data);
      socket.emit('textOutput', data);
    });

    streamSession.onEvent('audioOutput', (data) => {
      console.log('Audio output received, sending to client');
      socket.emit('audioOutput', data);
    });

    streamSession.onEvent('error', (data) => {
      console.error('Error in session:', data);
      socket.emit('error', data);
    });

    streamSession.onEvent('toolUse', (data) => {
      console.log('Tool use detected:', data.toolName);
      socket.emit('toolUse', data);
    });

    streamSession.onEvent('toolResult', (data) => {
      console.log('Tool result received');
      socket.emit('toolResult', data);
    });

    streamSession.onEvent('contentEnd', (data) => {
      console.log('Content end received: ', data);
      socket.emit('contentEnd', data);
    });

    streamSession.onEvent('streamComplete', () => {
      console.log('Stream completed for client:', socket.id);
      socket.emit('streamComplete');
    });

    // Handle audio input from client
    let audioPacketsReceived = 0;
    let lastAudioLog = Date.now();
    
    socket.on('audioInput', async (audioData: string | Buffer) => {
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
        await streamSession.streamAudio(audioBuffer);

      } catch (error) {
        console.error('Error processing audio:', error);
        socket.emit('error', {
          message: 'Error processing audio',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Initialize the session sequence when client's ready
    socket.on('initSession', async (data: any, acknowledge?: (response: any) => void) => {
      try {
        console.log(`==== INITIALIZING FULL SESSION SEQUENCE FOR ${sessionId} ====`);
        
        // Check if we have a valid prompt
        if (!data || (!data.prompt && !DefaultSystemPrompt)) {
          const errorMsg = 'No prompt received and no default prompt available';
          console.error(errorMsg);
          socket.emit('error', { message: errorMsg });
          return;
        }
        
        const systemPrompt = data?.prompt || DefaultSystemPrompt;
        console.log('Prompt received:', systemPrompt.substring(0, 50) + '...');
        
        // Create a new session with custom system prompt
        console.log('Creating stream session with custom system prompt');
        if (bedrockClient.isSessionActive(sessionId)) {
          try {
            // Close any existing session first
            console.log('Cleaning up existing session before creating new one');
            await streamSession.endAudioContent().catch(e => console.log('No audio to end:', e.message));
            await streamSession.endPrompt().catch(e => console.log('No prompt to end:', e.message));
            await streamSession.close().catch(e => console.log('Error closing session:', e.message));
          } catch (e) {
            console.log('Error during cleanup:', e instanceof Error ? e.message : String(e));
          }
        }
        
        // Create a new session with fresh state
        streamSession = bedrockClient.createStreamSession(sessionId);
        
        // Re-register event handlers for the new session
        streamSession.onEvent('contentStart', (data) => {
          console.log('contentStart:', data);
          socket.emit('contentStart', data);
        });

        streamSession.onEvent('textOutput', (data) => {
          console.log('Text output:', data);
          socket.emit('textOutput', data);
        });

        streamSession.onEvent('audioOutput', (data) => {
          console.log('Audio output received, sending to client');
          socket.emit('audioOutput', data);
        });

        streamSession.onEvent('error', (data) => {
          console.error('Error in session:', data);
          socket.emit('error', data);
        });

        streamSession.onEvent('toolUse', (data) => {
          console.log('Tool use detected:', data.toolName);
          socket.emit('toolUse', data);
        });

        streamSession.onEvent('toolResult', (data) => {
          console.log('Tool result received');
          socket.emit('toolResult', data);
        });

        streamSession.onEvent('contentEnd', (data) => {
          console.log('Content end received: ', data);
          socket.emit('contentEnd', data);
        });

        streamSession.onEvent('streamComplete', () => {
          console.log('Stream completed for client:', socket.id);
          socket.emit('streamComplete');
        });
        
        // First call initiateSession to create the bidirectional stream with AWS Bedrock
        console.log('1. Creating bidirectional stream with AWS Bedrock');
        try {
          // Send a custom system prompt by setting it BEFORE initiateSession
          console.log('Setting custom system prompt for session');
          bedrockClient.setCustomSystemPrompt(sessionId, systemPrompt);
          
          // This initiateSession call does the following in sequence:
          // 1. Sets up sessionStart event
          // 2. Sets up promptStart event
          // 3. Sets up systemPrompt event (using the custom prompt)
          // 4. Sets up audioContentStart event
          // 5. Creates bidirectional stream with AWS Bedrock
          await bedrockClient.initiateSession(sessionId);
          console.log('Bidirectional stream created successfully');
        } catch (err) {
          console.error('Error creating bidirectional stream:', err);
          // Add more detailed diagnostic info
          console.error('Error details:', {
            name: err instanceof Error ? err.name : 'Unknown',
            message: err instanceof Error ? err.message : String(err)
          });
          socket.emit('error', {
            message: 'Failed to create bidirectional stream',
            details: err instanceof Error ? err.message : String(err)
          });
          return;
        }
        
        // Signal client that initialization is complete
        setTimeout(() => {
          if (acknowledge) {
            acknowledge({ success: true });
          }
          socket.emit('sessionInitialized', { 
            success: true,
            sessionId: sessionId
          });
          console.log('Sent sessionInitialized event to client');
        }, 0);
        
      } catch (error) {
        console.error('Error initializing session sequence:', error);
        socket.emit('error', {
          message: 'Failed to initialize session sequence',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on('stopAudio', async () => {
      try {
        console.log('Stop audio requested, beginning proper shutdown sequence');

        // CRITICAL: Sequence matters here - must follow the exact sequence from the samples
        // First end audio content
        console.log('1. Ending audio content');
        await streamSession.endAudioContent();
        
        // Small pause between operations to ensure proper sequencing
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Then end the prompt
        console.log('2. Ending prompt');
        await streamSession.endPrompt();
        
        // Small pause between operations
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Finally close the session
        console.log('3. Closing session');
        await streamSession.close();
        
        console.log('Session cleanup complete');
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
              // CRITICAL: Must follow exact sequence: endAudioContent → endPrompt → close
              try {
                console.log('1. Ending audio content after disconnect');
                await streamSession.endAudioContent();
                // Wait a moment to ensure API processes the request
                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (e) {
                console.warn('Error ending audio content:', e instanceof Error ? e.message : String(e));
              }
              
              try {
                console.log('2. Ending all prompts after disconnect');
                await streamSession.endPrompt();
                // Wait a moment to ensure API processes the request
                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (e) {
                console.warn('Error ending prompts:', e instanceof Error ? e.message : String(e));
              }
              
              try {
                console.log('3. Closing session after disconnect');
                await streamSession.close();
              } catch (e) {
                console.warn('Error closing session:', e instanceof Error ? e.message : String(e));
              }
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Session cleanup timeout')), 5000)
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
    await new Promise<void>(resolve => io.close(resolve));
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
    await new Promise<void>(resolve => server.close(resolve));
    clearTimeout(forceExitTimer);
    console.log('Server shut down');
    process.exit(0);
  } catch (error) {
    console.error('Error during server shutdown:', error);
    process.exit(1);
  }
});