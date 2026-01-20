/**
 * ChatPanel component - main chat interface for the AI chatbot
 * Handles model initialization, conversation management, and UI
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  initializeEngine,
  generateResponse,
  isEngineReady,
  checkWebGPUSupport,
  resetConversation,
} from "../../lib/webllm";
import {
  buildSystemPrompt,
  getStarterQuestions,
  extractUserPreferences,
} from "../../lib/chatContext";
import ChatMessage from "./ChatMessage";
import styles from "./Chatbot.module.css";

// Maximum conversation history to keep (to avoid context overflow)
const MAX_HISTORY = 12; // 6 exchanges (user + assistant each)

/**
 * ChatPanel component
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the panel is open
 * @param {Function} props.onClose - Handler to close the panel
 * @param {Array} props.businesses - All available businesses
 * @param {Array} props.favoriteBusinesses - User's favorited businesses
 * @param {boolean} props.isLoggedIn - Whether user is logged in
 * @param {Function} props.onBusinessClick - Handler when a business is clicked
 */
export default function ChatPanel({
  isOpen,
  onClose,
  businesses,
  favoriteBusinesses,
  isLoggedIn,
  onBusinessClick,
}) {
  // Engine state
  const [engineState, setEngineState] = useState("checking"); // checking, unsupported, loading, ready, error
  const [loadProgress, setLoadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Checking browser support...");

  // Conversation state
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  // Refs
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Check if user has personalization
  const hasPersonalization =
    isLoggedIn &&
    favoriteBusinesses &&
    favoriteBusinesses.length > 0 &&
    extractUserPreferences(favoriteBusinesses) !== null;

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && engineState === "ready") {
      inputRef.current?.focus();
    }
  }, [isOpen, engineState]);

  // Initialize engine when panel first opens
  useEffect(() => {
    if (!isOpen) return;

    const initEngine = async () => {
      // Check WebGPU support first
      setEngineState("checking");
      setStatusMessage("Checking browser support...");

      const hasWebGPU = await checkWebGPUSupport();
      if (!hasWebGPU) {
        setEngineState("unsupported");
        setStatusMessage(
          "Your browser doesn't support WebGPU. Please use Chrome, Edge, or another modern browser."
        );
        return;
      }

      // Already initialized
      if (isEngineReady()) {
        setEngineState("ready");
        setStatusMessage("AI assistant ready!");
        return;
      }

      // Start initialization
      setEngineState("loading");
      setLoadProgress(0);

      const success = await initializeEngine(
        (progress) => setLoadProgress(progress),
        (status) => setStatusMessage(status)
      );

      if (success) {
        setEngineState("ready");
      } else {
        setEngineState("error");
      }
    };

    initEngine();
  }, [isOpen]);

  // Build system prompt
  const getSystemPrompt = useCallback(() => {
    return buildSystemPrompt(businesses, favoriteBusinesses, isLoggedIn);
  }, [businesses, favoriteBusinesses, isLoggedIn]);

  // Send a message
  const sendMessage = async (content) => {
    if (!content.trim() || isGenerating || engineState !== "ready") return;

    // Add user message
    const userMessage = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputValue("");
    setIsGenerating(true);
    setStreamingContent("");

    // Create abort controller for this generation
    abortControllerRef.current = new AbortController();

    try {
      // Build messages array for the model
      const systemPrompt = getSystemPrompt();
      const modelMessages = [
        { role: "system", content: systemPrompt },
        // Keep last N messages to stay within context limits
        ...newMessages.slice(-MAX_HISTORY),
      ];

      // Generate response with streaming
      const response = await generateResponse(
        modelMessages,
        (token, fullText) => {
          setStreamingContent(fullText);
        },
        abortControllerRef.current.signal
      );

      // Add assistant response to messages
      const assistantMessage = { role: "assistant", content: response };
      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingContent("");
    } catch (error) {
      console.error("Error generating response:", error);
      // Add error message
      const errorMessage = {
        role: "assistant",
        content:
          "I'm sorry, I encountered an error while processing your request. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStreamingContent("");
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // Handle form submit
  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  // Handle starter question click
  const handleStarterClick = (question) => {
    sendMessage(question);
  };

  // Clear conversation
  const handleClear = async () => {
    setMessages([]);
    setStreamingContent("");
    setInputValue("");
    await resetConversation();
  };

  // Stop generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Handle business click in message
  const handleBusinessClick = (business) => {
    onBusinessClick?.(business);
    onClose?.();
  };

  // Get starter questions
  const starterQuestions = getStarterQuestions(hasPersonalization);

  // Render loading state
  const renderLoadingState = () => {
    if (engineState === "checking") {
      return (
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />
          <p>{statusMessage}</p>
        </div>
      );
    }

    if (engineState === "unsupported") {
      return (
        <div className={styles.errorState}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <h3>Browser Not Supported</h3>
          <p>{statusMessage}</p>
          <p className={styles.fallbackText}>
            In the meantime, you can use our{" "}
            <button
              onClick={onClose}
              className={styles.textButton}
            >
              label filters and search
            </button>{" "}
            to find businesses.
          </p>
        </div>
      );
    }

    if (engineState === "loading") {
      return (
        <div className={styles.loadingState}>
          <div className={styles.loadingProgress}>
            <div
              className={styles.loadingProgressBar}
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className={styles.loadingStatus}>{statusMessage}</p>
          <p className={styles.loadingHint}>
            {loadProgress < 50
              ? "This may take a moment on first use..."
              : "Almost there..."}
          </p>
        </div>
      );
    }

    if (engineState === "error") {
      return (
        <div className={styles.errorState}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <h3>Failed to Load AI</h3>
          <p>{statusMessage}</p>
          <p className={styles.fallbackText}>
            Please try refreshing the page. In the meantime, you can use our{" "}
            <button
              onClick={onClose}
              className={styles.textButton}
            >
              label filters and search
            </button>{" "}
            to find businesses.
          </p>
        </div>
      );
    }

    return null;
  };

  // Render starter chips when no messages
  const renderStarters = () => {
    if (messages.length > 0 || engineState !== "ready") return null;

    return (
      <div className={styles.startersSection}>
        <p className={styles.startersIntro}>
          Hi! I'm your LocalLink assistant. I can help you find local businesses.
          Try asking me something like:
        </p>
        <div className={styles.starterChips}>
          {starterQuestions.map((starter, index) => (
            <button
              key={index}
              className={styles.starterChip}
              onClick={() => handleStarterClick(starter.text)}
              disabled={isGenerating}
            >
              <StarterIcon type={starter.icon} />
              {starter.text}
            </button>
          ))}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className={styles.chatPanel}>
      {/* Header */}
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderTitle}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          <span>AI Assistant</span>
          {hasPersonalization && (
            <span className={styles.personalizedBadge}>Personalized</span>
          )}
        </div>
        <div className={styles.chatHeaderActions}>
          {messages.length > 0 && engineState === "ready" && (
            <button
              className={styles.chatHeaderButton}
              onClick={handleClear}
              title="Clear conversation"
              disabled={isGenerating}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
          <button
            className={styles.chatHeaderButton}
            onClick={onClose}
            title="Close chat"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className={styles.chatMessages}>
        {engineState !== "ready" ? (
          renderLoadingState()
        ) : (
          <>
            {renderStarters()}
            {messages.map((message, index) => (
              <ChatMessage
                key={index}
                message={message}
                businesses={businesses}
                onBusinessClick={handleBusinessClick}
              />
            ))}
            {isGenerating && streamingContent && (
              <ChatMessage
                message={{ role: "assistant", content: streamingContent }}
                businesses={businesses}
                onBusinessClick={handleBusinessClick}
                isStreaming={true}
              />
            )}
            {isGenerating && !streamingContent && (
              <div className={styles.thinkingIndicator}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <form className={styles.chatInputForm} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className={styles.chatInput}
          placeholder={
            engineState !== "ready"
              ? "Loading AI..."
              : "Ask about local businesses..."
          }
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={engineState !== "ready" || isGenerating}
        />
        {isGenerating ? (
          <button
            type="button"
            className={styles.chatStopButton}
            onClick={handleStop}
            title="Stop generating"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            className={styles.chatSendButton}
            disabled={!inputValue.trim() || engineState !== "ready"}
            title="Send message"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}

// Icon component for starter questions
function StarterIcon({ type }) {
  switch (type) {
    case "restaurant":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
          <path d="M7 2v20" />
          <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
        </svg>
      );
    case "scissors":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6" cy="6" r="3" />
          <path d="M8.12 8.12 12 12" />
          <path d="M20 4 8.12 15.88" />
          <circle cx="6" cy="18" r="3" />
          <path d="M14.8 14.8 20 20" />
        </svg>
      );
    case "star":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "sparkles":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          <path d="M5 3v4" />
          <path d="M19 17v4" />
          <path d="M3 5h4" />
          <path d="M17 19h4" />
        </svg>
      );
    default:
      return null;
  }
}
