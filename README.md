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

2. Start the development server:
   ```
   npm start
   ```

3. Build for production:
   ```
   npm run build
   ```

## AWS Configuration

This application uses AWS Bedrock's Nova Sonic model for speech-to-speech interaction. For development:

1. Configure AWS credentials
2. Update the region in NovaSonicService.js if needed (default: us-east-1)

## Deployment

The website will be deployed on AWS EC2 using:
- Node.js for the backend
- React and Bootstrap for the frontend
- Nginx as the webserver
- Route53 for name resolution
- Basic authentication with:
  - Username: museum
  - Password: objects