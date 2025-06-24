interface ChatMessage {
  role: string;
  message: string;
}

interface EndOfConversationMarker {
  endOfConversation: boolean;
}

type ChatHistoryItem = ChatMessage | EndOfConversationMarker;

interface ChatState {
  history: ChatHistoryItem[];
  active: boolean;
}

/**
 * Manages chat history for Nova Sonic conversations
 */
export class ChatHistoryManager {
  private static instance: ChatHistoryManager | null = null;
  private stateRef: { current: ChatState };
  private onChange: (state: ChatState) => void;
  private activeRole: string | null = null;

  static getInstance(stateRef: { current: ChatState }, onChange: (state: ChatState) => void): ChatHistoryManager {
    if (this.instance === null) {
      this.instance = new ChatHistoryManager(stateRef, onChange);
    }
    return this.instance;
  }

  private constructor(stateRef: { current: ChatState }, onChange: (state: ChatState) => void) {
    this.stateRef = stateRef;
    this.onChange = onChange;
  }

  getCurrentState(): ChatState {
    return this.stateRef.current;
  }

  /**
   * Adds a text message to the chat history
   */
  addTextMessage({ role, message }: { role: string; message: string }): void {
    const currentChat = this.getCurrentState();
    const newHistory = [...currentChat.history];

    // Add message to history
    newHistory.push({
      role,
      message
    });

    // Update state
    const newChatState = {
      ...currentChat,
      history: newHistory,
    };

    // Notify state change
    this.onChange(newChatState);
  }

  /**
   * Marks the end of a conversation turn
   */
  endTurn(): void {
    const currentChat = this.getCurrentState();
    if (currentChat.history.length === 0) return;

    // We don't actually need to add anything to the history
    // for ending a turn, but we can update some state if needed

    // Reset active role
    this.activeRole = null;
  }

  /**
   * Marks a conversation as complete
   */
  endConversation(): void {
    const currentChat = this.getCurrentState();
    const newHistory = [...currentChat.history];
    
    // Add end of conversation marker
    newHistory.push({
      endOfConversation: true
    });

    // Update state
    const newChatState = {
      ...currentChat,
      history: newHistory,
      active: false
    };

    // Notify state change
    this.onChange(newChatState);
  }

  /**
   * Clears the chat history
   */
  clearHistory(): void {
    const currentChat = this.getCurrentState();
    
    // Update state with empty history
    const newChatState = {
      ...currentChat,
      history: [],
      active: true
    };

    // Notify state change
    this.onChange(newChatState);
    this.activeRole = null;
  }
}