#!/bin/bash

# Run the Express server and the React development server together
echo "Starting the development environment..."

# Kill any running node processes on ports 3000 and 3001
echo "Checking for existing processes on ports 3000 and 3001..."
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
echo "Ports cleared."

# Start the Express server in the background with explicit AWS region
echo "Starting Express server on port 3000..."

# Load AWS credentials environment variables
echo "Loading AWS credentials..."
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PROFILE=bedrock-test
export NODE_DEBUG=aws

# Start server with detailed logging
echo "Starting server with AWS profile: $AWS_PROFILE in region: $AWS_REGION"
DEBUG=socket.io*,aws* AWS_SDK_LOAD_CONFIG=1 PORT=3000 node server.js &
SERVER_PID=$!

# Give the server a moment to start
echo "Waiting for Express server to start..."
sleep 5

# Verify the server is running
if ! lsof -ti :3000 &>/dev/null; then
  echo "ERROR: Express server failed to start on port 3000"
  exit 1
else
  echo "Express server successfully started on port 3000"
fi

# Start the React development server on port 3001
echo "Starting React development server on port 3001..."
# Use react-app-rewired to disable webpack-dev-server WebSockets
FAST_REFRESH=false WDS_SOCKET_PORT=0 PORT=3001 npm run dev:frontend

# When npm start exits, kill the Express server
echo "Shutting down Express server..."
kill $SERVER_PID || true
echo "Development environment shutdown complete."