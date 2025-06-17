import axios from 'axios';

// API endpoint for Nova Sonic proxy
const NOVA_SONIC_API_ENDPOINT = 'http://localhost:3001/api/nova-sonic';

// This is a placeholder service for AWS Nova Sonic integration
class NovaSonicService {
  constructor() {
    // Store conversation contexts by object ID
    this.conversationContexts = new Map();
    console.log('NovaSonicService initialized - using server proxy mode');
  }

  // No initialization needed for proxy mode

  // Start a conversation with Nova Sonic using server-side proxy
  async startConversation(prompt, audioInput, objectId) {
    try {
      console.log('Starting conversation with Nova Sonic (Server Proxy)');
      console.log('Using prompt:', prompt);
      console.log('Audio input received, processing...');
      
      // If no conversation exists for this object, initialize a new one
      if (!this.conversationContexts.has(objectId)) {
        this.conversationContexts.set(objectId, {
          systemPrompt: prompt,
          messages: []
        });
        console.log('Initialized new conversation context for object:', objectId);
      }
      
      const context = this.conversationContexts.get(objectId);
      
      // Process audio input through WebAudio API to get the right format
      const processedAudioInput = await this.processAudioForNovaSonic(audioInput);
      
      // Convert audio blob to base64
      const arrayBuffer = await processedAudioInput.arrayBuffer();
      const audioBase64 = this._arrayBufferToBase64(arrayBuffer);
      
      // Format conversation history for the API
      const conversationHistory = context.messages.map(msg => ({
        userMessage: msg.userText || 'User audio input',
        botMessage: msg.botResponse || ''
      }));
      
      // Make the API call to the server proxy
      console.log('Sending request to server proxy...');
      const response = await axios.post(NOVA_SONIC_API_ENDPOINT, {
        audioBase64,
        prompt: context.systemPrompt,
        conversationHistory
      }, {
        timeout: 60000, // 60 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Received response from server proxy');
      
      // Extract the data from the response
      const { success, audioChunks, textResponse } = response.data;
      
      if (!success || !audioChunks || audioChunks.length === 0) {
        throw new Error('Invalid response from server proxy');
      }
      
      // Determine audio type by checking first few characters
      const firstChunk = audioChunks[0] || '';
      let audioType = 'audio/mp3';  // Default type
      
      // Check the header signature of the first chunk (base64)
      const headerCheck = firstChunk.substring(0, 10);
      console.log('Audio header signature:', headerCheck);
      
      if (headerCheck.startsWith('SUQz')) {
        audioType = 'audio/mpeg';  // ID3 - MP3 format
        console.log('Detected MP3 format audio');
      } else if (headerCheck.startsWith('UklG')) {
        audioType = 'audio/wav';   // RIFF - WAV format
        console.log('Detected WAV format audio');
      } else {
        console.log('Unknown audio format, using MP3 as default');
      }
      
      // Combine all audio chunks into a single audio blob
      // Convert base64 strings to binary data for Blob
      const audioData = audioChunks.map(chunk => {
        try {
          // Decode base64 string to binary data
          const binaryString = window.atob(chunk);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes.buffer;
        } catch (error) {
          console.error('Error decoding base64 audio chunk:', error);
          return new ArrayBuffer(0); // Return empty buffer for invalid chunks
        }
      }).filter(buffer => buffer.byteLength > 0); // Filter out empty buffers
      
      if (audioData.length === 0) {
        throw new Error('No valid audio data received');
      }
      
      console.log('Creating audio blob of type:', audioType, 'with', audioData.length, 'chunks');
      const audioBlob = new Blob(audioData, { type: audioType });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Add this exchange to the conversation context
      context.messages.push({
        userAudio: URL.createObjectURL(audioInput),
        userText: 'User audio input', // In production, we would transcribe this
        botResponse: textResponse,
        botAudio: audioUrl,
        timestamp: new Date()
      });
      
      // Update the conversation context in our map
      this.conversationContexts.set(objectId, context);
      
      // Return the response data
      return {
        audioResponse: audioUrl,
        textResponse: textResponse || 'Response received but no text was provided'
      };
      
    } catch (error) {
      console.error('Error in Nova Sonic conversation:', error);
      throw error;
    }
  }
  
  // Helper method to process audio for Nova Sonic
  async processAudioForNovaSonic(audioBlob) {
    try {
      // Convert audio to the format expected by Nova Sonic
      // This is a placeholder - in a real implementation you would:
      // 1. Convert the audio to PCM 16-bit, 16kHz, mono format
      // 2. Convert to the appropriate binary format for the API
      // 3. Return the processed audio
      
      // For now, we'll just return the audioBlob as is
      // In production, you'd need proper audio processing
      return audioBlob;
    } catch (error) {
      console.error('Error processing audio for Nova Sonic:', error);
      throw error;
    }
  }
  
  // Helper method to convert ArrayBuffer to base64
  _arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

export default NovaSonicService;