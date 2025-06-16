import axios from 'axios';

// Constants for Google API endpoints
const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// This service will handle fetching images and prompts from Google Drive and Sheets
class DataService {
  constructor() {
    this.gDriveFolderId = '1YXGb80tWNxMb1gZ31n-JT8aqjyMi1SZX';
    this.gSheetId = '1HzxaGN0f1mEg5Kz37q9glAca5Nc3R1yf70M1j59CpSE';
    this.objects = [];
    
    // API info for debugging
    console.log('DataService initialized');
    
    // Try to load from localStorage
    this.loadFromLocalStorage();
    
    // Just check if the manifest exists rather than trying to update it
    // This is more for validation than actual updates
    this.checkForImageUpdates();
  }
  
  // Check if manifest.json exists and has been updated recently
  async checkForImageUpdates() {
    try {
      console.log('Checking for image manifest...');
      
      // Just check if the manifest exists
      const manifestResponse = await fetch('/images/manifest.json', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (!manifestResponse.ok) {
        console.warn('Image manifest not found or not accessible');
        return;
      }
      
      try {
        const manifest = await manifestResponse.json();
        console.log(`Manifest contains ${manifest.length} images`);
      } catch (parseError) {
        console.warn('Could not parse manifest JSON:', parseError.message);
      }
    } catch (error) {
      // Just log the error but don't disrupt the app flow
      console.warn('Could not check for image updates:', error.message);
    }
  }
  
  // Load data from localStorage if available
  loadFromLocalStorage() {
    try {
      const savedObjects = localStorage.getItem('rbcmObjects');
      if (savedObjects) {
        this.objects = JSON.parse(savedObjects);
        console.log('Loaded objects from localStorage:', this.objects.length);
        return true;
      }
    } catch (error) {
      console.error('Error loading from localStorage:', error);
    }
    return false;
  }
  
  // Save data to localStorage
  saveToLocalStorage() {
    try {
      localStorage.setItem('rbcmObjects', JSON.stringify(this.objects));
      console.log('Saved objects to localStorage:', this.objects.length);
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }
  
  // Test if an image URL is accessible
  async testImageUrl(url) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      console.error('Error testing image URL:', url, error);
      return false;
    }
  }
  
  // Update a specific object's prompt
  updateObjectPrompt(objectId, newPrompt) {
    const objectIndex = this.objects.findIndex(obj => obj.id === objectId);
    if (objectIndex !== -1) {
      this.objects[objectIndex].prompt = newPrompt;
      this.saveToLocalStorage();
      return true;
    }
    return false;
  }
  
  // Get a specific object by ID
  getObjectById(objectId) {
    return this.objects.find(obj => obj.id === objectId);
  }

  // Fetch images from local manifest file (loaded from Google Drive images)
  async fetchImages() {
    try {
      console.log('Loading images from local manifest file');
      
      try {
        // Try to load image manifest created by downloadImages.js
        const manifestPath = '/images/manifest.json';
        const response = await fetch(manifestPath, {
          // Prevent caching issues
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to load image manifest: ${response.status} ${response.statusText}`);
        }
        
        // Use a try/catch specifically for JSON parsing
        let manifest;
        try {
          manifest = await response.json();
        } catch (jsonError) {
          console.error('Error parsing manifest JSON:', jsonError);
          throw new Error('Invalid manifest format');
        }
        console.log(`Loaded ${manifest.length} images from manifest file`);
        
        if (manifest.length === 0) {
          console.warn('Manifest file exists but contains no images');
          // Return empty array, will be handled by the calling code
          return [];
        }
        
        // Convert manifest to the format we need
        return manifest.map((item, index) => {
          // The manifest contains sanitized filenames (with underscores)
          // But display names should have spaces for better readability
          const displayName = item.name ? item.name.replace(/_/g, ' ') : `Object ${index + 1}`;
          
          // Keep the original localPath for the image URL since that's the actual file path
          return {
            id: index + 1,
            name: displayName,
            imageUrl: item.localPath || '/images/image-not-found.png'
          };
        });
      } catch (manifestError) {
        console.error('Error loading manifest:', manifestError);
        console.warn('Could not load image manifest. This usually happens when the download script fails.');
        console.warn('Make sure you have run: npm run download-images');
        
        // Instead of throwing error, try to check if any images exist directly
        console.log('Checking if any images exist directly...');
        
        try {
          // Request a directory listing (this will only work if the server supports it)
          const response = await fetch('/api/list-images');
          if (response.ok) {
            const imageList = await response.json();
            if (imageList && imageList.length > 0) {
              return imageList.map((fileName, index) => ({
                id: index + 1,
                name: fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
                imageUrl: `/images/${fileName}`
              }));
            }
          }
        } catch (listError) {
          console.error('Error listing images directory:', listError);
        }
        
        // If all attempts fail, return empty array
        console.warn('Could not load images. Returning empty array.');
        return [];
      }
    } catch (error) {
      console.error('Error fetching images:', error);
      // Return empty array instead of throwing
      return [];
    }
  }

  // Fetch prompts from Google Sheet
  async fetchPrompts() {
    try {
      console.log('Fetching prompts from Google Sheet:', this.gSheetId);
      
      // Make API call to Google Sheets
      const response = await axios.get(
        `${GOOGLE_SHEETS_API_BASE}/${this.gSheetId}/values/A1:D100`, {
          params: {
            key: process.env.REACT_APP_GOOGLE_API_KEY
          }
        }
      );
      
      const values = response.data.values || [];
      if (!values || values.length === 0) {
        throw new Error('No data returned from Google Sheets');
      }
      
      // Start reading from row 4 as specified and skip empty rows
      const startRow = 3; // 0-indexed, so row 4 is index 3
      
      // Filter out empty rows and process the valid data
      return values.slice(startRow)
        .filter(row => row && row.length >= 2 && row[0] && row[1]) // Ensure row has both name and prompt
        .map((row, index) => ({
        id: index + 1, // Sequential ID after filtering empty rows
        objectName: row[0],
        prompt: row[1]
      }));
    } catch (error) {
      console.error('Error fetching prompts from Google Sheets:', error);
      // Return fallback data if the API call fails
      return Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        objectName: `Object ${i+1}`,
        prompt: `This is a sample prompt for object ${i+1}. Ask me about this object's history and significance.`
      }));
    }
  }

  // Combine images and prompts into a single dataset
  async getObjectsData() {
    try {
      const images = await this.fetchImages();
      const prompts = await this.fetchPrompts();

      // Debug information
      console.log('Fetched images:', images.length);
      console.log('Fetched prompts:', prompts.length);
      
      // Match images with prompts by name
      this.objects = prompts.map(prompt => {
        // Find matching image by comparing names (with normalization)
        const promptName = prompt.objectName.trim();
        const matchingImage = images.find(img => {
          // Normalize names for comparison (remove spaces, special chars, lowercase)
          // Use a more aggressive normalization to handle Unicode characters
          const normalizeString = (str) => {
            return str.toLowerCase()
              .normalize('NFD')                // Normalize to decomposed form
              .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
              .replace(/[^a-z0-9]/g, '')       // Remove non-alphanumeric
              .trim();                          // Remove whitespace
          };
          
          const imgNameNormalized = normalizeString(img.name);
          const promptNameNormalized = normalizeString(promptName);
          
          // Try both exact match and contains match
          return imgNameNormalized === promptNameNormalized || 
                 imgNameNormalized.includes(promptNameNormalized) || 
                 promptNameNormalized.includes(imgNameNormalized);
        });
        
        // Use the image URL from our downloaded images
        let imageUrl = '/images/image-not-found.jpg'; // This will show a 404 if not available
        if (matchingImage) {
          imageUrl = matchingImage.imageUrl;
          console.log(`Found image match for ${promptName}: ${imageUrl}`);
        } else {
          console.warn(`No matching image found for: ${promptName}`);
        }
        
        return {
          id: prompt.id,
          googleId: matchingImage ? matchingImage.googleId : null,
          name: prompt.objectName,
          image: imageUrl,
          prompt: prompt.prompt,
          conversationHistory: [] // For tracking conversation with Nova Sonic
        };
      });
      
      // Save to localStorage for persistence between sessions
      this.saveToLocalStorage();
      
      return this.objects;
    } catch (error) {
      console.error('Error getting objects data:', error);
      throw error;
    }
  }
}

export default DataService;