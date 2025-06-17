/**
 * Type definitions for Nova Sonic implementation
 */

export const ContentType = {
  AUDIO: "AUDIO",
  TEXT: "TEXT",
  TOOL: "TOOL"
};

export const AudioType = {
  SPEECH: "SPEECH"
};

export const AudioMediaType = {
  LPCM: "audio/lpcm"
};

export const TextMediaType = {
  PLAIN: "text/plain",
  JSON: "application/json"
};

/**
 * Default inference configuration
 */
export const DefaultInferenceConfiguration = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

/**
 * Audio input configuration
 */
export const DefaultAudioInputConfiguration = {
  audioType: AudioType.SPEECH,
  encoding: "base64",
  mediaType: AudioMediaType.LPCM,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

/**
 * Audio output configuration 
 */
export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 24000,
  voiceId: "tiffany",
};

/**
 * Default text configuration
 */
export const DefaultTextConfiguration = { 
  mediaType: TextMediaType.PLAIN
};

/**
 * Default system prompt
 */
export const DefaultSystemPrompt = "You are a museum guide who can tell people about objects in the Royal BC Museum's collection. " +
  "The user and you will engage in a spoken dialog exchanging the transcripts of a natural real-time conversation. " +
  "Keep your responses informative yet conversational, generally two or three sentences for each response. " +
  "The objects are part of a special collection highlighting the history and cultural importance of British Columbia.";

/**
 * Default tool schema
 */
export const DefaultToolSchema = JSON.stringify({
  "type": "object",
  "properties": {},
  "required": []
});