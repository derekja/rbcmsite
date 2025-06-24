import { AudioType, AudioMediaType, TextMediaType } from "./types";

export const DefaultInferenceConfiguration = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const DefaultToolSchema = JSON.stringify({
  "type": "object",
  "properties": {},
  "required": []
});

export const WeatherToolSchema = JSON.stringify({
  "type": "object",
  "properties": {
    "latitude": {
      "type": "string",
      "description": "Geographical WGS84 latitude of the location."
    },
    "longitude": {
      "type": "string",
      "description": "Geographical WGS84 longitude of the location."
    }
  },
  "required": ["latitude", "longitude"]
});

export const DefaultTextConfiguration = { mediaType: "text/plain" as TextMediaType };

export const DefaultSystemPrompt = "You are a museum guide who can tell people about objects in the Royal BC Museum's collection. " +
  "The user and you will engage in a spoken dialog exchanging the transcripts of a natural real-time conversation. " +
  "Keep your responses informative yet conversational, generally two or three sentences for each response. " +
  "The objects are part of a special collection highlighting the history and cultural importance of British Columbia.";

export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 24000,
  voiceId: "tiffany",
};