import React, { useState, useEffect, useRef } from 'react';
import { Button, Spinner } from 'react-bootstrap';

const SpeechInteraction = ({ object, novaSonicService }) => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [responseAudio, setResponseAudio] = useState(null);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  
  // Set up audio recording
  const startListening = async () => {
    try {
      setError(null);
      setIsListening(true);
      
      console.log('Requesting microphone access...');
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Create media recorder with specific options for better compatibility
      const options = { 
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      };
      
      try {
        mediaRecorderRef.current = new MediaRecorder(stream, options);
      } catch (e) {
        // Fallback for browsers that don't support the specified mime type
        console.log('Falling back to default MediaRecorder options');
        mediaRecorderRef.current = new MediaRecorder(stream);
      }
      
      // Reset audio chunks
      audioChunksRef.current = [];
      
      // Set up event handlers
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        setError('Error recording audio. Please try again.');
        setIsListening(false);
      };
      
      // Handle recording stop
      mediaRecorderRef.current.onstop = () => {
        console.log('Recording stopped, processing audio...');
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
        
        setIsListening(false);
        setIsProcessing(true);
        
        // Using setTimeout to ensure async handler doesn't cause the message channel closed error
        setTimeout(() => {
          try {
            // Create audio blob from recorded chunks
            if (audioChunksRef.current.length === 0) {
              setError('No audio recorded. Please try again.');
              setIsProcessing(false);
              return;
            }
            
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            console.log('Audio recorded, blob size:', audioBlob.size);
            
            // Process with Nova Sonic
            processAudio(audioBlob).catch(err => {
              console.error('Error in audio processing:', err);
              setError('Error processing speech. Please try again.');
              setIsProcessing(false);
            });
          } catch (err) {
            console.error('Error creating audio blob:', err);
            setError('Error processing speech. Please try again.');
            setIsProcessing(false);
          }
        }, 0);
      };
      
      // Start recording with 100ms timeslice to get more frequent ondataavailable events
      mediaRecorderRef.current.start(100);
      console.log('Recording started...');
      
    } catch (err) {
      console.error('Error starting audio recording:', err);
      setError('Could not access microphone. Please check permissions and try again.');
      setIsListening(false);
    }
  };
  
  // Stop recording
  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };
  
  // Process audio with Nova Sonic
  const processAudio = async (audioBlob) => {
    try {
      console.log('Sending audio to Nova Sonic service...');
      
      // Call Nova Sonic service with the prompt and recorded audio
      const response = await novaSonicService.startConversation(object.prompt, audioBlob, object.id);
      console.log('Nova Sonic response received:', response);
      
      // Set the audio response to play
      setResponseAudio(response.audioResponse);
      
      // Create a safe user audio URL that won't cause memory leaks
      const userAudioUrl = URL.createObjectURL(audioBlob);
      
      // Update conversation history
      const updatedHistory = [...(object.conversationHistory || [])];
      updatedHistory.push({
        timestamp: new Date(),
        userAudio: userAudioUrl,
        botResponse: response.textResponse,
        botAudio: response.audioResponse
      });
      
      // Add the conversation to the object's history
      object.conversationHistory = updatedHistory;
      
      // Safely play the audio response
      try {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = response.audioResponse;
          
          // Set up proper event handlers for audio playback
          audioRef.current.oncanplaythrough = () => {
            console.log('Audio ready to play');
            const playPromise = audioRef.current.play();
            
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  console.log('Audio playback started');
                })
                .catch(e => {
                  console.error('Error playing audio:', e);
                  // Show play button if autoplay is blocked
                  audioRef.current.controls = true;
                  audioRef.current.classList.remove('d-none');
                });
            }
          };
          
          audioRef.current.onerror = (e) => {
            console.error('Audio playback error:', e);
            setError('Error playing audio response.');
          };
        }
      } catch (audioError) {
        console.error('Error setting up audio playback:', audioError);
      }
      
      setIsProcessing(false);
    } catch (err) {
      console.error('Error in Nova Sonic processing:', err);
      setError('Error communicating with Nova Sonic. Please try again.');
      setIsProcessing(false);
    }
  };
  
  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      // Clean up media recorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch (err) {
          console.error('Error stopping media recorder during cleanup:', err);
        }
      }
      
      // Release audio blob URLs to prevent memory leaks
      if (responseAudio) {
        try {
          URL.revokeObjectURL(responseAudio);
        } catch (err) {
          console.error('Error revoking audio URL:', err);
        }
      }
      
      // Stop audio playback
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = '';
          audioRef.current.load();
        } catch (err) {
          console.error('Error cleaning up audio element:', err);
        }
      }
    };
  }, [responseAudio]);
  
  return (
    <div className="speech-interaction">
      {error && <div className="error-message alert alert-danger">{error}</div>}
      
      {isListening ? (
        <Button 
          variant="danger" 
          onClick={stopListening}
          className="pulse-animation"
        >
          <span className="me-2">●</span> Stop Recording
        </Button>
      ) : isProcessing ? (
        <Button variant="secondary" disabled>
          <Spinner 
            as="span" 
            animation="border" 
            size="sm" 
            role="status" 
            aria-hidden="true" 
            className="me-2"
          />
          Processing...
        </Button>
      ) : (
        <Button 
          variant="primary" 
          onClick={startListening}
        >
          Speak
        </Button>
      )}
      
      {/* Audio player for response */}
      <audio 
        ref={audioRef} 
        controls={false} 
        className="d-none" 
        preload="auto"
      />
      
      {/* Show text response for debugging */}
      {responseAudio && object && object.conversationHistory && object.conversationHistory.length > 0 && (
        <div className="mt-3 small text-muted">
          <p>Last response: {object.conversationHistory[object.conversationHistory.length - 1].botResponse}</p>
        </div>
      )}
    </div>
  );
};

export default SpeechInteraction;