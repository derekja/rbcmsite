# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a site to hold images and prompts from students to use to explore the AWS nova sonic speech-to-speech model for conversations about objects in the 100 objects of interest collection.

## Development Commands
When development starts, common commands for building, testing, and running the application should be documented here.

## Architecture
The website will be deployed on AWS EC2 and will be a nodejs website using react and bootstrap for styling. It will use nginx as the webserver and be connected through route53 for the name resolution. It will not use cloudfront in this instance. The basic site will be secured using nginx basic authentication with the username "museum" and the password "objects"

This site will be set up in the us-east-1 region since that is where I have AWS bedrock access to use the nova sonic model.

## user interface

The base page will be a grid of images that can be found in https://drive.google.com/drive/folders/1YXGb80tWNxMb1gZ31n-JT8aqjyMi1SZX

The prompts for each image can be found in https://docs.google.com/spreadsheets/d/1HzxaGN0f1mEg5Kz37q9glAca5Nc3R1yf70M1j59CpSE/edit?gid=0#gid=0

Each image in the grid will have two buttons. One will allow the user to talk to the model using the prompt. The second button will show the prompt in an editable popup textbox and changes will be saved to be used the next time the user presses the "speak" button.

## development steps

checkin changes after each step

1. create a github repo for this project (rbcmsite on github user derekja)
2. create the website framework for a grid of images with the button pairs on them
3. create the prompt edit dialog as a popup from each image
4. populate the images and prompts from the above noted google drive and google sheet
5. hook the speak button up to nova sonic using the prompt for each image. There is no need to have a welcome message, just directly wait for speech input and play back the voice when spoken to. Subsequent presses of the speak button will retain conversational context for that object until the user presses speak on a different object, or they change the prompt.
