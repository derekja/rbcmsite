const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Images are handled by the download script during build/start
// so we don't need a separate endpoint for checking updates

// Catch-all handler to serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});