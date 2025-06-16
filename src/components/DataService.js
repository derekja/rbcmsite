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
    console.log('DataService initialized with:');
    console.log('Google Drive Folder ID:', this.gDriveFolderId);
    console.log('Google Sheet ID:', this.gSheetId);
    console.log('API Key available:', !!process.env.REACT_APP_GOOGLE_API_KEY);
    
    // Try to load from localStorage
    this.loadFromLocalStorage();
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
        const response = await fetch(manifestPath);
        
        if (!response.ok) {
          throw new Error(`Failed to load image manifest: ${response.status} ${response.statusText}`);
        }
        
        const manifest = await response.json();
        console.log(`Loaded ${manifest.length} images from manifest file`);
        
        // Convert manifest to the format we need
        return manifest.map((item, index) => ({
          id: index + 1,
          name: item.name,
          imageUrl: item.localPath
        }));
      } catch (manifestError) {
        console.error('Error loading manifest:', manifestError);
        
        // If manifest loading fails, try to scan the images directory
        console.log('Attempting to scan images directory directly...');
        
        // This is a fallback that manually creates map from available image files
        // We just need to list all image files in the /public/images directory
        const imageFiles = [
          "Ancestral_Drum.jpg", 
          "Woolly_Mammoth_Tusk.jpg", 
          "Gold_Rush_Pan.jpg", 
          "Indigenous_Mask.jpg", 
          "Pioneer_Quilt.jpg", 
          "Ancient_Fossil.jpg", 
          "Chinese_Lantern.jpg", 
          "Logging_Equipment.jpg", 
          "First_Nations_Basket.jpg", 
          "HMS_Discovery_Model.jpg", 
          "Totem_Pole.jpg", 
          "Railway_Spike.jpg"
        ];
        
        return imageFiles.map((fileName, index) => {
          // Convert filename to name (remove extension and replace underscores with spaces)
          const name = fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
          
          return {
            id: index + 1,
            name: name,
            imageUrl: `/images/${fileName}`
          };
        });
      }
    } catch (error) {
      console.error('Error fetching images:', error);
      throw error;
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
      console.log('Fetched images:', images);
      console.log('Fetched prompts:', prompts);
      
      // Match images with prompts by name
      this.objects = prompts.map(prompt => {
        // Find matching image by comparing names (with normalization)
        const promptName = prompt.objectName.trim();
        const matchingImage = images.find(img => {
          // Normalize names for comparison (remove spaces, lowercase)
          const imgNameNormalized = img.name.toLowerCase().replace(/\s+/g, '');
          const promptNameNormalized = promptName.toLowerCase().replace(/\s+/g, '');
          
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