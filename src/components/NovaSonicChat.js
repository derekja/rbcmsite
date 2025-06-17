import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, Spinner, Row, Col } from 'react-bootstrap';
import { io } from 'socket.io-client';
import { AudioPlayer } from '../lib/play/AudioPlayer';
import { ChatHistoryManager } from '../lib/util/ChatHistoryManager';

const NovaSonicChat = ({ objectPrompt }) => {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Initializing...');
  const [chat, setChat] = useState({ history: [] });
  const [error, setError] = useState(null);
  const [waitingForUserTranscription, setWaitingForUserTranscription] = useState(false);
  const [waitingForAssistantResponse, setWaitingForAssistantResponse] = useState(false);
  
  // Refs
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const chatContainerRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const sessionInitializedRef = useRef(false);
  
  const TARGET_SAMPLE_RATE = 16000;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  
  // Initialize chat history manager
  const chatHistoryManager = useRef(
    ChatHistoryManager.getInstance(
      chatRef,
      (newChat) => {
        setChat({...newChat});
      }
    )
  ).current;
  
  // Connect to WebSocket server
  useEffect(() => {
    // Initialize audio player
    audioPlayerRef.current = new AudioPlayer();
    audioPlayerRef.current.start();
    
    // Set up WebSocket connection
    socketRef.current = io('http://localhost:3001');
    
    // Event handlers
    socketRef.current.on('connect', () => {
      console.log('Connected to WebSocket server');
      setIsConnected(true);
      setStatus('Connected to server');
      sessionInitializedRef.current = false;
    });
    
    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      setIsConnected(false);
      setStatus('Disconnected from server');
      setIsListening(false);
      setIsProcessing(false);
      hideUserThinkingIndicator();
      hideAssistantThinkingIndicator();
    });
    
    socketRef.current.on('error', (error) => {
      console.error('WebSocket error:', error);
      setError('Error: ' + (error.message || JSON.stringify(error)));
      setIsProcessing(false);
      setIsListening(false);
    });
    
    // Handle content start events
    socketRef.current.on('contentStart', (data) => {
      console.log('Content start received:', data);
      
      if (data.type === 'TEXT') {
        if (data.role === 'USER') {
          hideUserThinkingIndicator();
        } else if (data.role === 'ASSISTANT') {
          hideAssistantThinkingIndicator();
        }
      }
    });
    
    // Handle text output
    socketRef.current.on('textOutput', (data) => {
      console.log('Text output received:', data);
      
      if (data.role === 'USER') {
        hideUserThinkingIndicator();
        
        // Add user message to chat
        chatHistoryManager.addTextMessage({
          role: data.role,
          message: data.content
        });
        
        // Show assistant thinking indicator
        showAssistantThinkingIndicator();
      } else if (data.role === 'ASSISTANT') {
        hideAssistantThinkingIndicator();
        
        chatHistoryManager.addTextMessage({
          role: data.role,
          message: data.content
        });
      }
    });
    
    // Handle audio output
    socketRef.current.on('audioOutput', (data) => {
      if (data.content) {
        try {
          audioPlayerRef.current.playBase64Audio(data.content);
        } catch (error) {
          console.error('Error playing audio:', error);
        }
      }
    });
    
    // Handle content end events
    socketRef.current.on('contentEnd', (data) => {
      console.log('Content end received:', data);
      
      if (data.stopReason && data.stopReason === 'END_TURN') {
        chatHistoryManager.endTurn();
      }
    });
    
    // Handle stream completion
    socketRef.current.on('streamComplete', () => {
      setIsProcessing(false);
      setStatus('Ready to speak');
    });
    
    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop();
      }
      
      cleanupAudioResources();
    };
  }, []);
  
  // Initialize audio for recording
  const initializeAudio = async () => {
    try {
      setStatus('Requesting microphone access...');
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Create audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: TARGET_SAMPLE_RATE
      });
      
      mediaStreamRef.current = stream;
      audioContextRef.current = audioContext;
      
      setStatus('Microphone ready');
      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setError('Could not access microphone. Please check permissions and try again.');
      setStatus('Microphone error');
      return false;
    }
  };
  
  // Initialize session with the server
  const initializeSession = async () => {
    if (sessionInitializedRef.current) return true;
    
    setStatus('Initializing session...');
    
    try {
      // Create system prompt from object prompt
      const systemPrompt = `You are Nova Sonic, an AI assistant that provides information about objects at the Royal BC Museum. 
      The current object is: ${objectPrompt}. 
      Keep your responses concise, generally two or three sentences for each exchange.`;
      
      // Send events in sequence
      socketRef.current.emit('promptStart');
      socketRef.current.emit('systemPrompt', systemPrompt);
      socketRef.current.emit('audioStart');
      
      sessionInitializedRef.current = true;
      setStatus('Session initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize session:', error);
      setError('Error initializing session');
      setStatus('Session initialization failed');
      return false;
    }
  };
  
  // Start audio recording and streaming
  const startListening = async () => {
    if (isListening) return;
    
    setError(null);
    
    // Initialize audio if not already done
    if (!audioContextRef.current) {
      const audioInitialized = await initializeAudio();
      if (!audioInitialized) return;
    }
    
    // Initialize session if not already done
    if (!sessionInitializedRef.current) {
      const sessionInitialized = await initializeSession();
      if (!sessionInitialized) return;
    }
    
    try {
      // Create audio processor
      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      
      // Use ScriptProcessorNode for audio processing
      processorRef.current = audioContextRef.current.createScriptProcessor(512, 1, 1);
      
      processorRef.current.onaudioprocess = (e) => {
        if (!isListening) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        
        // Convert to 16-bit PCM
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Convert to base64
        const base64Data = arrayBufferToBase64(pcmData.buffer);
        
        // Send to server
        socketRef.current.emit('audioInput', base64Data);
      };
      
      sourceNodeRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      
      setIsListening(true);
      setStatus('Listening... Speak now');
      showUserThinkingIndicator();
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Error starting recording: ' + error.message);
    }
  };
  
  // Stop recording and process the audio
  const stopListening = () => {
    if (!isListening) return;
    
    setIsListening(false);
    setIsProcessing(true);
    setStatus('Processing...');
    
    // Clean up audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      sourceNodeRef.current.disconnect();
    }
    
    // Tell server to finalize processing
    socketRef.current.emit('stopAudio');
    
    // End the current turn
    chatHistoryManager.endTurn();
  };
  
  // Clean up audio resources
  const cleanupAudioResources = () => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {
        console.warn('Error disconnecting processor:', e);
      }
    }
    
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch (e) {
        console.warn('Error disconnecting source:', e);
      }
    }
    
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.warn('Error stopping media stream tracks:', e);
      }
    }
  };
  
  // Convert ArrayBuffer to base64 string
  const arrayBufferToBase64 = (buffer) => {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
  };
  
  // Show user thinking indicator
  const showUserThinkingIndicator = () => {
    setWaitingForUserTranscription(true);
  };
  
  // Show assistant thinking indicator
  const showAssistantThinkingIndicator = () => {
    setWaitingForAssistantResponse(true);
  };
  
  // Hide user thinking indicator
  const hideUserThinkingIndicator = () => {
    setWaitingForUserTranscription(false);
  };
  
  // Hide assistant thinking indicator
  const hideAssistantThinkingIndicator = () => {
    setWaitingForAssistantResponse(false);
  };
  
  // Render chat message
  const renderChatMessage = (item, index) => {
    if (item.endOfConversation) {
      return (
        <div className="message system" key={`end-${index}`}>
          Conversation ended
        </div>
      );
    }
    
    if (item.role) {
      const roleLowerCase = item.role.toLowerCase();
      
      return (
        <Card className={`mb-2 ${roleLowerCase}-message`} key={`msg-${index}`}>
          <Card.Header className={`${roleLowerCase}-header`}>
            {item.role}
          </Card.Header>
          <Card.Body>
            {item.message}
          </Card.Body>
        </Card>
      );
    }
    
    return null;
  };
  
  // Render thinking indicators
  const renderThinkingIndicators = () => {
    return (
      <>
        {waitingForUserTranscription && (
          <Card className="mb-2 user-message thinking">
            <Card.Header className="user-header">USER</Card.Header>
            <Card.Body>
              <div className="d-flex align-items-center">
                <span className="mr-2">Listening</span>
                <Spinner animation="grow" size="sm" className="ml-2" />
                <Spinner animation="grow" size="sm" className="ml-2" />
                <Spinner animation="grow" size="sm" className="ml-2" />
              </div>
            </Card.Body>
          </Card>
        )}
        
        {waitingForAssistantResponse && (
          <Card className="mb-2 assistant-message thinking">
            <Card.Header className="assistant-header">ASSISTANT</Card.Header>
            <Card.Body>
              <div className="d-flex align-items-center">
                <span className="mr-2">Thinking</span>
                <Spinner animation="grow" size="sm" className="ml-2" />
                <Spinner animation="grow" size="sm" className="ml-2" />
                <Spinner animation="grow" size="sm" className="ml-2" />
              </div>
            </Card.Body>
          </Card>
        )}
      </>
    );
  };
  
  // Render component
  return (
    <div className="nova-sonic-chat">
      <Card className="mb-3">
        <Card.Header>
          <h5 className="mb-0">Nova Sonic Conversation</h5>
        </Card.Header>
        <Card.Body>
          <div className="status-bar mb-3">
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {status}
            </div>
            {error && (
              <div className="error-message alert alert-danger mt-2">
                {error}
              </div>
            )}
          </div>
          
          <div className="chat-container" ref={chatContainerRef}>
            {chat.history.map(renderChatMessage)}
            {renderThinkingIndicators()}
          </div>
          
          <Row className="mt-3">
            <Col className="d-flex justify-content-center">
              {!isListening ? (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={startListening}
                  disabled={!isConnected || isProcessing}
                >
                  Start Speaking
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="lg"
                  onClick={stopListening}
                >
                  Stop Recording
                </Button>
              )}
            </Col>
          </Row>
        </Card.Body>
      </Card>
    </div>
  );
};

export default NovaSonicChat;