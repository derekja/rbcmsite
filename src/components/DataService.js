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

  // Use hardcoded image URLs since we're having trouble with Google Drive API
  async fetchImages() {
    try {
      console.log('Using hardcoded image URLs instead of Google Drive API');
      
      // Hardcoded image URLs for each object
      // These are publicly accessible URLs that should work reliably
      return [
        { id: 1, name: "Ancestral Drum", imageUrl: "https://via.placeholder.com/300x200?text=Ancestral+Drum" },
        { id: 2, name: "Woolly Mammoth Tusk", imageUrl: "https://via.placeholder.com/300x200?text=Woolly+Mammoth+Tusk" },
        { id: 3, name: "Gold Rush Pan", imageUrl: "https://via.placeholder.com/300x200?text=Gold+Rush+Pan" },
        { id: 4, name: "Indigenous Mask", imageUrl: "https://via.placeholder.com/300x200?text=Indigenous+Mask" },
        { id: 5, name: "Pioneer Quilt", imageUrl: "https://via.placeholder.com/300x200?text=Pioneer+Quilt" },
        { id: 6, name: "Ancient Fossil", imageUrl: "https://via.placeholder.com/300x200?text=Ancient+Fossil" },
        { id: 7, name: "Chinese Lantern", imageUrl: "https://via.placeholder.com/300x200?text=Chinese+Lantern" },
        { id: 8, name: "Logging Equipment", imageUrl: "https://via.placeholder.com/300x200?text=Logging+Equipment" },
        { id: 9, name: "First Nations Basket", imageUrl: "https://via.placeholder.com/300x200?text=First+Nations+Basket" },
        { id: 10, name: "HMS Discovery Model", imageUrl: "https://via.placeholder.com/300x200?text=HMS+Discovery+Model" },
        { id: 11, name: "Totem Pole", imageUrl: "https://via.placeholder.com/300x200?text=Totem+Pole" },
        { id: 12, name: "Railway Spike", imageUrl: "https://via.placeholder.com/300x200?text=Railway+Spike" }
      ];
    } catch (error) {
      console.error('Error with hardcoded images:', error);
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
      console.log('Fetched images:', images);
      console.log('Fetched prompts:', prompts);
      
      // Match images with prompts by name
      this.objects = prompts.map(prompt => {
        // Find matching image by comparing names
        const promptName = prompt.objectName.trim();
        const matchingImage = images.find(img => {
          return img.name.toLowerCase() === promptName.toLowerCase();
        });
        
        // Use the image URL from our hardcoded images
        let imageUrl = 'https://via.placeholder.com/300x300?text=Image+Not+Found';
        if (matchingImage) {
          imageUrl = matchingImage.imageUrl;
          console.log(`Image for ${promptName}: ${imageUrl}`);
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