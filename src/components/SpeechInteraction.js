import React, { useState, useEffect, useRef } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { NovaSonicClient } from './nova-sonic/NovaSonicClient';

const SpeechInteraction = ({ object }) => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [responseAudio, setResponseAudio] = useState(null);
  const [responseText, setResponseText] = useState('');
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState(null);
  
  // Initialize Nova Sonic client
  const novaSonicClientRef = useRef(null);
  const historyRef = useRef([]);
  
  // Initialize Nova Sonic client on mount  
  useEffect(() => {
    console.log('Initializing Nova Sonic client component');
    console.log('Object prompt:', object && object.prompt);
    
    const client = new NovaSonicClient();
    
    client.onConnect(() => {
      console.log('Connected to Nova Sonic server');
      setIsConnected(true);
      setError(null); // Clear any previous errors
    });
    
    client.onDisconnect(() => {
      console.log('Disconnected from Nova Sonic server');
      setIsConnected(false);
      setIsReady(false);
    });
    
    client.onStatusChange((newStatus) => {
      console.log('Nova Sonic status changed:', newStatus);
      setStatus(newStatus);
      
      // Update component state based on status
      if (newStatus === 'connected' || newStatus === 'ready') {
        setIsReady(true);
        setError(null); // Clear errors when ready
      } else if (newStatus === 'recording') {
        setIsListening(true);
        setIsProcessing(false);
      } else if (newStatus === 'processing') {
        setIsListening(false);
        setIsProcessing(true);
      } else if (newStatus === 'receiving') {
        // When actively receiving a response
        setIsListening(false);
        setIsProcessing(true);
      } else if (newStatus === 'disconnected') {
        setIsListening(false);
        setIsProcessing(false);
        setIsReady(false);
      } else if (newStatus === 'error') {
        setIsListening(false);
        setIsProcessing(false);
      }
    });
    
    client.onTextOutput((data) => {
      console.log('Text output received:', data);
      if (data.content && data.role === 'ASSISTANT') {
        setResponseText(data.content);
        setError(null); // Clear errors when getting valid responses
        
        // Update conversation history
        if (!object.conversationHistory) {
          object.conversationHistory = [];
        }
        
        // Find or create a history entry for this turn
        let currentEntry = object.conversationHistory.length > 0 ? 
          object.conversationHistory[object.conversationHistory.length - 1] : null;
          
        if (!currentEntry || currentEntry.botResponse) {
          // Create new entry if none exists or last one is complete
          currentEntry = { timestamp: new Date() };
          object.conversationHistory.push(currentEntry);
        }
        
        // Update the response
        currentEntry.botResponse = data.content;
        
        // Keep internal reference updated
        historyRef.current = object.conversationHistory;
      }
    });
    
    client.onAudioOutput((audioData) => {
      console.log('Audio output received');
      
      // Create blob URL for tracking
      const audioBlob = new Blob([audioData], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      setResponseAudio(audioUrl);
      
      // Update conversation history with audio if we have a current entry
      if (object.conversationHistory && object.conversationHistory.length > 0) {
        const currentEntry = object.conversationHistory[object.conversationHistory.length - 1];
        currentEntry.botAudio = audioUrl;
      }
    });
    
    client.onError((err) => {
      console.error('Nova Sonic error:', err);
      
      // Format a more user-friendly error message
      let errorMessage = err.message || 'Error communicating with Nova Sonic';
      let errorDetails = err.details || '';
      
      // Check for specific errors
      if (errorMessage.includes('initialization') || errorMessage.includes('timed out')) {
        errorMessage = 'Error connecting to voice service';
        errorDetails = 'This could be due to AWS Bedrock access issues. Please check your AWS credentials and permissions.';
      } else if (errorMessage.includes('microphone')) {
        errorMessage = 'Microphone access error';
        errorDetails = 'Please allow microphone access to use speech features';
      }
      
      setError(`${errorMessage}${errorDetails ? ': ' + errorDetails : ''}`);
      setIsProcessing(false);
      setIsListening(false);
      
      // Any error puts the component in error state for better recovery
      setStatus('error');
    });
    
    // Initialize with retry capability
    const initializeClient = async (retryCount = 0) => {
      try {
        const success = await client.initialize();
        if (success) {
          console.log('Nova Sonic client initialized successfully');
          setError(null);
        } else {
          console.error('Failed to initialize Nova Sonic client');
          
          // Retry logic for initialization failures
          if (retryCount < 2) {
            console.log(`Retrying initialization (${retryCount + 1}/3)...`);
            setTimeout(() => initializeClient(retryCount + 1), 2000);
          } else {
            setError('Failed to initialize speech service after multiple attempts');
          }
        }
      } catch (err) {
        console.error('Error during initialization:', err);
        if (retryCount < 2) {
          console.log(`Retrying after error (${retryCount + 1}/3)...`);
          setTimeout(() => initializeClient(retryCount + 1), 2000);
        } else {
          setError('Error initializing speech service. Please try again later.');
        }
      }
    };
    
    // Start initialization
    initializeClient();
    
    novaSonicClientRef.current = client;
    
    // Clean up on unmount
    return () => {
      if (client) {
        client.disconnect();
      }
    };
  }, [object]);
  
  // Start listening
  const startListening = async () => {
    try {
      console.log("START LISTENING called");
      console.log("Object prompt:", object.prompt);
      setError(null);
      
      const client = novaSonicClientRef.current;
      console.log("Client initialized:", !!client);
      if (!client) {
        setError('Speech service not initialized');
        return;
      }
      
      console.log("Current status:", status);
      console.log("Is connected:", isConnected);
      console.log("Is ready:", isReady);
      
      // First stop any previous session to ensure clean state
      try {
        client.stopListening();
        // Allow time for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (stopErr) {
        console.log("No active session to stop or error stopping:", stopErr);
      }
      
      // Start streaming with the object-specific prompt
      console.log("Calling client.startListening with prompt");
      await client.startListening(object.prompt);
      console.log("Client.startListening returned successfully");
    } catch (err) {
      console.error('Error starting listening:', err);
      setError('Could not start listening. Please try again.');
    }
  };
  
  // Stop listening
  const stopListening = () => {
    try {
      const client = novaSonicClientRef.current;
      if (client) {
        client.stopListening();
      }
    } catch (err) {
      console.error('Error stopping listening:', err);
    }
  };
  
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
      ) : isConnected && isReady ? (
        <Button 
          variant="primary" 
          onClick={startListening}
        >
          Speak
        </Button>
      ) : (
        <Button 
          variant="secondary" 
          disabled
        >
          <Spinner 
            as="span" 
            animation="border" 
            size="sm" 
            role="status" 
            aria-hidden="true" 
            className="me-2"
          />
          Connecting...
        </Button>
      )}
      
      {/* Show text response for debugging */}
      {responseText && (
        <div className="mt-3 small text-muted">
          <p>Last response: {responseText}</p>
        </div>
      )}
    </div>
  );
};

export default SpeechInteraction;