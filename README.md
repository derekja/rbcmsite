# RBCM Objects of Interest

A web application to explore the Royal BC Museum's 100 objects of interest collection using AWS Nova Sonic speech-to-speech model.

## Overview

This application allows users to interact with the objects from the RBCM collection using speech. Users can:

- View a grid of objects from the collection
- Talk to an AI model about specific objects using the AWS Nova Sonic speech-to-speech service
- Edit the prompts used for each object

## Development Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Configure AWS:
   - Make sure you have AWS credentials configured in your AWS CLI (`~/.aws/credentials`)
   - Ensure you have access to AWS Bedrock and Nova Sonic in the us-east-1 region
   - Update `.env` file with your AWS profile name if different from default:
     ```
     AWS_PROFILE=your-profile-name
     ```

3. Start the server (which handles both WebSocket connections and serves the React app):
   ```
   npm run server
   ```

4. For development with hot-reloading:
   ```
   # In terminal 1: Start the React development server
   npm start
   
   # In terminal 2: Start the WebSocket server
   npm run server
   ```

5. Build for production:
   ```
   npm run build
   ```

## Architecture

The application consists of:

1. **WebSocket Server**: 
   - Uses Socket.IO for real-time bidirectional communication
   - Handles Nova Sonic bidirectional streams with AWS Bedrock
   - Manages audio streaming sessions between client and Bedrock

2. **React Frontend**:
   - Grid layout of museum objects
   - Audio recording and playback interface
   - Prompt editing capabilities

3. **Audio Processing**:
   - Real-time audio streaming with WebSockets
   - Audio worklet for smooth playback
   - Sample rate conversions for different browsers

## AWS Configuration

This application uses AWS Bedrock's Nova Sonic model for speech-to-speech interaction:

1. Required AWS Services:
   - AWS Bedrock with access to `amazon.nova-sonic-v1:0` model
   - Region must be `us-east-1` (required for Nova Sonic)

2. AWS Credentials:
   - Configure your AWS credentials in `~/.aws/credentials`
   - The application uses the AWS SDK to load credentials from your profile

## Deployment

The website will be deployed on AWS EC2 using:
- Node.js for the backend
- React and Bootstrap for the frontend
- Nginx as the webserver
- Route53 for name resolution
- Basic authentication with:
  - Username: museum
  - Password: objects

### Deployment Steps:

1. Build the application:
   ```bash
   npm run build
   ```

2. Transfer files to EC2 server:
   ```bash
   scp -r build/* ec2-user@your-ec2-instance:/path/to/webroot/
   ```

3. Configure Nginx (example config in `nginx.conf`):
   ```bash
   sudo cp nginx.conf /etc/nginx/conf.d/rbcm-site.conf
   sudo systemctl restart nginx
   ```

4. Run the Node.js server:
   ```bash
   # Using PM2 for production
   pm2 start server.js --name rbcm-site
   ```