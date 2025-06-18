const { 
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand 
} = require('@aws-sdk/client-bedrock-runtime');
const { NodeHttp2Handler } = require('@smithy/node-http-handler');
const { randomUUID } = require('crypto');
const { Subject } = require('rxjs');
const { take } = require('rxjs/operators');
const { firstValueFrom } = require('rxjs');
const https = require('https');
const axios = require('axios');
const { TextEncoder } = require('util'); // Add TextEncoder from node:util

// Import our type constants
const { 
  DefaultInferenceConfiguration,
  DefaultAudioInputConfiguration,
  DefaultAudioOutputConfiguration,
  DefaultTextConfiguration,
  DefaultSystemPrompt
} = require('./types');

// Define tool schemas inline for simplicity
const DefaultToolSchema = JSON.stringify({
  "type": "object",
  "properties": {},
  "required": []
});

const WeatherToolSchema = JSON.stringify({
  "type": "object",
  "properties": {
    "latitude": {
      "type": "string",
      "description": "Geographical WGS84 latitude of the location."
    },
    "longitude": {
      "type": "string",
      "description": "Geographical WGS84 longitude of the location."
    }
  },
  "required": ["latitude", "longitude"]
});

/**
 * StreamSession class for managing a bidirectional audio stream with AWS Bedrock
 */
class StreamSession {
  constructor(sessionId, client) {
    this.sessionId = sessionId;
    this.client = client;
    this.audioBufferQueue = [];
    this.maxQueueSize = 200; // Maximum number of audio chunks to queue
    this.isProcessingAudio = false;
    this.isActive = true;
  }

  // Register event handlers for this specific session
  onEvent(eventType, handler) {
    this.client.registerEventHandler(this.sessionId, eventType, handler);
    return this; // For chaining
  }

  async setupPromptStart() {
    this.client.setupPromptStartEvent(this.sessionId);
  }

  async setupSystemPrompt(
    textConfig = DefaultTextConfiguration,
    systemPromptContent = DefaultSystemPrompt) {
    this.client.setupSystemPromptEvent(this.sessionId, textConfig, systemPromptContent);
  }

  async setupStartAudio(
    audioConfig = DefaultAudioInputConfiguration
  ) {
    this.client.setupStartAudioEvent(this.sessionId, audioConfig);
  }

  // Stream audio for this session
  async streamAudio(audioData) {
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
  async processAudioQueue() {
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
  getSessionId() {
    return this.sessionId;
  }

  async endAudioContent() {
    if (!this.isActive) return;
    await this.client.sendContentEnd(this.sessionId);
  }

  async endPrompt() {
    if (!this.isActive) return;
    await this.client.sendPromptEnd(this.sessionId);
  }

  async close() {
    if (!this.isActive) return;

    this.isActive = false;
    this.audioBufferQueue = []; // Clear any pending audio

    await this.client.sendSessionEnd(this.sessionId);
    console.log(`Session ${this.sessionId} close completed`);
  }
}

/**
 * NovaSonicBidirectionalStreamClient class for managing bidirectional communication with AWS Bedrock
 */
class NovaSonicBidirectionalStreamClient {
  constructor(config) {
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

    // Specifically use us-east-1 for Nova Sonic model availability
    const region = "us-east-1";
    console.log(`Initializing BedrockRuntimeClient with region: ${region}`);
    
    this.bedrockRuntimeClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      credentials: config.clientConfig.credentials,
      region: region, // Force us-east-1 where Bedrock has Nova Sonic available
      requestHandler: nodeHttp2Handler
    });

    this.inferenceConfig = config.inferenceConfig ?? DefaultInferenceConfiguration;

    this.activeSessions = new Map();
    this.sessionLastActivity = new Map();
    this.sessionCleanupInProgress = new Set();
  }

  isSessionActive(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  getActiveSessions() {
    return Array.from(this.activeSessions.keys());
  }

  getLastActivityTime(sessionId) {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  updateSessionActivity(sessionId) {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  isCleanupInProgress(sessionId) {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  // Create a new streaming session
  createStreamSession(sessionId = randomUUID(), config) {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Stream session with ID ${sessionId} already exists`);
    }

    const session = {
      queue: [],
      queueSignal: new Subject(),
      closeSignal: new Subject(),
      responseSubject: new Subject(),
      toolUseContent: null,
      toolUseId: "",
      toolName: "",
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig: config?.inferenceConfig ?? this.inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID()
    };

    this.activeSessions.set(sessionId, session);

    return new StreamSession(sessionId, this);
  }

  // Process tool use requests - handles date/time and weather tools
  async processToolUse(toolName, toolUseContent) {
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
  async parseToolUseContentForWeather(toolUseContent) {
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
  async fetchWeatherData(latitude, longitude) {
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
      if (axios.isAxiosError(error)) {
        console.error(`Error fetching weather data: ${error.message}`, error);
      } else {
        console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)} `, error);
      }
      throw error;
    }
  }

  // Initialize a session with AWS Bedrock
  async initiateSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Stream session ${sessionId} not found`);
    }

    try {
      console.log(`=== INITIATING SESSION ${sessionId} ===`);
      console.log(`1. Setting up sessionStart event`);
      
      // Set up initial events for this session
      // This will clear the queue and add the sessionStart event as the first event
      this.setupSessionStartEvent(sessionId);
      
      // Wait a moment to ensure events are properly queued
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create the bidirectional stream with session-specific async iterator
      const asyncIterable = this.createSessionAsyncIterable(sessionId);

      console.log(`2. Starting bidirectional stream for session ${sessionId}...`);
      console.log(`   Queue length: ${session.queue.length}`);

      // Double check that we have events in the queue
      if (session.queue.length === 0) {
        console.warn(`Warning: Queue is empty for session ${sessionId}. Re-adding sessionStart event.`);
        this.setupSessionStartEvent(sessionId);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const response = await this.bedrockRuntimeClient.send(
        new InvokeModelWithBidirectionalStreamCommand({
          modelId: "amazon.nova-sonic-v1:0",
          contentType: "application/json",
          accept: "application/json",
          body: asyncIterable,
        })
      );

      console.log(`3. Stream established for session ${sessionId}, processing responses...`);

      // Process responses for this session
      await this.processResponseStream(sessionId, response);

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
  dispatchEventForSession(sessionId, eventType, data) {
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
  createSessionAsyncIterable(sessionId) {
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
                try {
                  await Promise.race([
                    firstValueFrom(session.queueSignal.pipe(take(1))),
                    firstValueFrom(session.closeSignal.pipe(take(1))).then(() => {
                      throw new Error("Stream closed");
                    })
                  ]);
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

              return {
                value: {
                  chunk: {
                    bytes: new TextEncoder().encode(JSON.stringify(nextEvent))
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
  async processResponseStream(sessionId, response) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      console.log(`Starting to process response stream for session ${sessionId}`);
      let eventCount = 0;
      
      for await (const event of response.body) {
        eventCount++;
        if (eventCount === 1) {
          console.log(`First response event received for session ${sessionId}`);
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
  addEventToSessionQueue(sessionId, event) {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    this.updateSessionActivity(sessionId);
    session.queue.push(event);
    session.queueSignal.next();
  }

  // Set up initial events for a session
  setupSessionStartEvent(sessionId) {
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
  }

  setupPromptStartEvent(sessionId) {
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
    session.isPromptStartSent = true;
  }

  setupSystemPromptEvent(sessionId,
    textConfig = DefaultTextConfiguration,
    systemPromptContent = DefaultSystemPrompt
  ) {
    console.log(`Setting up systemPrompt events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    // Text content start
    const textPromptID = randomUUID();
    // Store the promptName in the session object for reference
    const systemPromptName = session.promptName;
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
          content: systemPromptContent,
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
  }

  setupStartAudioEvent(
    sessionId,
    audioConfig = DefaultAudioInputConfiguration
  ) {
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
    session.isAudioContentStartSent = true;
    console.log(`Initial events setup complete for session ${sessionId}`);
  }

  // Stream an audio chunk for a session
  async streamAudioChunk(sessionId, audioData) {
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
  async sendToolResult(sessionId, toolUseId, result) {
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

  async sendContentEnd(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isAudioContentStartSent) return;

    // Use the session's promptName for consistency
    const audioPromptName = session.promptName;
    
    await this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: audioPromptName,
          contentName: session.audioContentId,
        }
      }
    });

    // Wait to ensure it's processed
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async sendPromptEnd(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isPromptStartSent) return;

    await this.addEventToSessionQueue(sessionId, {
      event: {
        promptEnd: {
          promptName: session.promptName
        }
      }
    });

    // Wait to ensure it's processed
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  async sendSessionEnd(sessionId) {
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
  registerEventHandler(sessionId, eventType, handler) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.responseHandlers.set(eventType, handler);
  }

  // Dispatch an event to registered handlers
  dispatchEvent(sessionId, eventType, data) {
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

  async closeSession(sessionId) {
    if (this.sessionCleanupInProgress.has(sessionId)) {
      console.log(`Cleanup already in progress for session ${sessionId}, skipping`);
      return;
    }
    this.sessionCleanupInProgress.add(sessionId);
    try {
      console.log(`Starting close process for session ${sessionId}`);
      await this.sendContentEnd(sessionId);
      await this.sendPromptEnd(sessionId);
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

  forceCloseSession(sessionId) {
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

module.exports = { NovaSonicBidirectionalStreamClient, StreamSession };