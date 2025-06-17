/**
 * AudioPlayer class for handling real-time audio playback
 * Manages the Web Audio API context and audio processing
 */
export class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.outputNode = null;
    this.gainNode = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.audioSourceNode = null;
    this.isStarted = false;
  }

  /**
   * Initialize the Web Audio API context and nodes
   */
  async start() {
    try {
      if (this.isStarted) {
        return;
      }

      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0; // Full volume
      
      // Connect gain node to audio context destination (speakers)
      this.gainNode.connect(this.audioContext.destination);
      
      this.isStarted = true;
      console.log("AudioPlayer initialized successfully");
      
    } catch (error) {
      console.error("Error starting AudioPlayer:", error);
      throw error;
    }
  }

  /**
   * Stop audio playback and release resources
   */
  stop() {
    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.stop();
        this.audioSourceNode.disconnect();
      } catch (e) {
        console.warn("Error stopping audio source:", e);
      }
      this.audioSourceNode = null;
    }
    
    this.isPlaying = false;
    this.audioQueue = [];
  }
  
  /**
   * Interrupt current speech (for barge-in functionality)
   */
  bargeIn() {
    this.stop();
  }

  /**
   * Process and play audio data
   * @param {Float32Array} audioData - Float32Array of audio samples
   */
  async playAudio(audioData) {
    if (!this.isStarted) {
      await this.start();
    }
    
    try {
      // Create an audio buffer from the Float32Array data
      const audioBuffer = this.audioContext.createBuffer(1, audioData.length, this.audioContext.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      
      // Copy data to the channel
      channelData.set(audioData);
      
      // Create a buffer source node
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      
      // Connect to the gain node
      sourceNode.connect(this.gainNode);
      
      // Store the source node
      this.audioSourceNode = sourceNode;
      
      // Start playback
      sourceNode.start();
      this.isPlaying = true;
      
      // When audio finishes playing
      sourceNode.onended = () => {
        this.isPlaying = false;
        this.audioSourceNode = null;
      };
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  }

  /**
   * Process and play audio from base64 encoded PCM data
   * @param {string} base64Audio - Base64 encoded audio data
   */
  async playBase64Audio(base64Audio) {
    try {
      const audioData = this.base64ToFloat32Array(base64Audio);
      return this.playAudio(audioData);
    } catch (error) {
      console.error("Error processing base64 audio:", error);
    }
  }
  
  /**
   * Convert base64 string to Float32Array for audio playback
   * @param {string} base64String - Base64 encoded audio data
   * @returns {Float32Array} Audio data as Float32Array
   */
  base64ToFloat32Array(base64String) {
    try {
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Ensure the buffer length is a multiple of 2 for Int16Array
      const paddedLength = bytes.length + (bytes.length % 2);
      const paddedBuffer = new ArrayBuffer(paddedLength);
      const paddedBytes = new Uint8Array(paddedBuffer);
      paddedBytes.set(bytes);

      const int16Array = new Int16Array(paddedBuffer);
      const float32Array = new Float32Array(int16Array.length);
      
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0; // Convert Int16 to normalized Float32
      }

      return float32Array;
    } catch (error) {
      console.error('Error in base64ToFloat32Array:', error);
      throw error;
    }
  }
}