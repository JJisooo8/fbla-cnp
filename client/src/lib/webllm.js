/**
 * WebLLM utility module for client-side AI inference
 * Uses @mlc-ai/web-llm to run language models directly in the browser
 */

import * as webllm from "@mlc-ai/web-llm";

// Model configuration - using small but capable models
const MODEL_OPTIONS = [
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Phi-3.5-mini-instruct-q4f16_1-MLC",
];

// Default model - Llama 3.2 1B is smaller and loads faster
const DEFAULT_MODEL = MODEL_OPTIONS[0];

// Singleton engine instance
let engine = null;
let isInitializing = false;
let initPromise = null;

/**
 * Check if WebGPU is supported in the current browser
 * @returns {Promise<boolean>} Whether WebGPU is available
 */
export async function checkWebGPUSupport() {
  if (!navigator.gpu) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch (e) {
    console.warn("WebGPU check failed:", e);
    return false;
  }
}

/**
 * Initialize the WebLLM engine with progress callback
 * @param {Function} onProgress - Callback for initialization progress (0-100)
 * @param {Function} onStatusChange - Callback for status message updates
 * @returns {Promise<boolean>} Whether initialization succeeded
 */
export async function initializeEngine(onProgress, onStatusChange) {
  // If already initialized, return immediately
  if (engine) {
    return true;
  }

  // If currently initializing, wait for that to complete
  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;

  initPromise = new Promise(async (resolve) => {
    try {
      // Check WebGPU support first
      const hasWebGPU = await checkWebGPUSupport();
      if (!hasWebGPU) {
        onStatusChange?.("WebGPU not supported in this browser");
        isInitializing = false;
        resolve(false);
        return;
      }

      onStatusChange?.("Initializing AI engine...");
      onProgress?.(0);

      // Create the engine with progress callback
      engine = await webllm.CreateMLCEngine(DEFAULT_MODEL, {
        initProgressCallback: (report) => {
          // report.progress is 0-1, convert to percentage
          const progress = Math.round(report.progress * 100);
          onProgress?.(progress);

          // Update status based on progress text
          if (report.text) {
            // Simplify the status message for users
            if (report.text.includes("Fetching")) {
              onStatusChange?.("Downloading AI model...");
            } else if (report.text.includes("Loading")) {
              onStatusChange?.("Loading AI model...");
            } else if (report.text.includes("Compiling")) {
              onStatusChange?.("Preparing AI model...");
            } else {
              onStatusChange?.(report.text);
            }
          }
        },
      });

      onStatusChange?.("AI assistant ready!");
      onProgress?.(100);
      isInitializing = false;
      resolve(true);
    } catch (error) {
      console.error("Failed to initialize WebLLM:", error);
      onStatusChange?.("Failed to load AI model");
      engine = null;
      isInitializing = false;
      resolve(false);
    }
  });

  return initPromise;
}

/**
 * Check if the engine is ready for inference
 * @returns {boolean} Whether the engine is initialized
 */
export function isEngineReady() {
  return engine !== null;
}

/**
 * Generate a streaming response from the model
 * @param {Array} messages - Array of {role, content} message objects
 * @param {Function} onToken - Callback for each generated token
 * @param {AbortSignal} abortSignal - Optional abort signal to cancel generation
 * @returns {Promise<string>} The complete generated response
 */
export async function generateResponse(messages, onToken, abortSignal) {
  if (!engine) {
    throw new Error("Engine not initialized. Call initializeEngine first.");
  }

  let fullResponse = "";

  try {
    // Use streaming for responsive UI
    const asyncGenerator = await engine.chat.completions.create({
      messages,
      stream: true,
      max_tokens: 512,
      temperature: 0.7,
      top_p: 0.95,
    });

    for await (const chunk of asyncGenerator) {
      // Check for abort
      if (abortSignal?.aborted) {
        break;
      }

      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        fullResponse += token;
        onToken?.(token, fullResponse);
      }
    }
  } catch (error) {
    if (error.name === "AbortError" || abortSignal?.aborted) {
      // Generation was cancelled, return what we have
      return fullResponse;
    }
    console.error("Generation error:", error);
    throw error;
  }

  return fullResponse;
}

/**
 * Reset the conversation context in the engine
 */
export async function resetConversation() {
  if (engine) {
    await engine.resetChat();
  }
}

/**
 * Get the current model name
 * @returns {string} The model identifier
 */
export function getCurrentModel() {
  return DEFAULT_MODEL;
}

/**
 * Cleanup and dispose of the engine (for component unmount)
 */
export function disposeEngine() {
  if (engine) {
    engine = null;
  }
  isInitializing = false;
  initPromise = null;
}
