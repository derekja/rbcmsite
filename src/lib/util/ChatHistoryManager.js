/**
 * ChatHistoryManager - Singleton class for managing chat history
 * Maintains conversation state and context
 */
export class ChatHistoryManager {
  static instance = null;
  
  /**
   * Get the singleton instance of ChatHistoryManager
   * @param {Object} chatRef - Reference to chat object
   * @param {Function} updateCallback - Callback to update UI
   * @returns {ChatHistoryManager} Instance of ChatHistoryManager
   */
  static getInstance(chatRef, updateCallback) {
    if (!ChatHistoryManager.instance) {
      ChatHistoryManager.instance = new ChatHistoryManager(chatRef, updateCallback);
    }
    return ChatHistoryManager.instance;
  }

  /**
   * Constructor
   * @param {Object} chatRef - Reference to chat object
   * @param {Function} updateCallback - Callback function called when chat is updated
   */
  constructor(chatRef, updateCallback) {
    this.chatRef = chatRef;
    this.updateCallback = updateCallback;
    this.currentTurnMessages = [];
  }

  /**
   * Add text message to the conversation
   * @param {Object} messageData - Message data (role, message)
   */
  addTextMessage(messageData) {
    if (!messageData || !messageData.role || !messageData.message) {
      console.warn('Invalid message data:', messageData);
      return;
    }

    // Add message to current turn
    this.currentTurnMessages.push(messageData);
    
    // Update chat history
    const updatedHistory = [...(this.chatRef.current?.history || []), messageData];
    
    const updatedChat = {
      ...this.chatRef.current,
      history: updatedHistory
    };
    
    // Call the update callback with the updated chat
    if (this.updateCallback) {
      this.updateCallback(updatedChat);
    }
  }
  
  /**
   * End the current conversation turn
   */
  endTurn() {
    this.currentTurnMessages = [];
  }
  
  /**
   * Clear the entire conversation history
   */
  clearHistory() {
    const updatedChat = {
      ...this.chatRef.current,
      history: []
    };
    
    this.currentTurnMessages = [];
    
    if (this.updateCallback) {
      this.updateCallback(updatedChat);
    }
  }
  
  /**
   * Get the current conversation history as an array
   * @returns {Array} Conversation history
   */
  getHistory() {
    return this.chatRef.current?.history || [];
  }
  
  /**
   * Add an end of conversation marker
   */
  endConversation() {
    const endMarker = { endOfConversation: true };
    
    const updatedHistory = [...(this.chatRef.current?.history || []), endMarker];
    
    const updatedChat = {
      ...this.chatRef.current,
      history: updatedHistory
    };
    
    if (this.updateCallback) {
      this.updateCallback(updatedChat);
    }
  }
}