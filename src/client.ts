import {
  BedrockRuntimeClient,
  BedrockRuntimeClientConfig,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import axios from 'axios';
import https from 'https';
import {
  NodeHttp2Handler,
  NodeHttp2HandlerOptions,
} from "@smithy/node-http-handler";
import { Provider } from "@smithy/types";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import {
  AudioConfiguration,
  TextConfiguration,
  InferenceConfig,
} from "./types";
import {
  DefaultAudioInputConfiguration,
  DefaultAudioOutputConfiguration,
  DefaultSystemPrompt,
  DefaultTextConfiguration,
  DefaultToolSchema,
  WeatherToolSchema
} from "./consts";

export interface NovaSonicBidirectionalStreamClientConfig {
  requestHandlerConfig?: NodeHttp2HandlerOptions | Provider<NodeHttp2HandlerOptions | void> | {
    requestTimeout?: number;
    maxConcurrentStreams?: number;
    sessionTimeout?: number;
    disableConcurrentStreams?: boolean;
  };
  clientConfig: Partial<BedrockRuntimeClientConfig>;
  inferenceConfig?: InferenceConfig;
}

export class StreamSession {
  private audioBufferQueue: Buffer[] = [];
  private maxQueueSize = 200; // Maximum number of audio chunks to queue
  private isProcessingAudio = false;
  public isActive = true;

  constructor(
    private sessionId: string,
    private client: NovaSonicBidirectionalStreamClient
  ) { }

  // Register event handlers for this specific session
  public onEvent(eventType: string, handler: (data: any) => void): StreamSession {
    this.client.registerEventHandler(this.sessionId, eventType, handler);
    return this; // For chaining
  }

  public async setupPromptStart(): Promise<void> {
    this.client.setupPromptStartEvent(this.sessionId);
  }

  public async setupSystemPrompt(
    textConfig: TextConfiguration = DefaultTextConfiguration,
    systemPromptContent: string = DefaultSystemPrompt): Promise<void> {
    this.client.setupSystemPromptEvent(this.sessionId, textConfig, systemPromptContent);
  }

  public async setupStartAudio(
    audioConfig: AudioConfiguration = DefaultAudioInputConfiguration
  ): Promise<void> {
    this.client.setupStartAudioEvent(this.sessionId, audioConfig);
  }

  // Stream audio for this session
  public async streamAudio(audioData: Buffer): Promise<void> {
    // Check queue size to avoid memory issues
    if (this.audioBufferQueue.length >= this.maxQueueSize) {
      // Queue is full, drop oldest chunk
      this.audioBufferQueue.shift();
      console.log("Audio queue full, dropping oldest chunk");
    }

    // Queue the audio chunk for streaming
    this.audioBufferQueue.push(audioData);
    this.processAudioQueue();
  }

  // Process audio queue for continuous streaming
  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingAudio || this.audioBufferQueue.length === 0 || !this.isActive) return;

    this.isProcessingAudio = true;
    try {
      // Process all chunks in the queue, up to a reasonable limit
      let processedChunks = 0;
      const maxChunksPerBatch = 5; // Process max 5 chunks at a time to avoid overload

      while (this.audioBufferQueue.length > 0 && processedChunks < maxChunksPerBatch && this.isActive) {
        const audioChunk = this.audioBufferQueue.shift();
        if (audioChunk) {
          await this.client.streamAudioChunk(this.sessionId, audioChunk);
          processedChunks++;
        }
      }
    } finally {
      this.isProcessingAudio = false;

      // If there are still items in the queue, schedule the next processing using setTimeout
      if (this.audioBufferQueue.length > 0 && this.isActive) {
        setTimeout(() => this.processAudioQueue(), 0);
      }
    }
  }

  // Get session ID
  public getSessionId(): string {
    return this.sessionId;
  }

  public async endAudioContent(): Promise<void> {
    if (!this.isActive) return;
    await this.client.sendContentEnd(this.sessionId);
  }

  public async endPrompt(): Promise<void> {
    if (!this.isActive) return;
    await this.client.sendPromptEnd(this.sessionId);
  }

  public async close(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;
    this.audioBufferQueue = []; // Clear any pending audio

    await this.client.sendSessionEnd(this.sessionId);
    console.log(`Session ${this.sessionId} close completed`);
  }
}

// Session data type
interface SessionData {
  queue: Array<any>;
  queueSignal: Subject<boolean>;
  closeSignal: Subject<void>;
  responseSubject: Subject<any>;
  toolUseContent: any;
  toolUseId: string;
  toolName: string;
  responseHandlers: Map<string, (data: any) => void>;
  promptName: string;
  inferenceConfig: InferenceConfig;
  isActive: boolean;
  isPromptStartSent: boolean;
  isAudioContentStartSent: boolean;
  audioContentId: string;
  activePromptIds?: Set<string>;
  activeContentIds?: Map<string, string>;
}

export class NovaSonicBidirectionalStreamClient {
  private bedrockRuntimeClient: BedrockRuntimeClient;
  private inferenceConfig: InferenceConfig;
  private activeSessions: Map<string, SessionData> = new Map();
  private sessionLastActivity: Map<string, number> = new Map();
  private sessionCleanupInProgress = new Set<string>();
  private customSystemPrompts: Map<string, string> = new Map();

  constructor(config: NovaSonicBidirectionalStreamClientConfig) {
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: 300000,
      sessionTimeout: 300000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
      ...config.requestHandlerConfig,
    });

    if (!config.clientConfig.credentials) {
      throw new Error("No credentials provided");
    }

    this.bedrockRuntimeClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      credentials: config.clientConfig.credentials,
      region: config.clientConfig.region || "us-east-1",
      requestHandler: nodeHttp2Handler
    });

    this.inferenceConfig = config.inferenceConfig ?? {
      maxTokens: 1024,
      topP: 0.9,
      temperature: 0.7,
    };
  }

  public isSessionActive(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  public getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  public getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  public updateSessionActivity(sessionId: string): void {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  public isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  // Create a new streaming session
  public createStreamSession(sessionId: string = randomUUID(), config?: { inferenceConfig?: InferenceConfig }): StreamSession {
    // If a session with this ID already exists, close it properly first
    if (this.activeSessions.has(sessionId)) {
      console.warn(`Stream session with ID ${sessionId} already exists. Cleaning up old session.`);
      try {
        const oldSession = this.activeSessions.get(sessionId);
        if (oldSession) {
          // Mark as inactive so queue processing stops
          oldSession.isActive = false;
          // Remove from active sessions map
          this.activeSessions.delete(sessionId);
          console.log(`Old session ${sessionId} cleaned up, creating new one`);
        }
      } catch (err) {
        console.error(`Error cleaning up old session ${sessionId}:`, err);
      }
    }

    const session: SessionData = {
      queue: [],
      queueSignal: new Subject<boolean>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<any>(),
      toolUseContent: null,
      toolUseId: "",
      toolName: "",
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig: config?.inferenceConfig ?? this.inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID(),
      activePromptIds: new Set<string>(),
      activeContentIds: new Map<string, string>()
    };

    this.activeSessions.set(sessionId, session);
    return new StreamSession(sessionId, this);
  }

  // Process tool use requests - handles date/time and weather tools
  public async processToolUse(toolName: string, toolUseContent: any) {
    const tool = toolName.toLowerCase();

    switch (tool) {
      case "getdateandtimetool":
        const date = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
        const pstDate = new Date(date);
        return {
          date: pstDate.toISOString().split('T')[0],
          year: pstDate.getFullYear(),
          month: pstDate.getMonth() + 1,
          day: pstDate.getDate(),
          dayOfWeek: pstDate.toLocaleString('en-US', { weekday: 'long' }).toUpperCase(),
          timezone: "PST",
          formattedTime: pstDate.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit'
          })
        };
      case "getweathertool":
        console.log(`weather tool`);
        const parsedContent = await this.parseToolUseContentForWeather(toolUseContent);
        console.log("parsed content");
        if (!parsedContent) {
          throw new Error('parsedContent is undefined');
        }
        return this.fetchWeatherData(parsedContent?.latitude, parsedContent?.longitude);
      default:
        console.log(`Tool ${tool} not supported`);
        throw new Error(`Tool ${tool} not supported`);
    }
  }

  // Parse tool use content for weather tool
  private async parseToolUseContentForWeather(toolUseContent: any) {
    try {
      // Check if the content field exists and is a string
      if (toolUseContent && typeof toolUseContent.content === 'string') {
        // Parse the JSON string into an object
        const parsedContent = JSON.parse(toolUseContent.content);
        console.log(`parsedContent ${parsedContent}`);
        // Return the parsed content
        return {
          latitude: parsedContent.latitude,
          longitude: parsedContent.longitude
        };
      }
      return null;
    } catch (error) {
      console.error("Failed to parse tool use content:", error);
      return null;
    }
  }

  // Fetch weather data from open-meteo.com
  private async fetchWeatherData(latitude: string, longitude: string) {
    const ipv4Agent = new https.Agent({ family: 4 });
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;

    try {
      const response = await axios.get(url, {
        httpsAgent: ipv4Agent,
        timeout: 5000,
        headers: {
          'User-Agent': 'MyApp/1.0',
          'Accept': 'application/json'
        }
      });
      const weatherData = response.data;
      console.log("weatherData:", weatherData);

      return {
        weather_data: weatherData
      };
    } catch (error) {
      console.error(`Error fetching weather data: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Initialize a session with AWS Bedrock
  public async initiateSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Stream session ${sessionId} not found`);
    }

    try {
      console.log(`=== INITIATING SESSION ${sessionId} ===`);
      console.log(`1. Setting up sessionStart event`);
      
      // Set up initial events for this session
      // Reset the queue to ensure we start fresh
      session.queue = [];
      
      // Clear any tracking state
      session.activePromptIds = new Set<string>();
      session.activeContentIds = new Map<string, string>();
      session.isPromptStartSent = false;
      session.isAudioContentStartSent = false;
      
      // CRITICAL: Follow the exact sequence from the samples
      // This is the required sequence: sessionStart -> promptStart -> systemPrompt -> audioContentStart
      
      // Step 1: Session start
      this.setupSessionStartEvent(sessionId);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 2: Prompt start
      console.log('Adding promptStart event');
      await this.setupPromptStartEvent(sessionId);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 3: System prompt (contentStart -> textInput -> contentEnd)
      console.log('Adding system prompt event');
      await this.setupSystemPromptEvent(sessionId);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 4: Audio content start
      console.log('Adding audio content start event');
      await this.setupStartAudioEvent(sessionId);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 5: Send a tiny audio chunk to avoid the content data error
      console.log('Adding dummy audio data to avoid validation errors');
      await this.streamAudioChunk(sessionId, Buffer.from([0, 0, 0, 0]));
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log(`Queue now has ${session.queue.length} events - minimum required sequence established`);
      console.log(`Tracking ${session.activePromptIds?.size || 0} prompts and ${session.activeContentIds?.size || 0} content items`);
      
      // Double check our tracking objects
      if (session.activePromptIds?.size === 0) {
        console.warn(`Warning: No active prompts being tracked. Adding current promptName ${session.promptName}`); 
        session.activePromptIds?.add(session.promptName);
      }
      
      if (!session.activeContentIds?.has(session.audioContentId)) {
        console.warn(`Warning: Audio content ID ${session.audioContentId} not being tracked. Adding to tracking.`);
        session.activeContentIds?.set(session.audioContentId, session.promptName);
      }
      
      // Wait to ensure events are properly queued
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create the bidirectional stream with session-specific async iterator
      const asyncIterable = this.createSessionAsyncIterable(sessionId);

      console.log(`2. Starting bidirectional stream for session ${sessionId}...`);
      console.log(`   Queue length: ${session.queue.length}`);

      // Double check that we have events in the queue
      if (session.queue.length === 0) {
        console.error(`Error: Queue is empty for session ${sessionId}. The required event sequence must be present.`);
        throw new Error(`Queue is empty for session ${sessionId}. Cannot initiate bidirectional stream without events.`);
      }
      
      // Verify credentials before making the API call
      try {
        console.log('Verifying credentials before API call');
        if (typeof this.bedrockRuntimeClient.config.credentials === 'function') {
          const creds = await this.bedrockRuntimeClient.config.credentials();
          console.log('Credentials verified before API call:',
            creds ? `AccessKeyId: ${creds.accessKeyId.substring(0, 4)}...` : 'No credentials');
        }
      } catch (credError) {
        console.error('Error verifying credentials before API call:', credError);
      }

      console.log('Sending InvokeModelWithBidirectionalStreamCommand with modelId amazon.nova-sonic-v1:0');
      // Cast as any to avoid TypeScript error with contentType and accept
      const commandInput: any = {
        modelId: "amazon.nova-sonic-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: asyncIterable,
      };
      const command = new InvokeModelWithBidirectionalStreamCommand(commandInput);
      
      let response;
      try {
        // Add a timeout to the AWS call to avoid hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AWS API call timeout after 30 seconds')), 30000);
        });
        
        // Race between the actual API call and our timeout
        response = await Promise.race([
          this.bedrockRuntimeClient.send(command),
          timeoutPromise
        ]);
        
        console.log('API call successful!');
        console.log(`3. Stream established for session ${sessionId}, processing responses...`);
        
        // Process responses for this session
        await this.processResponseStream(sessionId, response);
        
        console.log(`Stream completed, performing proper cleanup sequence`);
        // Follow exact sequence: endAudioContent → endPrompt → close
        if (session.isActive) {
          // Step 1: Send another dummy audio chunk to make sure we have content
          console.log('Sending final dummy audio data before closing');
          await this.streamAudioChunk(sessionId, Buffer.from([0, 0, 0, 0]));
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Step 2: Close all content items
          await this.sendContentEnd(sessionId);   
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Step 3: Close all prompts
          await this.sendPromptEnd(sessionId);    
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Don't send sessionEnd here as that's handled by closeSession
        }
      } catch (apiError) {
        console.error('Error in API call:', apiError);
        console.error('Error name:', apiError instanceof Error ? apiError.name : 'Unknown');
        console.error('Error message:', apiError instanceof Error ? apiError.message : String(apiError));
        
        // Clean up the session on error
        console.log(`Cleaning up session ${sessionId} after API error`);
        session.isActive = false;
        
        // Dispatch an error event to notify clients
        this.dispatchEvent(sessionId, 'error', {
          source: 'bidirectionalStream',
          message: apiError instanceof Error ? apiError.message : 'API error occurred',
          details: apiError instanceof Error ? apiError.name : 'Unknown error'
        });
        
        throw apiError;
      }

    } catch (error) {
      console.error(`Error in session ${sessionId}: `, error);
      this.dispatchEventForSession(sessionId, 'error', {
        source: 'bidirectionalStream',
        message: 'Error processing stream',
        details: error instanceof Error ? error.message : String(error)
      });

      // Make sure to clean up if there's an error
      if (session.isActive) {
        this.closeSession(sessionId);
      }
    }
  }

  // Dispatch events to handlers for a specific session
  private dispatchEventForSession(sessionId: string, eventType: string, data: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${eventType} handler for session ${sessionId}: `, e);
      }
    }

    // Also dispatch to "any" handlers
    const anyHandler = session.responseHandlers.get('any');
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        console.error(`Error in 'any' handler for session ${sessionId}: `, e);
      }
    }
  }

  // Create an async iterable for the bidirectional stream
  private createSessionAsyncIterable(sessionId: string): AsyncIterable<any> {
    if (!this.isSessionActive(sessionId)) {
      console.log(`Cannot create async iterable: Session ${sessionId} not active`);
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true })
        })
      };
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Cannot create async iterable: Session ${sessionId} not found`);
    }
    
    // CRITICAL: Ensure we have audio content ID
    if (!session.audioContentId) {
      console.log(`Generating new audioContentId for session ${sessionId}`);
      session.audioContentId = randomUUID();
    }
    
    // Ensure we're tracking the audio content ID
    if (session.activeContentIds && !session.activeContentIds.has(session.audioContentId)) {
      console.log(`Adding audioContentId ${session.audioContentId} to tracking`);
      session.activeContentIds.set(session.audioContentId, session.promptName);
    }
    
    // Verify the session has necessary events in queue
    if (session.queue.length === 0) {
      console.warn(`Session ${sessionId} has empty queue when creating async iterator. Adding sessionStart.`);
      this.setupSessionStartEvent(sessionId);
    }

    let eventCount = 0;

    return {
      [Symbol.asyncIterator]: () => {
        console.log(`AsyncIterable iterator requested for session ${sessionId}`);

        return {
          next: async () => {
            try {
              // Check if session is still active
              if (!session.isActive || !this.activeSessions.has(sessionId)) {
                console.log(`Iterator closing for session ${sessionId}, done = true`);
                return { value: undefined, done: true };
              }
              
              // Check if queue is empty but we need to make sure SessionStart was sent
              if (session.queue.length === 0 && eventCount === 0) {
                console.warn(`Queue is empty and no events sent yet for session ${sessionId}. Checking session start`);
                // Verify the sessionStart event was added to the queue
                const needsSessionStart = true;
                if (needsSessionStart) {
                  console.log(`Re-adding sessionStart event for session ${sessionId}`);
                  this.setupSessionStartEvent(sessionId);
                  // Give a moment for the event to be added to the queue
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
              
              // Wait for items in the queue or close signal
              if (session.queue.length === 0) {
                console.log(`Queue empty for session ${sessionId}, waiting for items...`);
                try {
                  // Set a timeout for waiting on queue items
                  const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("Timeout waiting for queue items")), 10000);
                  });
                  
                  await Promise.race([
                    firstValueFrom(session.queueSignal.pipe(take(1))),
                    firstValueFrom(session.closeSignal.pipe(take(1))).then(() => {
                      throw new Error("Stream closed");
                    }),
                    timeoutPromise
                  ]);
                  
                  console.log(`Received signal for session ${sessionId}, queue now has ${session.queue.length} items`);
                } catch (error) {
                  if (error instanceof Error) {
                    if (error.message === "Stream closed" || !session.isActive) {
                      // This is an expected condition when closing the session
                      if (this.activeSessions.has(sessionId)) {
                        console.log(`Session ${sessionId} closed during wait`);
                      }
                      return { value: undefined, done: true };
                    }
                  }
                  else {
                    console.error(`Error on event close`, error);
                  }
                }
              }

              // If queue is still empty or session is inactive, we're done
              if (session.queue.length === 0 || !session.isActive) {
                console.log(`Queue empty or session inactive: ${sessionId} `);
                return { value: undefined, done: true };
              }

              // Get next item from the session's queue
              const nextEvent = session.queue.shift();
              eventCount++;
              
              // Log the first event to make sure it's SessionStart
              if (eventCount === 1) {
                const eventType = Object.keys(nextEvent.event || {})[0];
                console.log(`First event for session ${sessionId} is: ${eventType}`);
                if (eventType !== 'sessionStart') {
                  console.error(`ERROR: First event must be sessionStart but got ${eventType}!`);
                }
              }
              
              // Special handling for audioContentStart event
              if (nextEvent.event?.contentStart?.type === 'AUDIO') {
                console.log(`Detected audioContentStart event for ${nextEvent.event.contentStart.contentName}`);
                session.isAudioContentStartSent = true;
              }

              return {
                value: {
                  chunk: {
                    bytes: Buffer.from(JSON.stringify(nextEvent))
                  }
                },
                done: false
              };
            } catch (error) {
              console.error(`Error in session ${sessionId} iterator: `, error);
              session.isActive = false;
              return { value: undefined, done: true };
            }
          },

          return: async () => {
            console.log(`Iterator return () called for session ${sessionId}`);
            session.isActive = false;
            return { value: undefined, done: true };
          },

          throw: async (error) => {
            console.log(`Iterator throw () called for session ${sessionId} with error: `, error);
            session.isActive = false;
            throw error;
          }
        };
      }
    };
  }

  // Process the response stream from AWS Bedrock
  private async processResponseStream(sessionId: string, response: any): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      console.log(`Starting to process response stream for session ${sessionId}`);
      let eventCount = 0;
      
      // Add a timeout safety mechanism
      const timeout = setTimeout(() => {
        if (eventCount === 0) {
          console.warn(`No events received after 10 seconds for session ${sessionId}, may be inactive`);
          this.dispatchEvent(sessionId, 'warning', {
            source: 'responseStream',
            message: 'No events received after timeout period',
            details: 'The connection may be stalled'
          });
        }
      }, 10000); // 10 second timeout
      
      for await (const event of response.body) {
        eventCount++;
        if (eventCount === 1) {
          console.log(`First response event received for session ${sessionId}`);
          clearTimeout(timeout); // Clear timeout once we get first event
        }
        
        if (!session.isActive) {
          console.log(`Session ${sessionId} is no longer active, stopping response processing`);
          break;
        }
        
        if (event.chunk?.bytes) {
          try {
            this.updateSessionActivity(sessionId);
            const textResponse = new TextDecoder().decode(event.chunk.bytes);

            try {
              const jsonResponse = JSON.parse(textResponse);
              if (jsonResponse.event?.contentStart) {
                this.dispatchEvent(sessionId, 'contentStart', jsonResponse.event.contentStart);
              } else if (jsonResponse.event?.textOutput) {
                this.dispatchEvent(sessionId, 'textOutput', jsonResponse.event.textOutput);
              } else if (jsonResponse.event?.audioOutput) {
                this.dispatchEvent(sessionId, 'audioOutput', jsonResponse.event.audioOutput);
              } else if (jsonResponse.event?.toolUse) {
                this.dispatchEvent(sessionId, 'toolUse', jsonResponse.event.toolUse);

                // Store tool use information for later
                session.toolUseContent = jsonResponse.event.toolUse;
                session.toolUseId = jsonResponse.event.toolUse.toolUseId;
                session.toolName = jsonResponse.event.toolUse.toolName;
              } else if (jsonResponse.event?.contentEnd &&
                jsonResponse.event?.contentEnd?.type === 'TOOL') {

                // Process tool use
                console.log(`Processing tool use for session ${sessionId}`);
                this.dispatchEvent(sessionId, 'toolEnd', {
                  toolUseContent: session.toolUseContent,
                  toolUseId: session.toolUseId,
                  toolName: session.toolName
                });

                console.log("Calling tool use");
                console.log("Tool use content : ", session.toolUseContent);
                // Function calling
                const toolResult = await this.processToolUse(session.toolName, session.toolUseContent);

                // Send tool result
                this.sendToolResult(sessionId, session.toolUseId, toolResult);

                // Also dispatch event about tool result
                this.dispatchEvent(sessionId, 'toolResult', {
                  toolUseId: session.toolUseId,
                  result: toolResult
                });
              } else if (jsonResponse.event?.contentEnd) {
                this.dispatchEvent(sessionId, 'contentEnd', jsonResponse.event.contentEnd);
              }
              else {
                // Handle other events
                const eventKeys = Object.keys(jsonResponse.event || {});
                console.log(`Event keys for session ${sessionId}: `, eventKeys);
                console.log(`Handling other events`);
                if (eventKeys.length > 0) {
                  this.dispatchEvent(sessionId, eventKeys[0], jsonResponse.event);
                } else if (Object.keys(jsonResponse).length > 0) {
                  this.dispatchEvent(sessionId, 'unknown', jsonResponse);
                }
              }
            } catch (e) {
              console.log(`Raw text response for session ${sessionId}(parse error): `, textResponse);
            }
          } catch (e) {
            console.error(`Error processing response chunk for session ${sessionId}: `, e);
          }
        } else if (event.modelStreamErrorException) {
          console.error(`Model stream error for session ${sessionId}: `, event.modelStreamErrorException);
          this.dispatchEvent(sessionId, 'error', {
            type: 'modelStreamErrorException',
            details: event.modelStreamErrorException
          });
        } else if (event.internalServerException) {
          console.error(`Internal server error for session ${sessionId}: `, event.internalServerException);
          this.dispatchEvent(sessionId, 'error', {
            type: 'internalServerException',
            details: event.internalServerException
          });
        }
      }

      console.log(`Response stream processing complete for session ${sessionId}`);
      this.dispatchEvent(sessionId, 'streamComplete', {
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error(`Error processing response stream for session ${sessionId}: `, error);
      this.dispatchEvent(sessionId, 'error', {
        source: 'responseStream',
        message: 'Error processing response stream',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Add an event to a session's queue
  private addEventToSessionQueue(sessionId: string, event: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    this.updateSessionActivity(sessionId);
    session.queue.push(event);
    
    // Log queue state after adding event
    const eventType = event.event ? Object.keys(event.event)[0] : 'unknown';
    console.log(`Added ${eventType} event to queue for session ${sessionId}. Queue length: ${session.queue.length}`);
    
    // Signal that queue has new data
    try {
      session.queueSignal.next(true);
    } catch (e) {
      console.error(`Error triggering queueSignal for ${sessionId}:`, e);
    }
  }

  // Set up initial events for a session
  public setupSessionStartEvent(sessionId: string): void {
    console.log(`Setting up initial events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Clear the queue before adding the sessionStart event
    session.queue = [];

    // Session start event must always be the first event sent
    this.addEventToSessionQueue(sessionId, {
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 1024,
            topP: 0.9,
            temperature: 0.7
          }
        }
      }
    });
    
    // Ensure the event is processed immediately
    console.log(`Added sessionStart event to queue for session ${sessionId}`);
    console.log(`Queue length after adding sessionStart: ${session.queue.length}`);
    
    // Trigger the queueSignal to let any waiting iterators know data is available
    try {
      if (session.queueSignal) {
        session.queueSignal.next(true);
      }
    } catch (e) {
      console.error(`Error triggering queueSignal for session ${sessionId}:`, e);
    }
  }

  public setupPromptStartEvent(sessionId: string): void {
    console.log(`Setting up prompt start event for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    // Prompt start event
    this.addEventToSessionQueue(sessionId, {
      event: {
        promptStart: {
          promptName: session.promptName,
          textOutputConfiguration: {
            mediaType: "text/plain",
          },
          audioOutputConfiguration: DefaultAudioOutputConfiguration,
          toolUseOutputConfiguration: {
            mediaType: "application/json",
          },
          toolConfiguration: {
            tools: [{
              toolSpec: {
                name: "getDateAndTimeTool",
                description: "Get information about the current date and time.",
                inputSchema: {
                  json: DefaultToolSchema
                }
              }
            },
            {
              toolSpec: {
                name: "getWeatherTool",
                description: "Get the current weather for a given location, based on its WGS84 coordinates.",
                inputSchema: {
                  json: WeatherToolSchema
                }
              }
            }
            ]
          },
        },
      }
    });
    
    // Track this prompt in activePromptIds to ensure it's closed properly
    if (!session.activePromptIds) {
      session.activePromptIds = new Set<string>();
    }
    session.activePromptIds.add(session.promptName);
    console.log(`Added promptName ${session.promptName} to active prompts tracking`);
    
    session.isPromptStartSent = true;
  }

  /**
   * Set a custom system prompt for a session
   * This will be used during session initialization
   */
  public setCustomSystemPrompt(sessionId: string, prompt: string): void {
    console.log(`Setting custom system prompt for session ${sessionId}`);
    this.customSystemPrompts.set(sessionId, prompt);
  }

  public setupSystemPromptEvent(
    sessionId: string,
    textConfig: TextConfiguration = DefaultTextConfiguration,
    systemPromptContent?: string
  ): void {
    console.log(`Setting up systemPrompt events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    // Use custom prompt if set, otherwise use default or provided prompt
    const prompt = this.customSystemPrompts.get(sessionId) || systemPromptContent || DefaultSystemPrompt;
    console.log(`Using ${this.customSystemPrompts.has(sessionId) ? 'custom' : 'default'} system prompt`);
    
    // Text content start
    const textPromptID = randomUUID();
    // Store the promptName in the session object for reference
    const systemPromptName = session.promptName;
    
    // Make sure we're tracking prompt IDs
    if (!session.activePromptIds) {
      session.activePromptIds = new Set<string>();
    }
    
    // Track content IDs to ensure they're properly closed
    if (!session.activeContentIds) {
      session.activeContentIds = new Map<string, string>();
    }
    
    // Store contentId under its promptName for reference
    session.activeContentIds.set(textPromptID, systemPromptName);
    
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: systemPromptName,
          contentName: textPromptID,
          type: "TEXT",
          interactive: true,
          role: "SYSTEM",
          textInputConfiguration: textConfig,
        },
      }
    });

    // Text input content
    this.addEventToSessionQueue(sessionId, {
      event: {
        textInput: {
          promptName: systemPromptName,
          contentName: textPromptID,
          content: prompt,
        },
      }
    });

    // Text content end
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: systemPromptName,
          contentName: textPromptID,
        },
      }
    });
    
    // Remove from tracking since we've closed it
    session.activeContentIds.delete(textPromptID);
    
    // Also remove from custom prompts map to avoid memory leaks
    this.customSystemPrompts.delete(sessionId);
  }

  public setupStartAudioEvent(
    sessionId: string,
    audioConfig: AudioConfiguration = DefaultAudioInputConfiguration
  ): void {
    console.log(`Setting up startAudioContent event for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    console.log(`Using audio content ID: ${session.audioContentId}`);
    // Use the session's promptName for consistency
    const audioPromptName = session.promptName;
    // Audio content start
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: audioPromptName,
          contentName: session.audioContentId,
          type: "AUDIO",
          interactive: true,
          role: "USER",
          audioInputConfiguration: audioConfig,
        },
      }
    });
    
    // Track this content ID to ensure it's properly closed
    if (!session.activeContentIds) {
      session.activeContentIds = new Map<string, string>();
    }
    session.activeContentIds.set(session.audioContentId, audioPromptName);
    session.isAudioContentStartSent = true;
    console.log(`Initial events setup complete for session ${sessionId}`);
  }

  // Stream an audio chunk for a session
  public async streamAudioChunk(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive || !session.audioContentId) {
      throw new Error(`Invalid session ${sessionId} for audio streaming`);
    }
    
    // Convert audio to base64
    const base64Data = audioData.toString('base64');

    // Use the session's promptName for consistency
    const audioPromptName = session.promptName;
    
    this.addEventToSessionQueue(sessionId, {
      event: {
        audioInput: {
          promptName: audioPromptName,
          contentName: session.audioContentId,
          content: base64Data,
        },
      }
    });
  }

  // Send tool result back to the model
  public async sendToolResult(sessionId: string, toolUseId: string, result: any): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    console.log("inside tool result");
    if (!session || !session.isActive) return;

    console.log(`Sending tool result for session ${sessionId}, tool use ID: ${toolUseId}`);
    const contentId = randomUUID();

    // Tool content start
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: contentId,
          interactive: false,
          type: "TOOL",
          role: "TOOL",
          toolResultInputConfiguration: {
            toolUseId: toolUseId,
            type: "TEXT",
            textInputConfiguration: {
              mediaType: "text/plain"
            }
          }
        }
      }
    });

    // Tool content input
    const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
    this.addEventToSessionQueue(sessionId, {
      event: {
        toolResult: {
          promptName: session.promptName,
          contentName: contentId,
          content: resultContent
        }
      }
    });

    // Tool content end
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: contentId
        }
      }
    });

    console.log(`Tool result sent for session ${sessionId}`);
  }

  public async sendContentEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Check if we have content IDs to close
    if (session.activeContentIds && session.activeContentIds.size > 0) {
      console.log(`Closing ${session.activeContentIds.size} active content items for session ${sessionId}`);
      
      // Make a copy of the entries since we'll be modifying the map during iteration
      const contentEntries = Array.from(session.activeContentIds.entries());
      
      // Before closing any audio content, make sure we actually sent some audio data
      // to avoid the 'no content data was received' validation error
      for (const [contentId, promptName] of contentEntries) {
        if (contentId === session.audioContentId) {
          console.log(`Ensuring audio content has data before closing for ${contentId}`);
          // Send a tiny audio packet before closing to avoid validation error
          await this.streamAudioChunk(sessionId, Buffer.from([0, 0, 0, 0]));
          // Small pause to ensure the audio chunk is processed
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Close each content ID that's still active
      for (const [contentId, promptName] of contentEntries) {
        console.log(`Sending contentEnd for ${contentId} under prompt ${promptName}`);
        await this.addEventToSessionQueue(sessionId, {
          event: {
            contentEnd: {
              promptName: promptName,
              contentName: contentId,
            }
          }
        });
        
        // Remove this content ID from tracking
        session.activeContentIds.delete(contentId);
        
        // Small pause between each contentEnd to ensure proper sequencing
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } 
    // For backward compatibility, also check the audioContentId
    else if (session.isAudioContentStartSent && session.audioContentId) {
      // Use the session's promptName for consistency
      const audioPromptName = session.promptName;
      
      // Send a tiny audio packet before closing to avoid validation error
      console.log(`Sending dummy audio data before closing audio content`);
      await this.streamAudioChunk(sessionId, Buffer.from([0, 0, 0, 0]));
      
      // Small pause to ensure the audio chunk is processed
      await new Promise(resolve => setTimeout(resolve, 300));
      
      await this.addEventToSessionQueue(sessionId, {
        event: {
          contentEnd: {
            promptName: audioPromptName,
            contentName: session.audioContentId,
          }
        }
      });
    } else {
      console.log(`No content to close for session ${sessionId}`);
    }

    // Wait to ensure it's processed
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  public async sendPromptEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    // Check if we have any prompts to close
    if (!session.isPromptStartSent) {
      console.log(`No prompt started for session ${sessionId}, skipping promptEnd`);
      return;
    }
    
    // Send promptEnd event for any tracked prompt IDs
    if (session.activePromptIds && session.activePromptIds.size > 0) {
      console.log(`Closing ${session.activePromptIds.size} active prompts for session ${sessionId}`);
      
      // Close each prompt that's still active
      for (const promptName of session.activePromptIds) {
        console.log(`Sending promptEnd for ${promptName}`);
        await this.addEventToSessionQueue(sessionId, {
          event: {
            promptEnd: {
              promptName: promptName
            }
          }
        });
      }
      
      // Clear the set of active prompts
      session.activePromptIds.clear();
    } else {
      // Just close the main prompt if no tracking available
      console.log(`Sending promptEnd for ${session.promptName}`);
      await this.addEventToSessionQueue(sessionId, {
        event: {
          promptEnd: {
            promptName: session.promptName
          }
        }
      });
    }

    // Wait to ensure it's processed
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  public async sendSessionEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await this.addEventToSessionQueue(sessionId, {
      event: {
        sessionEnd: {}
      }
    });

    // Wait to ensure it's processed
    await new Promise(resolve => setTimeout(resolve, 300));

    // Now it's safe to clean up
    session.isActive = false;
    session.closeSignal.next();
    session.closeSignal.complete();
    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
    console.log(`Session ${sessionId} closed and removed from active sessions`);
  }

  // Register an event handler for a session
  public registerEventHandler(sessionId: string, eventType: string, handler: (data: any) => void): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.responseHandlers.set(eventType, handler);
  }

  // Dispatch an event to registered handlers
  private dispatchEvent(sessionId: string, eventType: string, data: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${eventType} handler for session ${sessionId}:`, e);
      }
    }

    // Also dispatch to "any" handlers
    const anyHandler = session.responseHandlers.get('any');
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        console.error(`Error in 'any' handler for session ${sessionId}:`, e);
      }
    }
  }

  public async closeSession(sessionId: string): Promise<void> {
    if (this.sessionCleanupInProgress.has(sessionId)) {
      console.log(`Cleanup already in progress for session ${sessionId}, skipping`);
      return;
    }
    this.sessionCleanupInProgress.add(sessionId);
    try {
      console.log(`Starting close process for session ${sessionId}`);
      
      // Important: Follow the exact sequence from the samples
      // First close all audio content
      console.log(`1. Closing audio content for session ${sessionId}`);
      await this.sendContentEnd(sessionId);
      
      // Small pause between operations
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Then close all prompts
      console.log(`2. Closing prompts for session ${sessionId}`);
      await this.sendPromptEnd(sessionId);
      
      // Small pause between operations
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Finally end the session
      console.log(`3. Ending session ${sessionId}`);
      await this.sendSessionEnd(sessionId);
      
      console.log(`Session ${sessionId} cleanup complete`);
    } catch (error) {
      console.error(`Error during closing sequence for session ${sessionId}:`, error);

      // Ensure cleanup happens even if there's an error
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.isActive = false;
        this.activeSessions.delete(sessionId);
        this.sessionLastActivity.delete(sessionId);
      }
    } finally {
      // Always clean up the tracking set
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }

  public forceCloseSession(sessionId: string): void {
    if (this.sessionCleanupInProgress.has(sessionId) || !this.activeSessions.has(sessionId)) {
      console.log(`Session ${sessionId} already being cleaned up or not active`);
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) return;

      console.log(`Force closing session ${sessionId}`);

      // Immediately mark as inactive and clean up resources
      session.isActive = false;
      session.closeSignal.next();
      session.closeSignal.complete();
      this.activeSessions.delete(sessionId);
      this.sessionLastActivity.delete(sessionId);

      console.log(`Session ${sessionId} force closed`);
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }
}