#!/bin/bash

# Set up AWS environment variables
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PROFILE=bedrock-test
export NODE_DEBUG=aws

# Run the test script
echo "Running AWS Bedrock test with profile: $AWS_PROFILE in region: $AWS_REGION"
node test-bedrock.js