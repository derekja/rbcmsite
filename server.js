const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const socketIo = require('socket.io');
const { exec } = require('child_process');
const AWS = require('aws-sdk');
const { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } = require('@aws-sdk/client-bedrock-runtime');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001; // Use port 3001 for API server to avoid conflict with React dev server

// Configure AWS SDK
AWS.config.update({ region: 'us-east-1' });
const BEDROCK_RUNTIME_ENDPOINT = 'bedrock-runtime.us-east-1.amazonaws.com';

// Initialize AWS v3 Bedrock client with default credentials
const bedrockRuntime = new BedrockRuntimeClient({
  region: 'us-east-1',
  endpoint: BEDROCK_RUNTIME_ENDPOINT
});

// Enable CORS for development with specific options
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'], // Allow requests from React dev server
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add CORS headers manually for all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Add request logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Parse JSON request bodies with increased limit for audio data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Active WebSocket connections and their state
const activeSessions = new Map();

// Serve static files from the React build
app.use(express.static(path.join(__dirname, 'build')));

// Explicitly serve images from public/images
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// API routes can be added here
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Add a test POST endpoint
app.post('/api/test', (req, res) => {
  console.log('POST request received at /api/test:', req.body);
  res.json({ status: 'POST request received', body: req.body });
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

// Images are handled by the download script during build/start
// so we don't need a separate endpoint for checking updates

// Server-side proxy for AWS Bedrock/Nova Sonic
app.post('/api/nova-sonic', (req, res) => {
  try {
    console.log('Received request to /api/nova-sonic endpoint');
    const { audioBase64, prompt, conversationHistory } = req.body;
    
    if (!audioBase64) {
      console.log('Missing audioBase64 in request');
      return res.status(400).json({ error: 'No audio data provided' });
    }
    
    console.log('Audio data received, length:', audioBase64.length);
    console.log('Prompt:', prompt);
    console.log('Conversation history length:', conversationHistory ? conversationHistory.length : 0);
    
    // Mock response with a simple "beep" sound in base64-encoded WAV format
    const mockAudioWAV = 'UklGRpQMAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YXAMAAAAEhIsNEteaXqElaOxvcrY5O/8/vz57unf0MS2p5iKem9dTDwpFwT16uDVy8C2rKKZkIh/d29nYFpUTkpHQ0A/PkA/QURITVJYXmRqcXd9g4iOk5icn6KlqKqsrq6vr66tqqijnaGXjIJ4b2VaT0Q5LSEWCv3x5t3Uz8rFwb26uLW0srGwsLCxsrS2uLu9wMPGyczQ09bb3+Lm6ezv8vX3+vv9/v7+/Pv59/Xz8e/t6+rn5uTj4uHh4eLj4+Tl5+jq6+3u8PHz9PX29/j5+vr6+vr5+fj39/b29fX19fT09PT09PX19fb2+Pj5+vv8/f3+/v7+/v38+/r5+Pf29PT08/Py8vHx8fHx8fHx8vLz8/T19fb3+Pn6+/z9/v7+/v38+/r5+Pf29fTz8vHw7+7t7ezs6+vr6+vr6+zs7e3u7/Dx8vP09fb3+Pn6+/z8/f3+/v7+/v7+/v7+/v7+/f39/Pz7+/r6+fj39/b19PTz8/Ly8fHw8O/v7+/u7u7u7u7u7u7v7+/v8PDw8fHx8vPz9PT19fb29/f4+Pn5+vr7+/v8/Pz9/f39/f3+/v7+/v7+/v7+/v7+/v7+/v39/f38/Pz7+/v6+vn5+fj4+Pf39/b29vX19fX09PT09PTz8/Pz8/Pz8/Pz8/T09PT19fX19vb29/f3+Pj4+fn6+vr7+/v8/Pz8/f39/f3+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/f39/f39/f38/Pz8/Pz7+/v7+/v6+vr6+vr6+vr5+fn5+fn5+fn5+fn5+fn5+vr6+vr6+vr7+/v7+/v8/Pz8/Pz8/f39/f39/f39/f3+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f3+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+';
    
    // For simplicity, let's use a simple WAV audio that most browsers support
    return res.json({
      success: true,
      audioChunks: [mockAudioWAV], 
      textResponse: `Mock response: I received your audio message and prompt: "${prompt}"`
    });
    
  } catch (error) {
    console.error('Error processing Nova Sonic request:', error);
    return res.status(500).json({ 
      error: 'Error processing Nova Sonic request',
      message: error.message 
    });
  }
});

// Catch-all handler to serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// WebSocket event handlers for Nova Sonic streaming
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Initialize session state
  activeSessions.set(socket.id, {
    systemPrompt: "",
    isStreaming: false,
    responseStream: null,
    audioBuffer: [],
    transcribedText: "",
    sessionInitialized: false
  });

  // Handle system prompt
  socket.on('systemPrompt', (prompt) => {
    console.log('Received system prompt:', prompt);
    const session = activeSessions.get(socket.id);
    if (session) {
      session.systemPrompt = prompt;
    }
  });

  // Handle session initialization
  socket.on('promptStart', () => {
    console.log('Prompt start received from client');
    const session = activeSessions.get(socket.id);
    if (session) {
      session.sessionInitialized = true;
    }
  });

  // Handle audio start
  socket.on('audioStart', () => {
    console.log('Audio start received');
    const session = activeSessions.get(socket.id);
    if (session) {
      session.isStreaming = true;
      session.audioBuffer = [];
    }
  });

  // Handle audio input
  socket.on('audioInput', async (audioBase64) => {
    const session = activeSessions.get(socket.id);
    if (!session || !session.isStreaming) return;

    try {
      // Accumulate audio data
      session.audioBuffer.push(audioBase64);
      
      // Here we would normally stream to AWS Nova Sonic
      // For now, we'll use mock responses to demonstrate the flow
    } catch (error) {
      console.error('Error processing audio input:', error);
      socket.emit('error', { message: 'Audio processing error' });
    }
  });

  // Handle stop audio
  socket.on('stopAudio', async () => {
    console.log('Stop audio received');
    const session = activeSessions.get(socket.id);
    if (!session) return;

    session.isStreaming = false;
    
    try {
      // Mock content start for user transcription 
      socket.emit('contentStart', {
        type: 'TEXT',
        role: 'USER'
      });
      
      // Mock text output - in production this would be the transcribed audio
      const mockUserText = "This is a mock user transcription";
      socket.emit('textOutput', {
        role: 'USER',
        content: mockUserText
      });
      
      // Mock content end for user
      socket.emit('contentEnd', {
        type: 'TEXT',
        role: 'USER',
        stopReason: 'END_TURN'
      });
      
      // Mock assistant response start
      socket.emit('contentStart', {
        type: 'TEXT',
        role: 'ASSISTANT'
      });
      
      // Mock text output from assistant
      const mockResponse = "This is a mock response from the assistant about the RBCM object.";
      socket.emit('textOutput', {
        role: 'ASSISTANT',
        content: mockResponse
      });
      
      // Generate mock audio response
      const mockAudioWAV = 'UklGRpQMAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YXAMAAAAEhIsNEteaXqElaOxvcrY5O/8/vz57unf0MS2p5iKem9dTDwpFwT16uDVy8C2rKKZkIh/d29nYFpUTkpHQ0A/PkA/QURITVJYXmRqcXd9g4iOk5icn6KlqKqsrq6vr66tqqijnaGXjIJ4b2VaT0Q5LSEWCv3x5t3Uz8rFwb26uLW0srGwsLCxsrS2uLu9wMPGyczQ09bb3+Lm6ezv8vX3+vv9/v7+/Pv59/Xz8e/t6+rn5uTj4uHh4eLj4+Tl5+jq6+3u8PHz9PX29/j5+vr6+vr5+fj39/b29fX19fT09PT09PX19fb2+Pj5+vv8/f3+/v7+/v38+/r5+Pf29PT08/Py8vHx8fHx8fHx8vLz8/T19fb3+Pn6+/z9/v7+/v38+/r5+Pf29fTz8vHw7+7t7ezs6+vr6+vr6+zs7e3u7/Dx8vP09fb3+Pn6+/z8/f3+';
      
      socket.emit('audioOutput', {
        content: mockAudioWAV
      });
      
      // Mock content end for assistant
      socket.emit('contentEnd', {
        type: 'TEXT',
        role: 'ASSISTANT',
        stopReason: 'END_TURN'
      });
      
      // Signal stream completion
      socket.emit('streamComplete');
      
    } catch (error) {
      console.error('Error processing conversation:', error);
      socket.emit('error', { message: 'Conversation processing error' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Clean up session resources
    const session = activeSessions.get(socket.id);
    if (session && session.responseStream) {
      try {
        // Close any active streams
      } catch (e) {
        console.error('Error closing stream:', e);
      }
    }
    
    // Remove the session
    activeSessions.delete(socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`API Server with WebSockets running at http://localhost:${PORT}`);
  console.log(`Test the API with: curl http://localhost:${PORT}/api/health`);
});