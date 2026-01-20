/**
 * ChatMessage component - renders individual chat message bubbles
 * Supports user messages, assistant messages, and clickable business links
 */

import { parseBusinessMentions } from "../../lib/chatContext";
import styles from "./Chatbot.module.css";

/**
 * Render message content with clickable business names
 * @param {string} content - Message content
 * @param {Array} businesses - Array of business objects for matching
 * @param {Function} onBusinessClick - Callback when business name is clicked
 */
function MessageContent({ content, businesses, onBusinessClick }) {
  if (!businesses || businesses.length === 0) {
    return <span>{content}</span>;
  }

  const segments = parseBusinessMentions(content, businesses);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "business") {
          return (
            <button
              key={index}
              className={styles.businessLink}
              onClick={() => onBusinessClick?.(segment.business)}
              title={`View ${segment.business.name}`}
            >
              {segment.content}
            </button>
          );
        }
        return <span key={index}>{segment.content}</span>;
      })}
    </>
  );
}

/**
 * ChatMessage component
 * @param {Object} props
 * @param {Object} props.message - Message object with role and content
 * @param {Array} props.businesses - Available businesses for linking
 * @param {Function} props.onBusinessClick - Handler for business name clicks
 * @param {boolean} props.isStreaming - Whether this message is currently streaming
 */
export default function ChatMessage({
  message,
  businesses,
  onBusinessClick,
  isStreaming = false,
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Don't render system messages
  if (isSystem) {
    return null;
  }

  return (
    <div
      className={`${styles.message} ${
        isUser ? styles.userMessage : styles.assistantMessage
      } ${isStreaming ? styles.streaming : ""}`}
    >
      {!isUser && (
        <div className={styles.messageAvatar}>
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
        </div>
      )}
      <div className={styles.messageContent}>
        {isUser ? (
          <span>{message.content}</span>
        ) : (
          <MessageContent
            content={message.content}
            businesses={businesses}
            onBusinessClick={onBusinessClick}
          />
        )}
        {isStreaming && <span className={styles.cursor}>|</span>}
      </div>
      {isUser && (
        <div className={styles.messageAvatar}>
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
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </div>
  );
}
