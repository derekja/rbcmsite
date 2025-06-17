/**
 * Manages chat history for Nova Sonic conversations
 */
export class ChatHistoryManager {
    static #instance = null;

    static getInstance(stateRef, onChange) {
        if (this.#instance === null) {
            this.#instance = new ChatHistoryManager(stateRef, onChange);
        }
        return this.#instance;
    }

    constructor(stateRef, onChange) {
        this.stateRef = stateRef;
        this.onChange = onChange;
        this.activeRole = null;
    }

    getCurrentState() {
        return this.stateRef.current;
    }

    /**
     * Adds a text message to the chat history
     */
    addTextMessage({ role, message }) {
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
    endTurn() {
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
    endConversation() {
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
    clearHistory() {
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