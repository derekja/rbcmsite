const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const AWS = require('aws-sdk');
const { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } = require('@aws-sdk/client-bedrock-runtime');

const app = express();
const PORT = process.env.PORT || 3001; // Use port 3001 for API server to avoid conflict with React dev server

// Configure AWS SDK
AWS.config.update({ region: 'us-east-1' });
const BEDROCK_RUNTIME_ENDPOINT = 'bedrock-runtime.us-east-1.amazonaws.com';

// Note: AWS credential configuration is commented out for now
// Configure AWS SDK v3 Bedrock client
// const bedrockRuntime = new BedrockRuntimeClient({
//   region: 'us-east-1',
//   endpoint: BEDROCK_RUNTIME_ENDPOINT
// });

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
    
    // Create a simple mock response for testing
    const mockAudio = 'UklGRiQEAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAEAAD//v/+'; // Tiny WAV sample
    
    // Send response immediately for testing
    return res.json({
      success: true,
      audioChunks: [mockAudio, mockAudio], // Send two chunks to test the client
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

// Start server
app.listen(PORT, () => {
  console.log(`API Server running at http://localhost:${PORT}`);
  console.log(`Test the API with: curl http://localhost:${PORT}/api/health`);
  console.log(`Nova Sonic endpoint available at: http://localhost:${PORT}/api/nova-sonic`);
});