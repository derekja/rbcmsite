const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { google } = require('googleapis');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Google Drive folder ID containing images
const GOOGLE_DRIVE_FOLDER_ID = '1YXGb80tWNxMb1gZ31n-JT8aqjyMi1SZX';

// Parse command line arguments
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check-only');

// Metadata file path to store information about downloaded files
const METADATA_PATH = path.join(__dirname, '../public/images/metadata.json');

// Helper function to read the metadata file
function readMetadata() {
  try {
    if (fs.existsSync(METADATA_PATH)) {
      const data = fs.readFileSync(METADATA_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading metadata file:', error.message);
  }
  return {};
}

// Helper function to write the metadata file
function writeMetadata(metadata) {
  try {
    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error('Error writing metadata file:', error.message);
  }
}

// Helper function to calculate file hash
function calculateFileHash(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    console.error(`Error calculating hash for ${filePath}:`, error.message);
    return null;
  }
}

// Function to validate if the file is a supported image format
function isValidImageFile(file) {
  // List of supported image MIME types
  const supportedImageTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/bmp', 'image/webp', 'image/tiff', 'image/svg+xml'
  ];
  
  // Check if the mime type is supported
  if (!file.mimeType) {
    console.warn(`File ${file.name} has no mime type specified`);
    return false;
  }
  
  // Check if it's a valid image type
  if (!supportedImageTypes.includes(file.mimeType)) {
    console.warn(`File ${file.name} has unsupported mime type: ${file.mimeType}`);
    return false;
  }
  
  // Check if the file name is valid
  if (!file.name || typeof file.name !== 'string') {
    console.warn(`File has invalid name:`, file);
    return false;
  }
  
  // Check for file extensions
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];
  const hasValidExtension = validExtensions.some(ext => 
    file.name.toLowerCase().endsWith(ext)
  );
  
  if (!hasValidExtension) {
    console.warn(`File ${file.name} has no valid image extension`);
    return false;
  }
  
  return true;
}

// Function to list files in the Google Drive folder
async function listFiles() {
  try {
    console.log('Listing files in Google Drive folder...');
    
    // Use API key for authentication
    const drive = google.drive({
      version: 'v3',
      auth: process.env.REACT_APP_GOOGLE_API_KEY
    });
    
    console.log('Using Google API Key:', process.env.REACT_APP_GOOGLE_API_KEY.substring(0, 10) + '...');
    
    // List all files in folder (not just restricting to images in the query)
    // We'll filter them ourselves to be safer
    const res = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents`,
      fields: 'files(id, name, mimeType, modifiedTime, size)',
      pageSize: 100,
    });
    
    let files = res.data.files || [];
    
    // Log all files for debugging
    console.log('All files found in folder:');
    files.forEach(file => console.log(`- ${file.name} (${file.mimeType})`));
    
    // Filter out non-image files
    const imageFiles = files.filter(file => isValidImageFile(file));
    
    console.log(`Found ${imageFiles.length} valid image files out of ${files.length} total files`);
    return imageFiles;
  } catch (error) {
    console.error('Error listing files:', error.message);
    throw error;
  }
}

// Function to check if a file needs to be downloaded (new or modified)
async function checkFileNeedsUpdate(fileId, fileName, modifiedTime) {
  try {
    const metadata = readMetadata();
    const filePath = path.join(__dirname, '../public/images', fileName);
    
    // If file doesn't exist locally, it needs to be downloaded
    if (!fs.existsSync(filePath)) {
      return true;
    }
    
    // If we have no metadata for this file, it needs to be updated
    if (!metadata[fileId]) {
      return true;
    }
    
    // If the modification time is different, the file has been updated
    if (metadata[fileId].modifiedTime !== modifiedTime) {
      return true;
    }
    
    // Check if the local file hash matches what we expect
    const currentHash = calculateFileHash(filePath);
    if (currentHash !== metadata[fileId].hash) {
      return true;
    }
    
    // File doesn't need to be updated
    return false;
  } catch (error) {
    console.error(`Error checking if ${fileName} needs update:`, error.message);
    // If in doubt, update the file
    return true;
  }
}

// Function to validate downloaded data to ensure it's actually an image
async function validateImageData(data, fileName) {
  try {
    // Check for minimum file size (at least 100 bytes)
    if (!data || data.length < 100) {
      console.warn(`File ${fileName} is too small (${data ? data.length : 0} bytes) to be a valid image`);
      return false;
    }
    
    // Check for common image file signatures/magic numbers
    const headerBytes = data.slice(0, 12); // Get first 12 bytes to check signatures
    const byteArray = new Uint8Array(headerBytes);
    
    // JPEG signature: starts with bytes FF D8
    const isJpeg = byteArray[0] === 0xFF && byteArray[1] === 0xD8;
    
    // PNG signature: starts with bytes 89 50 4E 47 0D 0A 1A 0A
    const isPng = byteArray[0] === 0x89 && byteArray[1] === 0x50 && 
                 byteArray[2] === 0x4E && byteArray[3] === 0x47 &&
                 byteArray[4] === 0x0D && byteArray[5] === 0x0A &&
                 byteArray[6] === 0x1A && byteArray[7] === 0x0A;
    
    // GIF signature: starts with "GIF87a" or "GIF89a"
    const isGif = (byteArray[0] === 0x47 && byteArray[1] === 0x49 && byteArray[2] === 0x46 &&
                 byteArray[3] === 0x38 && (byteArray[4] === 0x37 || byteArray[4] === 0x39) &&
                 byteArray[5] === 0x61);

    // BMP signature: starts with "BM"
    const isBmp = byteArray[0] === 0x42 && byteArray[1] === 0x4D;
    
    // Check if any signature matches
    if (!(isJpeg || isPng || isGif || isBmp)) {
      // If the file doesn't have a standard image header, log and reject
      console.warn(`File ${fileName} doesn't have a valid image signature`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error validating image data for ${fileName}:`, error.message);
    return false;
  }
}

// Function to download a file from Google Drive
async function downloadFile(fileId, fileName, modifiedTime) {
  try {
    // Sanitize filename to ensure it's safe
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (sanitizedFileName !== fileName) {
      console.log(`Sanitized filename from '${fileName}' to '${sanitizedFileName}'`);
      fileName = sanitizedFileName;
    }
    
    // Check if the file needs to be updated
    const needsUpdate = await checkFileNeedsUpdate(fileId, fileName, modifiedTime);
    if (!needsUpdate) {
      console.log(`Skipping ${fileName} - already up to date`);
      return null;
    }
    
    console.log(`Downloading ${fileName}...`);
    
    // Try multiple methods to download the file
    // Method 1: Using the Google Drive API export method
    try {
      const drive = google.drive({
        version: 'v3',
        auth: process.env.REACT_APP_GOOGLE_API_KEY
      });
      
      // Get file metadata first to determine the right approach
      const fileMetadata = await drive.files.get({
        fileId: fileId,
        fields: 'mimeType,name,size'
      });
      
      console.log(`File mime type: ${fileMetadata.data.mimeType}, size: ${fileMetadata.data.size || 'unknown'} bytes`);
      
      // Make sure it's an image file type
      if (!fileMetadata.data.mimeType || !fileMetadata.data.mimeType.includes('image/')) {
        console.warn(`Skipping ${fileName} - not an image file (${fileMetadata.data.mimeType})`);
        return null;
      }
      
      // Download the file (for images, just use direct media download)
      const response = await drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      // Convert ArrayBuffer to Buffer if needed
      const responseData = Buffer.from(response.data);
      
      // Validate that the downloaded data is actually an image
      const isValidImage = await validateImageData(responseData, fileName);
      if (!isValidImage) {
        console.error(`Downloaded file ${fileName} failed image validation - skipping`);
        return null;
      }
      
      // Save file to disk
      const filePath = path.join(__dirname, '../public/images', fileName);
      fs.writeFileSync(filePath, responseData);
      
      // Update metadata
      const metadata = readMetadata();
      const fileHash = calculateFileHash(filePath);
      metadata[fileId] = {
        fileName,
        modifiedTime,
        hash: fileHash,
        lastUpdated: new Date().toISOString()
      };
      writeMetadata(metadata);
      
      console.log(`Downloaded ${fileName} successfully`);
      return filePath;
    } catch (apiError) {
      // If API method fails, try the direct URL method
      console.warn(`API download failed, trying alternative method: ${apiError.message}`);
      
      // Method 2: Using a direct URL
      const url = `https://drive.google.com/uc?id=${fileId}&export=download`;
      
      // Add header to handle the "Confirm download?" page
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });
      
      // Convert response data to Buffer if needed
      const responseBuffer = Buffer.from(response.data);
      
      // Validate that the downloaded data is actually an image
      const isValidImage = await validateImageData(responseBuffer, fileName);
      if (!isValidImage) {
        console.error(`Downloaded file ${fileName} failed image validation - skipping`);
        return null;
      }
      
      // Save file to disk
      const filePath = path.join(__dirname, '../public/images', fileName);
      fs.writeFileSync(filePath, responseBuffer);
      
      // Update metadata
      const metadata = readMetadata();
      const fileHash = calculateFileHash(filePath);
      metadata[fileId] = {
        fileName,
        modifiedTime,
        hash: fileHash,
        lastUpdated: new Date().toISOString()
      };
      writeMetadata(metadata);
      
      console.log(`Downloaded ${fileName} successfully (alternative method)`);
      return filePath;
    }
  } catch (error) {
    console.error(`Error downloading file ${fileName}:`, error.message);
    return null; // Return null instead of throwing to continue with other files
  }
}

// Create a JSON manifest of downloaded files
function createManifest(files) {
  // Filter out any invalid or null files
  const validFiles = files.filter(file => file && file.id && file.name);
  
  // Generate manifest entries with sanitized filenames
  const manifest = validFiles.map(file => {
    // Sanitize filename (same logic as in downloadFile)
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    // Remove file extension for the name field (used for matching)
    const nameWithoutExtension = sanitizedFileName.replace(/\.[^/.]+$/, "");
    
    return {
      id: file.id,
      name: nameWithoutExtension,
      localPath: `/images/${sanitizedFileName}`,
      mimeType: file.mimeType || 'unknown'
    };
  });
  
  const manifestPath = path.join(__dirname, '../public/images/manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Created manifest with ${manifest.length} entries at ${manifestPath}`);
  
  return manifest;
}

// Main function to download all files
async function downloadAllFiles() {
  try {
    console.log('Starting image download process...');
    console.log('Environment check:');
    console.log('- NODE_ENV:', process.env.NODE_ENV);
    console.log('- Google API Key exists:', !!process.env.REACT_APP_GOOGLE_API_KEY);
    console.log('- Google Drive Folder ID:', GOOGLE_DRIVE_FOLDER_ID);
    console.log('- Check only mode:', CHECK_ONLY);
    
    // Create images directory if it doesn't exist
    const imagesDir = path.join(__dirname, '../public/images');
    if (!fs.existsSync(imagesDir)) {
      console.log(`Creating images directory: ${imagesDir}`);
      fs.mkdirSync(imagesDir, { recursive: true });
    } else {
      console.log(`Images directory already exists: ${imagesDir}`);
    }
    
    // Create metadata file if it doesn't exist
    if (!fs.existsSync(METADATA_PATH)) {
      console.log('Creating initial metadata file');
      writeMetadata({});
    }
    
    // Get list of files
    console.log('Fetching file list from Google Drive...');
    let files = [];
    try {
      files = await listFiles();
    } catch (listError) {
      console.error('Error listing files:', listError.message);
      // Continue with an empty file list - will use existing files if any
      files = [];
    }
    
    if (files.length === 0) {
      console.warn('No valid image files found in the Google Drive folder');
      
      // Check if we have any existing files
      const existingFiles = fs.readdirSync(imagesDir).filter(f => 
        !f.startsWith('.') && f !== 'manifest.json' && f !== 'metadata.json'
      );
      
      if (existingFiles.length === 0) {
        console.error('No existing image files found either');
        createManifest([]); // Create empty manifest
        return false;
      } else {
        console.log(`Using ${existingFiles.length} existing image files`);
        // Create a basic manifest from existing files
        const fallbackFiles = existingFiles.map((filename, index) => ({
          id: `local-${index}`,
          name: filename,
          mimeType: 'image/unknown'
        }));
        createManifest(fallbackFiles);
        return false;
      }
    }
    
    console.log(`Found ${files.length} valid image files in Google Drive folder`);
    
    // Check which files need to be updated
    let updatedCount = 0;
    const allFiles = [...files]; // Keep track of all files for the manifest
    
    // Download each file that needs updating
    for (const file of files) {
      // Skip download if we're just checking and the file already exists
      const filePath = path.join(imagesDir, file.name.replace(/[^a-zA-Z0-9_.-]/g, '_'));
      const fileExists = fs.existsSync(filePath);
      
      if (CHECK_ONLY && fileExists) {
        console.log(`File ${file.name} exists locally, skipping in check-only mode`);
        continue;
      }
      
      // Pass the modifiedTime to the download function
      const downloadResult = await downloadFile(file.id, file.name, file.modifiedTime);
      
      if (downloadResult) {
        updatedCount++;
      }
    }
    
    // Create manifest of all files (including those that weren't updated)
    createManifest(allFiles);
    
    if (updatedCount > 0) {
      console.log(`Download process complete. Updated ${updatedCount} out of ${files.length} files.`);
    } else {
      console.log('All files are already up to date. No downloads needed.');
    }
    
    console.log(`Images are available in ${imagesDir}`);
    return updatedCount > 0; // Return true if any files were updated
  } catch (error) {
    console.error('Fatal error in download process:', error.message);
    // Try to create empty manifest even if the process fails
    try {
      const imagesDir = path.join(__dirname, '../public/images');
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }
      createManifest([]);
    } catch (manifestError) {
      console.error('Additionally failed to create empty manifest:', manifestError.message);
    }
    // Don't exit - just return false
    return false;
  }
}

// Run the download script
async function main() {
  try {
    const updated = await downloadAllFiles();
    console.log('Download process finished, updated:', updated);
    // Only exit with error code in check-only mode if successful
    if (CHECK_ONLY) {
      // Exit with 0 for success (no matter if updated or not),
      // Only use non-zero for actual errors
      console.log('Check-only mode completed successfully');
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    // Let the program finish normally anyway
    console.error('Continuing despite error');
  }
}

main();