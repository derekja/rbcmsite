#!/bin/bash

# Explicitly set AWS environment variables
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PROFILE=bedrock-test

# Print the values for confirmation
echo "AWS Region: $AWS_REGION"
echo "AWS Default Region: $AWS_DEFAULT_REGION"
echo "AWS Profile: $AWS_PROFILE"

# Start the development server with proper environment
echo "Starting development server with proper AWS environment..."
./dev-start.sh