#!/bin/bash

# Set up AWS environment variables
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PROFILE=bedrock-test

# Uncomment for detailed AWS SDK debugging
# export NODE_DEBUG=aws

# Run the test script with additional memory
export NODE_OPTIONS="--max-old-space-size=4096"

echo "Running AWS Bedrock test with profile: $AWS_PROFILE in region: $AWS_REGION"
node test-bedrock.js

echo ""
echo "Test completed. Check bedrock-test-results.log for detailed output."