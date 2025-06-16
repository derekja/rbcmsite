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
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create media recorder
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      
      // Set up event handlers
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      
      mediaRecorderRef.current.onstop = async () => {
        setIsListening(false);
        setIsProcessing(true);
        
        try {
          // Create audio blob from recorded chunks
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Process with Nova Sonic
          await processAudio(audioBlob);
        } catch (err) {
          console.error('Error processing audio:', err);
          setError('Error processing speech. Please try again.');
          setIsProcessing(false);
        }
      };
      
      // Start recording
      mediaRecorderRef.current.start();
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
      // Call Nova Sonic service with the prompt and recorded audio
      const response = await novaSonicService.startConversation(object.prompt, audioBlob);
      
      // Set the audio response to play
      setResponseAudio(response.audioResponse);
      
      // Update conversation history
      const updatedHistory = [...(object.conversationHistory || [])];
      updatedHistory.push({
        timestamp: new Date(),
        userAudio: URL.createObjectURL(audioBlob),
        botResponse: response.textResponse,
        botAudio: response.audioResponse
      });
      
      // Add the conversation to the object's history
      object.conversationHistory = updatedHistory;
      
      // Play the audio response automatically
      if (audioRef.current) {
        audioRef.current.src = response.audioResponse;
        audioRef.current.onloadedmetadata = () => {
          audioRef.current.play().catch(e => console.error('Error playing audio:', e));
        };
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
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);
  
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
      <audio ref={audioRef} controls={false} className="d-none" />
      
      {/* Show text response for debugging */}
      {responseAudio && selectedObject && selectedObject.conversationHistory && selectedObject.conversationHistory.length > 0 && (
        <div className="mt-3 small text-muted">
          <p>Last response: {selectedObject.conversationHistory[selectedObject.conversationHistory.length - 1].botResponse}</p>
        </div>
      )}
    </div>
  );
};

export default SpeechInteraction;