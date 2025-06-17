import React from 'react';
import NovaSonicChat from './NovaSonicChat';
import './NovaSonicChat.css';

const SpeechInteraction = ({ object }) => {
  return (
    <div className="speech-interaction">
      <NovaSonicChat objectPrompt={object.prompt} />
    </div>
  );
};

export default SpeechInteraction;