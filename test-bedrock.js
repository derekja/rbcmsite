// Enhanced AWS Bedrock test script to compare implementations
const { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { fromIni } = require('@aws-sdk/credential-providers');
const { NodeHttp2Handler } = require('@smithy/node-http-handler');
const { randomUUID } = require('crypto');

// Import the working code from the sample
const path = require('path');
const fs = require('fs');
const samplePath = '/Users/derekja/projects/csc130/amazon-nova-samples/speech-to-speech/sample-codes/websocket-nodejs';
const { NovaSonicBidirectionalStreamClient } = require(path.join(samplePath, 'dist/client'));

// Import our implementation
const ourClientPath = './src/components/nova-sonic/server-client';
const { NovaSonicBidirectionalStreamClient: OurNovaSonicClient } = require(ourClientPath);

async function logEventQueueContent(client, sessionId) {
  const sessionData = client.activeSessions.get(sessionId);
  if (!sessionData) {
    console.log('No session data found for', sessionId);
    return;
  }
  
  console.log(`Queue contents for session ${sessionId}:`);
  console.log(`Queue length: ${sessionData.queue.length}`);
  if (sessionData.queue.length > 0) {
    console.log('First few items:');
    for (let i = 0; i < Math.min(3, sessionData.queue.length); i++) {
      console.log(`- Item ${i}:`, JSON.stringify(sessionData.queue[i]).substring(0, 200) + '...');
    }
  }
}

async function testBedrockAccess() {
  console.log('Enhanced testing of AWS Bedrock access with detailed comparison...');
  
  try {
    // Set up test config - use same credentials for both tests
    const credentials = fromIni({ profile: 'bedrock-test' });
    const region = "us-east-1";
    
    console.log('Test configuration:');
    console.log('- Region:', region);
    console.log('- Profile: bedrock-test');
    
    // First test using the working sample's implementation
    console.log('\n1. TESTING WITH WORKING SAMPLE IMPLEMENTATION:');
    
    const workingClient = new NovaSonicBidirectionalStreamClient({
      requestHandlerConfig: {
        maxConcurrentStreams: 10,
        requestTimeout: 120000, // 2 minutes
        connectionTimeout: 120000 // 2 minutes
      },
      clientConfig: {
        region: region,
        credentials: credentials
      }
    });
    
    console.log('Working sample client initialized');
    
    // Create a test session
    console.log('Creating test session with working sample code...');
    const workingSessionId = randomUUID();
    const workingSession = workingClient.createStreamSession(workingSessionId);
    
    // Set up handlers for the response
    let receivedTextResponse = false;
    let receivedAudioResponse = false;
    
    workingSession.onEvent('textOutput', (data) => {
      console.log('Received text response from working implementation:', data.content.substring(0, 50) + '...');
      receivedTextResponse = true;
    });
    
    workingSession.onEvent('audioOutput', () => {
      console.log('Received audio response from working implementation');
      receivedAudioResponse = true;
    });
    
    workingSession.onEvent('error', (error) => {
      console.error('Error from working implementation:', error);
    });
    
    // Try to initialize
    console.log('Initializing session with working implementation...');
    try {
      await workingClient.initiateSession(workingSessionId);
      console.log('Session initialized successfully with working implementation');
      
      // Inspect queue for debugging
      await logEventQueueContent(workingClient, workingSessionId);
      
      // Setup sequence
      console.log('Setting up prompt start...');
      await workingSession.setupPromptStart();
      
      console.log('Setting up system prompt...');
      await workingSession.setupSystemPrompt(undefined, "You are a helpful AI assistant");
      
      console.log('Setting up audio start...');
      await workingSession.setupStartAudio();
      
      // Wait for response with periodic status updates
      console.log('\nWaiting for response...');
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (receivedTextResponse || receivedAudioResponse) {
          break;
        }
        if (i % 2 === 0) {
          console.log(`Still waiting... (${i+1}s)`);
        }
      }
      
      console.log('\nWorking implementation results:');
      console.log('- Text response received:', receivedTextResponse);
      console.log('- Audio response received:', receivedAudioResponse);
      
      // Close the session
      console.log('Closing working implementation session...');
      await workingSession.endAudioContent();
      await workingSession.endPrompt();
      await workingSession.close();
      console.log('Working implementation session closed');
    } catch (error) {
      console.error('Error with working sample implementation:', error);
    }
    
    // Now test using our implementation
    console.log('\n2. TESTING WITH OUR IMPLEMENTATION:');
    
    try {
      const ourClient = new OurNovaSonicClient({
        requestHandlerConfig: {
          maxConcurrentStreams: 10,
          requestTimeout: 120000, // 2 minutes
          connectionTimeout: 120000 // 2 minutes
        },
        clientConfig: {
          region: region,
          credentials: credentials
        }
      });
      
      console.log('Our implementation client initialized');
      
      // Create a test session with our implementation
      console.log('Creating test session with our implementation...');
      const ourSessionId = randomUUID();
      const ourSession = ourClient.createStreamSession(ourSessionId);
      
      // Set up handlers for the response
      let ourReceivedTextResponse = false;
      let ourReceivedAudioResponse = false;
      
      ourSession.onEvent('textOutput', (data) => {
        console.log('Received text response from our implementation:', data.content.substring(0, 50) + '...');
        ourReceivedTextResponse = true;
      });
      
      ourSession.onEvent('audioOutput', () => {
        console.log('Received audio response from our implementation');
        ourReceivedAudioResponse = true;
      });
      
      ourSession.onEvent('error', (error) => {
        console.error('Error from our implementation:', error);
      });
      
      // Try to initialize
      console.log('Initializing session with our implementation...');
      await ourClient.initiateSession(ourSessionId);
      console.log('Session initialized successfully with our implementation');
      
      // Inspect queue for debugging
      await logEventQueueContent(ourClient, ourSessionId);
      
      // Setup sequence
      console.log('Setting up prompt start...');
      await ourSession.setupPromptStart();
      
      console.log('Setting up system prompt...');
      await ourSession.setupSystemPrompt(undefined, "You are a helpful AI assistant");
      
      console.log('Setting up audio start...');
      await ourSession.setupStartAudio();
      
      // Wait for response with periodic status updates
      console.log('\nWaiting for response...');
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (ourReceivedTextResponse || ourReceivedAudioResponse) {
          break;
        }
        if (i % 2 === 0) {
          console.log(`Still waiting... (${i+1}s)`);
        }
      }
      
      console.log('\nOur implementation results:');
      console.log('- Text response received:', ourReceivedTextResponse);
      console.log('- Audio response received:', ourReceivedAudioResponse);
      
      // Close the session
      console.log('Closing our implementation session...');
      await ourSession.endAudioContent();
      await ourSession.endPrompt();
      await ourSession.close();
      console.log('Our implementation session closed');
      
      // Create an implementation comparison summary
      console.log('\nIMPLEMENTATION COMPARISON SUMMARY:');
      console.log('Working implementation:');
      console.log('- Text response received:', receivedTextResponse);
      console.log('- Audio response received:', receivedAudioResponse);
      console.log('\nOur implementation:');
      console.log('- Text response received:', ourReceivedTextResponse);
      console.log('- Audio response received:', ourReceivedAudioResponse);
      
    } catch (error) {
      console.error('Error with our implementation:', error);
    }
    
    // Low-level test of direct API call
    console.log('\n3. TESTING DIRECT BEDROCK API CALL:');
    
    const config = {
      requestHandlerConfig: {
        maxConcurrentStreams: 10,
        requestTimeout: 120000, // 2 minutes
        connectionTimeout: 120000 // 2 minutes
      },
      clientConfig: {
        region: region,
        credentials: credentials
      }
    };
    
    const nodeHttp2Handler = new NodeHttp2Handler(config.requestHandlerConfig);
    
    const bedrockClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      credentials: config.clientConfig.credentials,
      region: config.clientConfig.region,
      requestHandler: nodeHttp2Handler
    });
    
    console.log('Direct Bedrock client initialized');
    
    // Create a simple async iterator for the stream - using simpler text-only prompt
    const promptName = `test-prompt-${randomUUID().substring(0, 8)}`;
    const systemPromptId = `system-${randomUUID().substring(0, 8)}`;
    const userPromptId = `user-${randomUUID().substring(0, 8)}`;
    
    const asyncIterable = {
      [Symbol.asyncIterator]: async function* () {
        // Simple start message
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                sessionStart: {
                  inferenceConfiguration: {
                    maxTokens: 1024,
                    topP: 0.9,
                    temperature: 0.7,
                  }
                }
              }
            }))
          }
        };
        
        // Prompt start
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                promptStart: {
                  promptName: promptName,
                  textOutputConfiguration: {
                    mediaType: "text/plain",
                  }
                }
              }
            }))
          }
        };
        
        // System prompt
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                contentStart: {
                  promptName: promptName,
                  contentName: systemPromptId,
                  type: "TEXT",
                  interactive: true,
                  role: "SYSTEM",
                  textInputConfiguration: {
                    mediaType: "text/plain",
                  }
                }
              }
            }))
          }
        };
        
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                textInput: {
                  promptName: promptName,
                  contentName: systemPromptId,
                  content: "You are a helpful AI assistant. Keep your responses short and concise."
                }
              }
            }))
          }
        };
        
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                contentEnd: {
                  promptName: promptName,
                  contentName: systemPromptId
                }
              }
            }))
          }
        };
        
        // User text input
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                contentStart: {
                  promptName: promptName,
                  contentName: userPromptId,
                  type: "TEXT",
                  interactive: true,
                  role: "USER",
                  textInputConfiguration: {
                    mediaType: "text/plain",
                  }
                }
              }
            }))
          }
        };
        
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                textInput: {
                  promptName: promptName,
                  contentName: userPromptId,
                  content: "Hello, what is the date today?"
                }
              }
            }))
          }
        };
        
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                contentEnd: {
                  promptName: promptName,
                  contentName: userPromptId
                }
              }
            }))
          }
        };
        
        // End prompt
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                promptEnd: {
                  promptName: promptName
                }
              }
            }))
          }
        };
        
        // End session
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                sessionEnd: {}
              }
            }))
          }
        };
      }
    };
    
    console.log('Sending direct request to Bedrock Nova Sonic...');
    
    try {
      // Invoke the model
      const response = await bedrockClient.send(
        new InvokeModelWithBidirectionalStreamCommand({
          modelId: "amazon.nova-sonic-v1:0", 
          body: asyncIterable,
        })
      );
      
      console.log('Received direct response from Bedrock. Processing...');
      
      // Process the response
      let directResponseReceived = false;
      
      for await (const event of response.body) {
        if (event.chunk?.bytes) {
          const textResponse = new TextDecoder().decode(event.chunk.bytes);
          try {
            const jsonResponse = JSON.parse(textResponse);
            console.log('Received direct response event:', JSON.stringify(jsonResponse, null, 2));
            
            // Check for text output
            if (jsonResponse.event?.textOutput) {
              directResponseReceived = true;
              console.log('Direct text response content:', jsonResponse.event.textOutput.content);
            }
          } catch (e) {
            console.log('Raw text response (parse error):', textResponse);
          }
        } else if (event.modelStreamErrorException) {
          console.error('Direct model stream error:', event.modelStreamErrorException);
        } else if (event.internalServerException) {
          console.error('Direct internal server error:', event.internalServerException);
        }
      }
      
      console.log('\nDirect API call results:');
      console.log('- Response received:', directResponseReceived);
      
    } catch (error) {
      console.error('Error with direct API call:', error);
    }
    
    console.log('\nAll tests completed');
    console.log('\n==========\nSUMMARY:\n');
    console.log('1. Working implementation:', receivedTextResponse ? 'SUCCESS' : 'FAILED');
    console.log('2. Our implementation:', ourReceivedTextResponse ? 'SUCCESS' : 'FAILED');
    console.log('3. Direct API call:', directResponseReceived ? 'SUCCESS' : 'FAILED');
    
    // Generate recommendations based on test results
    console.log('\nRECOMMENDATIONS:');
    if (!receivedTextResponse && !ourReceivedTextResponse && !directResponseReceived) {
      console.log('All tests failed. This suggests an AWS access or permissions issue.');
      console.log('Please verify your AWS credentials have access to Bedrock and Nova Sonic.');
      console.log('Verify your IAM policy includes bedrock:InvokeModel and bedrock:InvokeModelWithBidirectionalStream permissions.');
    } else if (receivedTextResponse && !ourReceivedTextResponse) {
      console.log('Working implementation succeeded but ours failed. This suggests an implementation difference.');
      console.log('Check for differences in the event sequence or format between the two implementations.');
    }
    
  } catch (error) {
    console.error('Error testing Bedrock access:', error);
    if (error.Code === 'AccessDeniedException' || error.name === 'AccessDeniedException') {
      console.error('Access denied. Check if your AWS credentials have access to Bedrock and Nova Sonic.');
      console.error('Verify your IAM policy includes bedrock:InvokeModel and bedrock:InvokeModelWithBidirectionalStream permissions.');
    } else if (error.name === 'UnrecognizedClientException') {
      console.error('Authentication failed. Please check your AWS credentials.');
    } else if (error.name === 'ResourceNotFoundException') {
      console.error('Nova Sonic model not found. Check if it\'s available in your region (us-east-1).');
      console.error('You may need to request access to the model in the AWS console.');
    }
  }
}

// Save original console.log and console.error to capture output
const originalLog = console.log;
const originalError = console.error;
let logOutput = [];

// Override console.log to capture output
console.log = function(...args) {
  logOutput.push(args.join(' '));
  originalLog.apply(console, args);
};

console.error = function(...args) {
  logOutput.push('[ERROR] ' + args.join(' '));
  originalError.apply(console, args);
};

// Run the test and save output to file
async function runAndSaveOutput() {
  try {
    await testBedrockAccess();
  } finally {
    // Restore console functions
    console.log = originalLog;
    console.error = originalError;
    
    // Save output to file
    const outputPath = './bedrock-test-results.log';
    fs.writeFileSync(outputPath, logOutput.join('\n'));
    console.log(`Test results saved to ${outputPath}`);
  }
}

runAndSaveOutput();