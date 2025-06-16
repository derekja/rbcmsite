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

  // Fetch images from Google Drive
  async fetchImages() {
    try {
      console.log('Fetching images from Google Drive folder:', this.gDriveFolderId);
      
      // Make API call to Google Drive
      const response = await axios.get(
        `${GOOGLE_DRIVE_API_BASE}/files`, {
          params: {
            q: `'${this.gDriveFolderId}' in parents and mimeType contains 'image/'`,
            fields: 'files(id, name, webContentLink, thumbnailLink)',
            key: process.env.REACT_APP_GOOGLE_API_KEY
          }
        }
      );
      
      // Process and return the actual image data from Google Drive
      return response.data.files.map((file, index) => ({
        id: index + 1,
        googleId: file.id,
        name: file.name,
        imageUrl: file.thumbnailLink || file.webContentLink
      }));
    } catch (error) {
      console.error('Error fetching images from Google Drive:', error);
      // Return fallback data if the API call fails
      return Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        googleId: `error-fallback-${i+1}`,
        name: `Object ${i+1}`,
        imageUrl: `https://via.placeholder.com/300x300?text=Object+${i+1}`,
      }));
    }
  }

  // Fetch prompts from Google Sheet
  async fetchPrompts() {
    try {
      console.log('Fetching prompts from Google Sheet:', this.gSheetId);
      
      // Make API call to Google Sheets
      const response = await axios.get(
        `${GOOGLE_SHEETS_API_BASE}/${this.gSheetId}/values/A1:B100`, {
          params: {
            key: process.env.REACT_APP_GOOGLE_API_KEY
          }
        }
      );
      
      const values = response.data.values || [];
      if (!values || values.length === 0) {
        throw new Error('No data returned from Google Sheets');
      }
      
      // Skip the header row if it exists
      const startRow = values[0] && (values[0][0] === 'ID' || values[0][0] === 'Object') ? 1 : 0;
      
      // Process and return the actual prompt data from Google Sheets
      return values.slice(startRow).map((row, index) => ({
        id: index + 1,
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
      
      // Combine the data
      this.objects = images.map(img => {
        const matchingPrompt = prompts.find(p => p.id === img.id);
        return {
          id: img.id,
          googleId: img.googleId,
          name: matchingPrompt ? matchingPrompt.objectName : `Object ${img.id}`,
          image: img.imageUrl,
          prompt: matchingPrompt ? matchingPrompt.prompt : 'No prompt available for this object.',
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