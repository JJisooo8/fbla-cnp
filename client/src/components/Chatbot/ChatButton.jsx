/**
 * ChatButton component - floating action button that opens the chatbot
 */

import styles from "./Chatbot.module.css";

/**
 * ChatButton component
 * @param {Object} props
 * @param {Function} props.onClick - Handler when button is clicked
 * @param {boolean} props.isOpen - Whether chat panel is open (for animation)
 */
export default function ChatButton({ onClick, isOpen }) {
  return (
    <button
      className={`${styles.chatButton} ${isOpen ? styles.chatButtonHidden : ""}`}
      onClick={onClick}
      title="Open AI Assistant"
      aria-label="Open AI Assistant chat"
    >
      <svg
        width="24"
        height="24"
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
      <span className={styles.chatButtonLabel}>Ask AI</span>
    </button>
  );
}
