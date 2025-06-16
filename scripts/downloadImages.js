const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Google Drive folder ID containing images
const GOOGLE_DRIVE_FOLDER_ID = '1YXGb80tWNxMb1gZ31n-JT8aqjyMi1SZX';

// Function to list files in the Google Drive folder
async function listFiles() {
  try {
    console.log('Listing files in Google Drive folder...');
    
    // Use API key for authentication
    const drive = google.drive({
      version: 'v3',
      auth: process.env.REACT_APP_GOOGLE_API_KEY
    });
    
    // List files in folder
    const res = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/'`,
      fields: 'files(id, name, mimeType)',
      pageSize: 100,
    });
    
    const files = res.data.files;
    console.log(`Found ${files.length} image files in Google Drive folder`);
    return files;
  } catch (error) {
    console.error('Error listing files:', error.message);
    throw error;
  }
}

// Function to download a file from Google Drive
async function downloadFile(fileId, fileName) {
  try {
    console.log(`Downloading ${fileName}...`);
    
    // Direct download URL for Google Drive files
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    // Make request to download file
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer'
    });
    
    // Save file to disk
    const filePath = path.join(__dirname, '../public/images', fileName);
    fs.writeFileSync(filePath, response.data);
    
    console.log(`Downloaded ${fileName} successfully`);
    return filePath;
  } catch (error) {
    console.error(`Error downloading file ${fileName}:`, error.message);
    throw error;
  }
}

// Create a JSON manifest of downloaded files
function createManifest(files) {
  const manifest = files.map(file => ({
    id: file.id,
    name: file.name.replace(/\.[^/.]+$/, ""), // Remove file extension for matching
    localPath: `/images/${file.name}`
  }));
  
  const manifestPath = path.join(__dirname, '../public/images/manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Created manifest at ${manifestPath}`);
  
  return manifest;
}

// Main function to download all files
async function downloadAllFiles() {
  try {
    // Create images directory if it doesn't exist
    const imagesDir = path.join(__dirname, '../public/images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    
    // Get list of files
    const files = await listFiles();
    
    if (files.length === 0) {
      console.error('No files found in the Google Drive folder');
      process.exit(1);
    }
    
    // Download each file
    for (const file of files) {
      try {
        await downloadFile(file.id, file.name);
      } catch (error) {
        console.error(`Failed to download ${file.name}. Continuing with next file.`);
      }
    }
    
    // Create manifest of all files (even if some failed to download)
    createManifest(files);
    
    console.log(`Download process complete. Check public/images directory.`);
  } catch (error) {
    console.error('Fatal error in download process:', error.message);
    process.exit(1);
  }
}

// Run the download script
downloadAllFiles().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});