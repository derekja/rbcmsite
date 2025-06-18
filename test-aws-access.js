//import { fromIni } from "@aws-sdk/credential-providers";

// Simple AWS Bedrock access test
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { fromIni } = require('@aws-sdk/credential-providers');

// Create the AWS Bedrock client
//const bedrockRuntimeClient = new BedrockRuntimeClient({
//    region: process.env.AWS_REGION || "us-east-1",
//    credentials: fromIni({ profile: "bedrock-test" })
//});

async function testAwsAccess() {
  console.log('Testing AWS Bedrock access...');
  
  try {
    console.log('Using hardcoded us-east-1 region for Bedrock');
    console.log('AWS_PROFILE environment variable:', process.env.AWS_PROFILE);
    
    // Log available profiles
    try {
      const { loadSharedConfigFiles } = require('@aws-sdk/shared-ini-file-loader');
      const sharedConfig = await loadSharedConfigFiles();
      console.log('Available profiles in AWS config:', Object.keys(sharedConfig.configFile));
      console.log('Available profiles in AWS credentials:', Object.keys(sharedConfig.credentialsFile));
    } catch (e) {
      console.error('Error loading shared config files:', e);
    }
    
    const profile = "bedrock-test";
    console.log(`Using profile: ${profile}`);
    
    const credentials = fromIni({ profile });
    console.log('Credentials provider created. Attempting to load credentials...');
    
    try {
      // Force credentials to resolve
      const resolvedCreds = await credentials();
      console.log('Credentials resolved successfully!');
      console.log('Access Key ID starts with:', resolvedCreds.accessKeyId.substring(0, 4) + '...');
      console.log('Secret Access Key exists:', !!resolvedCreds.secretAccessKey);
      console.log('Session Token exists:', !!resolvedCreds.sessionToken);
    } catch (e) {
      console.error('Failed to resolve credentials:', e);
    }
    
    const client = new BedrockRuntimeClient({
      region: "us-east-1",
      credentials: fromIni({ profile })
    });
    
    console.log('BedrockRuntimeClient created');
    console.log('Client config:', {
      region: client.config.region,
      endpoint: client.config.endpoint,
      maxAttempts: client.config.maxAttempts
    });

    console.log('Attempting to invoke Amazon Titan model (simple test)...');
    const response = await client.send(new InvokeModelCommand({
      modelId: 'amazon.titan-text-express-v1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: 'Hello, are you working?',
        textGenerationConfig: {
          maxTokenCount: 50,
          temperature: 0.7,
          topP: 0.9
        }
      })
    }));
    
    // Parse the response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    console.log('SUCCESS! We can access AWS Bedrock');
    console.log('Model response:', responseBody.results[0].outputText);
    
    console.log('Now testing Nova Sonic model availability...');
    try {
      // We're not actually invoking the Nova Sonic model, just checking if we get
      // the right error (invalid input, not access denied or model not found)
      await client.send(new InvokeModelCommand({
        modelId: 'amazon.nova-sonic-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ text: 'test' })
      }));
      console.log('⚠️ Unexpected success with Nova Sonic - this should have failed with invalid input');
    } catch (error) {
      // If we get ValidationException, the model exists but our input format is wrong
      // which is what we expect (since we need to use streaming API for Nova Sonic)
      if (error.name === 'ValidationException') {
        console.log('✅ Nova Sonic model is available (expected ValidationException for incorrect input format)');
      } else if (error.name === 'AccessDeniedException') {
        console.log('❌ Access denied to Nova Sonic model - check your AWS account permissions');
      } else if (error.name === 'ResourceNotFoundException' || error.message.includes('not found')) {
        console.log('❌ Nova Sonic model not found - check your AWS region and account access');
      } else {
        console.log('❓ Unexpected error with Nova Sonic:', error.name);
        console.log(error.message);
      }
    }
    
    return true;
  } catch (error) {
    console.error('ERROR accessing AWS Bedrock:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error status:', error.$metadata?.httpStatusCode);
    console.error('Error stack:', error.stack);
    
    // Give specific advice based on error type
    if (error.name === 'ResourceNotFoundException') {
      console.error('The requested resource was not found - check your AWS region');
    } else if (error.name === 'AccessDeniedException') {
      console.error('Access denied - check your IAM permissions for Bedrock');
    } else if (error.name === 'UnrecognizedClientException') {
      console.error('Invalid AWS credentials - check your AWS_PROFILE setting');
    } else if (error.name === 'CredentialsProviderError') {
      console.error('Credentials provider error - check your ~/.aws/credentials file');
      console.error('Make sure the profile exists and has valid credentials');
    } else if (error.$metadata?.httpStatusCode === 403) {
      console.error('Forbidden (403) - You do not have permission to use this service');
      console.error('Check your IAM policy and ensure it has bedrock:InvokeModel permission');
    }
    
    return false;
  }
}

// Run the test
testAwsAccess()
  .then(success => {
    console.log(`Test ${success ? 'PASSED' : 'FAILED'}`);
    process.exit(success ? 0 : 1);
  });