// Simple AWS Bedrock test script
const { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { fromIni } = require('@aws-sdk/credential-providers');
const { NodeHttp2Handler } = require('@smithy/node-http-handler');
const { randomUUID } = require('crypto');

// Import the working code from the sample
const path = require('path');
const samplePath = '/Users/derekja/projects/csc130/amazon-nova-samples/speech-to-speech/sample-codes/websocket-nodejs';
const { NovaSonicBidirectionalStreamClient } = require(path.join(samplePath, 'dist/client'));

async function testBedrockAccess() {
  console.log('Testing AWS Bedrock access using both our implementation and the working sample...');
  
  try {
    // First test using the working sample's implementation
    console.log('1. Testing with working sample implementation:');
    
    const workingClient = new NovaSonicBidirectionalStreamClient({
      requestHandlerConfig: {
        maxConcurrentStreams: 10,
      },
      clientConfig: {
        region: "us-east-1",
        credentials: fromIni({ profile: 'bedrock-test' })
      }
    });
    
    console.log('Working sample client initialized');
    
    // Create a test session
    console.log('Creating test session with working sample code...');
    const sessionId = randomUUID();
    const session = workingClient.createStreamSession(sessionId);
    
    // Set up a handler for the response
    let receivedResponse = false;
    session.onEvent('textOutput', (data) => {
      console.log('Received text response:', data);
      receivedResponse = true;
    });
    
    // Try to initialize
    console.log('Initializing session...');
    try {
      await workingClient.initiateSession(sessionId);
      
      // Setup sequence
      await session.setupPromptStart();
      await session.setupSystemPrompt(undefined, "You are a helpful AI assistant");
      await session.setupStartAudio();
      
      // Wait a bit to see if we get any response
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('Response received from working sample implementation:', receivedResponse);
      
      // Close the session
      await session.endAudioContent();
      await session.endPrompt();
      await session.close();
    } catch (error) {
      console.error('Error with working sample implementation:', error);
    }
    
    // Now test using our implementation
    console.log('\n2. Testing with our implementation:');
    
    const config = {
      requestHandlerConfig: {
        maxConcurrentStreams: 10,
        requestTimeout: 300000, // 5 minutes
        connectionTimeout: 300000 // 5 minutes
      },
      clientConfig: {
        region: 'us-east-1',
        credentials: fromIni({ profile: 'bedrock-test' })
      }
    };
    
    const nodeHttp2Handler = new NodeHttp2Handler(config.requestHandlerConfig);
    
    const bedrockClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      credentials: config.clientConfig.credentials,
      region: config.clientConfig.region,
      requestHandler: nodeHttp2Handler
    });
    
    console.log('Our Bedrock client initialized');
    console.log('Region:', config.clientConfig.region);
    
    // Create a simple async iterator for the stream
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
                  promptName: "test-prompt",
                  textOutputConfiguration: {
                    mediaType: "text/plain",
                  },
                  audioOutputConfiguration: {
                    mediaType: "audio/pcm",
                    sampleRate: 24000,
                  }
                }
              }
            }))
          }
        };
        
        // System prompt
        const promptId = "test-content";
        
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                contentStart: {
                  promptName: "test-prompt",
                  contentName: promptId,
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
                  promptName: "test-prompt",
                  contentName: promptId,
                  content: "You are a helpful AI assistant."
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
                  promptName: "test-prompt",
                  contentName: promptId
                }
              }
            }))
          }
        };
        
        // User text input
        const userPromptId = "user-prompt";
        
        yield {
          chunk: {
            bytes: Buffer.from(JSON.stringify({
              event: {
                contentStart: {
                  promptName: "test-prompt",
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
                  promptName: "test-prompt",
                  contentName: userPromptId,
                  content: "Hello, what's the weather today?"
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
                  promptName: "test-prompt",
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
                  promptName: "test-prompt"
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
    
    console.log('Sending request to Bedrock Nova Sonic...');
    
    // Invoke the model
    const response = await bedrockClient.send(
      new InvokeModelWithBidirectionalStreamCommand({
        modelId: "amazon.nova-sonic-v1:0",
        body: asyncIterable,
      })
    );
    
    console.log('Received response from Bedrock. Processing...');
    
    // Process the response
    for await (const event of response.body) {
      if (event.chunk?.bytes) {
        const textResponse = new TextDecoder().decode(event.chunk.bytes);
        try {
          const jsonResponse = JSON.parse(textResponse);
          console.log('Received response event:', JSON.stringify(jsonResponse, null, 2));
        } catch (e) {
          console.log('Raw text response (parse error):', textResponse);
        }
      } else if (event.modelStreamErrorException) {
        console.error('Model stream error:', event.modelStreamErrorException);
      } else if (event.internalServerException) {
        console.error('Internal server error:', event.internalServerException);
      }
    }
    
    console.log('Test completed successfully');
    
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

// Run the test
testBedrockAccess();