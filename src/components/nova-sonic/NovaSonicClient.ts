// Import socket.io-client library
import io from 'socket.io-client';
import type { Socket as SocketType } from 'socket.io-client';
import { AudioPlayer } from './AudioPlayer';
import { ChatHistoryManager } from './ChatHistoryManager';
import { DefaultSystemPrompt } from '../../consts';

type StatusType = 'connected' | 'ready' | 'recording' | 'processing' | 'receiving' | 'disconnected' | 'error' | 'initializing';
type CallbackFn = () => void;
type StatusCallbackFn = (status: StatusType) => void;
type DataCallbackFn<T> = (data: T) => void;

interface TextOutput {
  contentName?: string;
  content: string;
  role: string;
}

interface AudioOutput {
  contentName?: string;
  content: string;
}

interface ContentStart {
  contentName?: string;
  type?: string;
  role?: string;
}

interface ContentEnd {
  contentName?: string;
  type?: string;
}

interface ErrorData {
  message: string;
  details?: string;
  source?: string;
}

/**
 * Client for interacting with AWS Nova Sonic via websockets
 */
export class NovaSonicClient {
  private socket: any = null;
  private isConnected = false;
  private isListening = false;
  private isProcessing = false;
  private isInitialized = false;
  private currentSystemPrompt: string = DefaultSystemPrompt;
  private audioPlayer: AudioPlayer;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private audioStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private samplingRatio = 1;
  private TARGET_SAMPLE_RATE = 16000;
  private isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
  
  // Event callbacks
  private onConnectCallbacks: CallbackFn[] = [];
  private onDisconnectCallbacks: CallbackFn[] = [];
  private onStatusChangeCallbacks: StatusCallbackFn[] = [];
  private onAudioOutputCallbacks: DataCallbackFn<Float32Array>[] = [];
  private onTextOutputCallbacks: DataCallbackFn<TextOutput>[] = [];
  private onErrorCallbacks: DataCallbackFn<ErrorData>[] = [];

  constructor() {
    this.audioPlayer = new AudioPlayer();
  }

  /**
   * Initialize the connection to the server
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      console.log("Client already initialized");
      return true;
    }

    try {
      console.log("Initializing Nova Sonic client...");
      
      // Connect to the websocket server
      console.log("Connecting to socket.io server...");
      
      // Determine appropriate server URL based on environment
      // In development, the server always runs on port 3000
      let serverUrl = process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3000'
        : window.location.origin;
      
      console.log("Connecting to WebSocket server at:", serverUrl);
      console.log("Current environment:", process.env.NODE_ENV);
      
      // Try connection to the server with increased timeout
      this.socket = io(serverUrl, {
        transports: ['polling', 'websocket'], // Try polling first for better compatibility
        forceNew: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 30000, // Increase timeout to 30 seconds
        // Socket.io-client v4 changed the option names
        path: '/socket.io'
      } as any);
      
      console.log("Socket created, setting up event listeners");
      // Set up socket event listeners
      this.socket.on('connect', () => {
        console.log("Socket connected!");
        this.handleConnect();
      });
      this.socket.on('disconnect', () => this.handleDisconnect());
      this.socket.on('error', (data) => this.handleError(data));
      this.socket.on('contentStart', (data) => this.handleContentStart(data));
      this.socket.on('textOutput', (data) => this.handleTextOutput(data));
      this.socket.on('audioOutput', (data) => this.handleAudioOutput(data));
      this.socket.on('contentEnd', (data) => this.handleContentEnd(data));
      this.socket.on('streamComplete', () => this.handleStreamComplete());
      
      // Initialize audio player
      console.log("Initializing audio player...");
      await this.audioPlayer.start();
      console.log("Audio player initialized");
      
      // Initialize audio capture
      console.log("Initializing audio capture...");
      await this.initAudio();
      console.log("Audio capture initialized");
      
      this.isInitialized = true;
      console.log("Nova Sonic client fully initialized");
      return true;
    } catch (error) {
      console.error('Error initializing NovaSonic client:', error);
      this.notifyError({
        message: 'Failed to initialize NovaSonic client',
        details: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Initialize the audio recording components
   */
  async initAudio(): Promise<boolean> {
    try {
      console.log("Requesting microphone access...");
      // Try to get microphone permissions explicitly before creating the stream
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        .catch(err => {
          console.warn("Permissions API not supported, will try direct access:", err);
          return { state: "prompt" };
        });
      
      console.log("Microphone permission status:", permissionStatus.state);
      
      // Request microphone access with more detailed constraints
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: this.TARGET_SAMPLE_RATE,
          channelCount: 1
        }
      };
      
      console.log("Requesting audio stream with constraints:", constraints);
      this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log("Microphone access granted!");
      const audioTracks = this.audioStream.getAudioTracks();
      console.log("Audio tracks:", audioTracks.length);
      audioTracks.forEach((track, i) => {
        console.log(`Track ${i}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        console.log("Track settings:", track.getSettings());
      });
      
      // Initialize the AudioContext
      console.log("Creating AudioContext...");
      if (this.isFirefox) {
        // Firefox doesn't allow audio context have different sample rate than what the user media device offers
        this.audioContext = new AudioContext();
      } else {
        this.audioContext = new AudioContext({
          sampleRate: this.TARGET_SAMPLE_RATE
        });
      }
      
      // Resume the AudioContext if it's suspended (autoplay policy)
      if (this.audioContext.state === 'suspended') {
        console.log("AudioContext suspended, attempting to resume...");
        await this.audioContext.resume();
        console.log("AudioContext resumed:", this.audioContext.state);
      }
      
      // Sampling ratio is only relevant for Firefox
      this.samplingRatio = this.audioContext.sampleRate / this.TARGET_SAMPLE_RATE;
      console.log(`Debug AudioContext - sampleRate: ${this.audioContext.sampleRate}, state: ${this.audioContext.state}, samplingRatio: ${this.samplingRatio}`);

      // Test audio processing
      console.log("Testing audio processing capabilities...");
      const testSource = this.audioContext.createOscillator();
      const testProcessor = this.audioContext.createScriptProcessor 
        ? this.audioContext.createScriptProcessor(512, 1, 1)
        : null;
        
      if (testProcessor) {
        console.log("ScriptProcessor created successfully");
        testProcessor.onaudioprocess = (e) => {
          console.log("Audio processing test successful");
          testProcessor.disconnect();
          testSource.disconnect();
          testSource.stop();
          // Remove the handler after one call
          testProcessor.onaudioprocess = null;
        };
        testSource.connect(testProcessor);
        testProcessor.connect(this.audioContext.destination);
        testSource.start();
        testSource.stop(this.audioContext.currentTime + 0.1);
      } else {
        console.warn("ScriptProcessor not available, may have audio processing issues");
      }

      this.notifyStatus('ready');
      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      this.notifyError({
        message: 'Error accessing microphone',
        details: error instanceof Error ? error.message : String(error)
      });
      
      // Show a more user-friendly error message based on the error
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          this.notifyError({
            message: 'Microphone access denied',
            details: 'Please allow microphone access to use speech features'
          });
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          this.notifyError({
            message: 'No microphone found',
            details: 'Please connect a microphone to use speech features'
          });
        }
      }
      
      return false;
    }
  }

  /**
   * Initialize the session with the server
   * This connects to the server and sets up the Nova Sonic session
   */
  async initializeSession(systemPrompt?: string): Promise<boolean> {
    // Add a message to check AWS credentials first
    console.log("Checking AWS Bedrock connectivity...");
    // Note for developers: If this keeps timing out, verify your AWS credentials
    // and make sure you have access to the Nova Sonic model in us-east-1 region
    if (!this.socket) {
      console.error('Socket is null, cannot initialize session');
      this.notifyError({ message: 'Socket is not created' });
      return false;
    }

    if (!this.socket.connected) {
      console.error('Socket is not connected (state):', this.socket.connected);
      console.log('Attempting to reconnect...');
      
      // Try to reconnect
      try {
        await new Promise<void>((resolve, reject) => {
          if (this.socket && this.socket.connected) {
            resolve();
            return;
          }
          
          if (this.socket) {
            this.socket.connect();
            this.socket.once('connect', () => {
              console.log('Reconnected successfully!');
              resolve();
            });
            
            this.socket.once('connect_error', (err) => {
              console.error('Reconnection error:', err);
              reject(new Error(`Reconnection failed: ${err.message}`));
            });
          }
          
          setTimeout(() => {
            reject(new Error('Reconnection timed out after 5 seconds'));
          }, 5000);
        });
      } catch (error) {
        console.error('Failed to reconnect:', error);
        this.notifyError({ 
          message: 'Failed to connect to server', 
          details: error instanceof Error ? error.message : String(error) 
        });
        return false;
      }
    }

    this.notifyStatus('initializing');
    
    try {
      // Use provided system prompt or default
      const prompt = systemPrompt || this.currentSystemPrompt;
      this.currentSystemPrompt = prompt;
      
      // Log connection details for debugging
      console.log('Socket connection details:');
      if (this.socket) {
        console.log('- Connected:', this.socket.connected);
        console.log('- ID:', this.socket.id);
        if (this.socket.io && this.socket.io.engine && this.socket.io.engine.transport) {
          console.log('- Transport:', this.socket.io.engine.transport.name);
        }
      }

      // Use the unified initSession approach which is more reliable
      console.log("Using single initSession event for better reliability");
      
      // Send a single event with all the necessary information
      console.log("Emitting initSession event with prompt");
      
      // Wait for session initialization to complete
      return new Promise<boolean>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error('Socket is null, cannot initialize session'));
          return;
        }

        // Debug handlers with more information
        const debugHandler = (eventName: string) => (data: any) => {
          console.log(`[DEBUG] Received ${eventName} event:`, data);
        };
        
        // Add temporary debug listeners for multiple events
        this.socket.once('connect_error', debugHandler('connect_error'));
        this.socket.once('connect_timeout', debugHandler('connect_timeout'));
        this.socket.once('error', debugHandler('error'));
        this.socket.once('disconnect', debugHandler('disconnect'));
        
        // Wait for initialization confirmation
        this.socket.once('sessionInitialized', (data: { success?: boolean }) => {
          console.log('Session initialized successfully:', data);
          if (data && data.success) {
            clearTimeout(timeoutId);
            resolve(true);
          } else {
            console.error('Session initialization returned false success value');
            reject(new Error('Session initialization failed - server returned false'));
          }
        });
        
        // Also listen for contentStart as an alternative indicator that the session is ready
        this.socket.once('contentStart', (data: any) => {
          console.log('Received contentStart event, considering session initialized:', data);
          clearTimeout(timeoutId);
          resolve(true);
        });
        
        // Also listen for errors
        this.socket.once('error', (err: any) => {
          console.error('Error during session initialization:', err);
          clearTimeout(timeoutId); // Clear timeout on error
          reject(new Error(`Session initialization error: ${err.message || JSON.stringify(err)}`));
        });
        
        // Emit the initSession event
        this.socket.emit('initSession', { prompt });
        
        // Set timeout for initialization with a reasonable timeout
        const timeoutId = setTimeout(() => {
          console.error('Session initialization timed out after 15 seconds');
          if (this.socket) {
            console.log('Current socket state:', {
              connected: this.socket.connected,
              id: this.socket.id,
              transport: this.socket.io?.engine?.transport?.name || 'unknown'
            });
            
            // Make sure we remove all listeners
            this.socket.off('sessionInitialized');
            this.socket.off('contentStart');
            this.socket.off('error');
          }
          
          reject(new Error('Session initialization timed out'));
        }, 15000);
      });
    } catch (error) {
      console.error('Failed to initialize session:', error);
      this.notifyError({
        message: 'Error initializing session',
        details: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Start recording and streaming audio
   */
  async startListening(customPrompt: string | null = null): Promise<void> {
    if (this.isListening) {
      console.log("Already listening, ignoring startListening call");
      return;
    }
    
    try {
      // First, make sure the session is initialized
      console.log("Initializing session before starting audio...");
      
      // Use a timeout to prevent hanging forever
      const sessionInitializePromise = this.initializeSession(customPrompt || undefined);
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error("Session initialization timed out after 20 seconds")), 20000);
      });
      
      const sessionInitialized = await Promise.race([sessionInitializePromise, timeoutPromise])
        .catch(error => {
          console.error("Session initialization failed with error:", error);
          this.notifyError({
            message: 'Session initialization timeout or error',
            details: error instanceof Error ? error.message : String(error)
          });
          return false;
        });
      
      if (!sessionInitialized) {
        console.error("Session initialization failed, cannot start listening");
        this.notifyStatus('error');
        return;
      }
      
      // Wait a moment after session initialization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log("Session initialized successfully, setting up audio capture...");
      
      if (!this.audioStream || !this.audioContext) {
        throw new Error("Audio capture not initialized");
      }

      // Create audio processor
      this.sourceNode = this.audioContext.createMediaStreamSource(this.audioStream);
      console.log("Audio source node created");
      
      // Use ScriptProcessorNode for audio processing
      if (this.audioContext.createScriptProcessor) {
        console.log("Creating audio processor...");
        this.processor = this.audioContext.createScriptProcessor(512, 1, 1);
        
        let audioProcessCount = 0;
        let lastAudioLevelLog = Date.now();
        
        this.processor.onaudioprocess = (e) => {
          if (!this.isListening) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          const numSamples = Math.round(inputData.length / this.samplingRatio);
          const pcmData = this.isFirefox ? (new Int16Array(numSamples)) : (new Int16Array(inputData.length));
          
          // Detect audio levels
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          const db = 20 * Math.log10(rms);
          
          // Log audio levels every 1000ms
          const now = Date.now();
          if (now - lastAudioLevelLog > 1000) {
            console.log(`Audio input level: ${db.toFixed(2)} dB, RMS: ${rms.toFixed(6)}`);
            lastAudioLevelLog = now;
          }
          
          // Convert to 16-bit PCM
          if (this.isFirefox) {
            for (let i = 0; i < numSamples; i++) {
              // For Firefox, sample rate conversion is needed
              pcmData[i] = Math.max(-1, Math.min(1, inputData[Math.floor(i * this.samplingRatio)])) * 0x7FFF;
            }
          } else {
            for (let i = 0; i < inputData.length; i++) {
              pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
            }
          }
          
          // Log first 10 samples for debugging
          if (audioProcessCount < 3) { // Only log first 3 buffers
            const firstSamples = Array.from(pcmData.slice(0, 10)).map(s => s.toString(16));
            console.log(`Audio buffer ${audioProcessCount} first samples: ${firstSamples.join(', ')}`);
            audioProcessCount++;
          }
          
          // Check if audio is actually coming through
          const isAudioSilent = rms < 0.001; // Threshold for silence
          if (isAudioSilent && audioProcessCount % 10 === 0) {
            console.warn("Audio input appears to be silent - check your microphone");
          }
          
          // Convert to base64 (browser-safe way)
          const base64Data = this.arrayBufferToBase64(pcmData.buffer);
          
          // Send to server
          if (this.socket && this.socket.connected) {
            this.socket.emit('audioInput', base64Data);
            // Log every 20 audio packets sent
            if (audioProcessCount % 20 === 0) {
              console.log(`Sent audio packet ${audioProcessCount}`);
            }
          } else {
            console.error("Cannot send audio data: socket disconnected");
            this.stopListening();
          }
        };
        
        console.log("Connecting audio processor nodes...");
        this.sourceNode.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
        console.log("Audio processing pipeline connected");
      } else {
        console.error("AudioContext.createScriptProcessor not available");
        throw new Error("Your browser doesn't support audio processing");
      }
      
      this.isListening = true;
      console.log("Started listening and sending audio data");
      this.notifyStatus('recording');
      
    } catch (error) {
      console.error('Error starting recording:', error);
      this.notifyError({
        message: 'Error starting audio recording',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Stop recording and streaming audio
   */
  stopListening(): void {
    if (!this.isListening) return;
    
    this.isListening = false;
    
    // Clean up audio processing
    if (this.processor) {
      this.processor.disconnect();
      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }
    }
    
    this.audioPlayer.stop();
    this.notifyStatus('processing');
    
    // Tell server to finalize processing
    if (this.socket) {
      this.socket.emit('stopAudio');
    }
  }

  /**
   * Close the connection to the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    
    if (this.audioContext) {
      this.audioContext.close();
    }
    
    this.isConnected = false;
    this.isInitialized = false;
  }

  // Event registration methods
  onConnect(callback: CallbackFn): NovaSonicClient {
    this.onConnectCallbacks.push(callback);
    return this;
  }
  
  onDisconnect(callback: CallbackFn): NovaSonicClient {
    this.onDisconnectCallbacks.push(callback);
    return this;
  }
  
  onStatusChange(callback: StatusCallbackFn): NovaSonicClient {
    this.onStatusChangeCallbacks.push(callback);
    return this;
  }
  
  onAudioOutput(callback: DataCallbackFn<Float32Array>): NovaSonicClient {
    this.onAudioOutputCallbacks.push(callback);
    return this;
  }
  
  onTextOutput(callback: DataCallbackFn<TextOutput>): NovaSonicClient {
    this.onTextOutputCallbacks.push(callback);
    return this;
  }
  
  onError(callback: DataCallbackFn<ErrorData>): NovaSonicClient {
    this.onErrorCallbacks.push(callback);
    return this;
  }

  // Event handlers
  private handleConnect(): void {
    this.isConnected = true;
    this.notifyStatus('connected');
    console.log('Connected to server successfully');
    this.onConnectCallbacks.forEach(callback => callback());
  }
  
  private handleDisconnect(): void {
    this.isConnected = false;
    this.isListening = false;
    this.notifyStatus('disconnected');
    console.log('Disconnected from server');
    this.onDisconnectCallbacks.forEach(callback => callback());
  }
  
  private handleContentStart(data: ContentStart): void {
    console.log('Content start received:', data);
    // When content start is received, we know things are working properly
    this.notifyStatus('ready');
  }
  
  private handleTextOutput(data: TextOutput): void {
    console.log('Text output received:', data);
    // Indicate that we're receiving a response
    this.notifyStatus('receiving');
    this.onTextOutputCallbacks.forEach(callback => callback(data));
  }
  
  private handleAudioOutput(data: AudioOutput): void {
    console.log('Audio output received');
    if (data.content) {
      try {
        const audioData = this.base64ToFloat32Array(data.content);
        this.audioPlayer.playAudio(audioData);
        this.onAudioOutputCallbacks.forEach(callback => callback(audioData));
      } catch (error) {
        console.error('Error processing audio data:', error);
      }
    }
  }
  
  private handleContentEnd(data: ContentEnd): void {
    console.log('Content end received:', data);
  }
  
  private handleStreamComplete(): void {
    console.log('Stream completed');
    this.notifyStatus('ready');
  }
  
  private handleError(error: ErrorData): void {
    console.error('Error from server:', error);
    this.notifyError(error);
  }

  // Helper methods
  private notifyStatus(status: StatusType): void {
    this.onStatusChangeCallbacks.forEach(callback => callback(status));
  }
  
  private notifyError(error: ErrorData): void {
    this.onErrorCallbacks.forEach(callback => callback(error));
  }
  
  // Convert ArrayBuffer to base64 string
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const binary: string[] = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
  }
  
  // Base64 to Float32Array conversion
  private base64ToFloat32Array(base64String: string): Float32Array {
    try {
      const binaryString = window.atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
      
      return float32Array;
    } catch (error) {
      console.error('Error in base64ToFloat32Array:', error);
      throw error;
    }
  }
}