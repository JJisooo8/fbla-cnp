/**
 * Chat context utility for formatting business data and user preferences
 * for the AI chatbot to use when making recommendations
 */

// Maximum number of businesses to include in context (to stay within model limits)
const MAX_BUSINESSES_IN_CONTEXT = 75;

// Maximum context string length (smaller models have limited context windows)
const MAX_CONTEXT_LENGTH = 8000;

/**
 * Format a single business into a concise string for AI context
 * @param {Object} business - Business object from API
 * @returns {string} Formatted business string
 */
function formatBusiness(business) {
  const parts = [];

  // Name is required
  parts.push(business.name);

  // Rating info
  if (business.rating && business.reviewCount) {
    parts.push(`${business.rating.toFixed(1)}★ (${business.reviewCount} reviews)`);
  } else if (business.rating) {
    parts.push(`${business.rating.toFixed(1)}★`);
  }

  // Category
  if (business.category) {
    parts.push(business.category);
  }

  // Tags (limit to first 3 for brevity)
  if (business.tags && business.tags.length > 0) {
    const displayTags = business.tags.slice(0, 3).join(", ");
    parts.push(`[${displayTags}]`);
  }

  // Price range if available
  if (business.priceRange) {
    parts.push(business.priceRange);
  }

  // Address (just city/area if full address is too long)
  if (business.address) {
    // Extract just the city/area portion
    const addressParts = business.address.split(",");
    if (addressParts.length >= 2) {
      parts.push(addressParts[1].trim());
    }
  }

  return parts.join(" | ");
}

/**
 * Format businesses array into context string for the AI
 * @param {Array} businesses - Array of business objects
 * @returns {string} Formatted context string
 */
export function formatBusinessContext(businesses) {
  if (!businesses || businesses.length === 0) {
    return "No businesses available.";
  }

  // Sort by rating (descending) and take top businesses
  const sortedBusinesses = [...businesses]
    .sort((a, b) => {
      // Primary sort by rating
      const ratingDiff = (b.rating || 0) - (a.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
      // Secondary sort by review count
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    })
    .slice(0, MAX_BUSINESSES_IN_CONTEXT);

  // Group by category for better organization
  const byCategory = {};
  for (const business of sortedBusinesses) {
    const category = business.category || "Other";
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(business);
  }

  // Build context string
  let context = "";
  for (const [category, categoryBusinesses] of Object.entries(byCategory)) {
    context += `\n${category}:\n`;
    for (const business of categoryBusinesses) {
      context += `- ${formatBusiness(business)}\n`;
    }
  }

  // Truncate if too long
  if (context.length > MAX_CONTEXT_LENGTH) {
    context = context.substring(0, MAX_CONTEXT_LENGTH) + "\n...(more businesses available)";
  }

  return context.trim();
}

/**
 * Extract preference tags from user's favorite businesses
 * @param {Array} favoriteBusinesses - Array of user's favorited business objects
 * @returns {Object} Object with extracted preferences
 */
export function extractUserPreferences(favoriteBusinesses) {
  if (!favoriteBusinesses || favoriteBusinesses.length === 0) {
    return null;
  }

  // Count occurrences of categories and tags
  const categoryCounts = {};
  const tagCounts = {};
  const priceRangeCounts = {};

  for (const business of favoriteBusinesses) {
    // Count categories
    if (business.category) {
      categoryCounts[business.category] = (categoryCounts[business.category] || 0) + 1;
    }

    // Count tags
    if (business.tags) {
      for (const tag of business.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Count price ranges
    if (business.priceRange) {
      priceRangeCounts[business.priceRange] = (priceRangeCounts[business.priceRange] || 0) + 1;
    }
  }

  // Get top preferences (items that appear in at least 2 favorites, or if they have < 4 favorites, items that appear at least once)
  const minCount = favoriteBusinesses.length < 4 ? 1 : 2;

  const topCategories = Object.entries(categoryCounts)
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);

  const topTags = Object.entries(tagCounts)
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const topPriceRange = Object.entries(priceRangeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([price]) => price)[0];

  // Only return preferences if we found meaningful patterns
  if (topCategories.length === 0 && topTags.length === 0) {
    return null;
  }

  return {
    categories: topCategories,
    tags: topTags,
    priceRange: topPriceRange,
    favoriteCount: favoriteBusinesses.length,
  };
}

/**
 * Format user preferences into a readable string for the AI
 * @param {Object} preferences - Preferences object from extractUserPreferences
 * @returns {string} Human-readable preference description
 */
export function formatPreferencesForPrompt(preferences) {
  if (!preferences) {
    return null;
  }

  const parts = [];

  if (preferences.categories.length > 0) {
    parts.push(`interested in ${preferences.categories.join(", ")} businesses`);
  }

  if (preferences.tags.length > 0) {
    parts.push(`enjoys ${preferences.tags.join(", ")}`);
  }

  if (preferences.priceRange) {
    parts.push(`typically prefers ${preferences.priceRange} price range`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `Based on their ${preferences.favoriteCount} favorited businesses, this user appears to be ${parts.join(", ")}.`;
}

/**
 * Build the complete system prompt for the chatbot
 * @param {Array} businesses - All available businesses
 * @param {Array} favoriteBusinesses - User's favorited businesses (or empty array)
 * @param {boolean} isLoggedIn - Whether the user is logged in
 * @returns {string} Complete system prompt
 */
export function buildSystemPrompt(businesses, favoriteBusinesses, isLoggedIn) {
  const businessContext = formatBusinessContext(businesses);

  // Base system prompt
  let systemPrompt = `You are a helpful assistant for LocalLink, a platform that helps users discover and support local businesses in their community.

Based on the user's question, recommend relevant businesses from the available listings. Be friendly, concise, and helpful.

When recommending businesses:
- Mention the business name, rating, and why it might be a good fit
- If multiple options exist, suggest 2-3 top choices
- Keep responses brief and focused

Important rules:
- ONLY recommend businesses from the provided list below
- NEVER make up or invent business names
- If nothing matches what the user is looking for, say so politely and suggest they browse all businesses or try different search terms
- If the user asks about something unrelated to local businesses, politely redirect them to business-related questions

Here are the available local businesses:
${businessContext}`;

  // Add personalization for logged-in users with favorites
  if (isLoggedIn && favoriteBusinesses && favoriteBusinesses.length > 0) {
    const preferences = extractUserPreferences(favoriteBusinesses);
    const preferencesText = formatPreferencesForPrompt(preferences);

    if (preferencesText) {
      systemPrompt += `

Personalization note: ${preferencesText}
You can use this information to provide more personalized recommendations, but always prioritize answering their actual question. Don't force their preferences into every answer - if they ask for something outside their usual preferences, just help them find it.`;
    }
  }

  return systemPrompt;
}

/**
 * Get suggested starter questions for the chat
 * @param {boolean} hasPersonalization - Whether user has personalization data
 * @returns {Array} Array of starter question objects with text and icon
 */
export function getStarterQuestions(hasPersonalization) {
  const starters = [
    { text: "Find me a good restaurant", icon: "restaurant" },
    { text: "Where can I get a haircut?", icon: "scissors" },
    { text: "What's highly rated nearby?", icon: "star" },
  ];

  if (hasPersonalization) {
    // Add personalized starter as first option
    starters.unshift({
      text: "What would you recommend for me?",
      icon: "sparkles",
    });
  }

  return starters;
}

/**
 * Parse AI response to find and linkify business names
 * @param {string} response - Raw AI response text
 * @param {Array} businesses - Array of business objects to match against
 * @returns {Array} Array of text segments with type 'text' or 'business'
 */
export function parseBusinessMentions(response, businesses) {
  if (!response || !businesses || businesses.length === 0) {
    return [{ type: "text", content: response || "" }];
  }

  // Create a map of business names (lowercase) to business objects
  const businessMap = new Map();
  for (const business of businesses) {
    if (business.name) {
      businessMap.set(business.name.toLowerCase(), business);
    }
  }

  // Sort business names by length (longest first) to match longer names first
  const sortedNames = [...businessMap.keys()].sort((a, b) => b.length - a.length);

  // Find all business name matches in the response
  const matches = [];
  const lowerResponse = response.toLowerCase();

  for (const name of sortedNames) {
    let startIndex = 0;
    while (true) {
      const index = lowerResponse.indexOf(name, startIndex);
      if (index === -1) break;

      // Check if this position is already covered by a longer match
      const isOverlapping = matches.some(
        (m) => index >= m.start && index < m.end
      );

      if (!isOverlapping) {
        matches.push({
          start: index,
          end: index + name.length,
          business: businessMap.get(name),
          // Use original case from response
          originalText: response.substring(index, index + name.length),
        });
      }

      startIndex = index + 1;
    }
  }

  // Sort matches by position
  matches.sort((a, b) => a.start - b.start);

  // Build segments array
  const segments = [];
  let lastEnd = 0;

  for (const match of matches) {
    // Add text before this match
    if (match.start > lastEnd) {
      segments.push({
        type: "text",
        content: response.substring(lastEnd, match.start),
      });
    }

    // Add the business match
    segments.push({
      type: "business",
      content: match.originalText,
      business: match.business,
    });

    lastEnd = match.end;
  }

  // Add remaining text after last match
  if (lastEnd < response.length) {
    segments.push({
      type: "text",
      content: response.substring(lastEnd),
    });
  }

  // If no matches found, return original text as single segment
  if (segments.length === 0) {
    return [{ type: "text", content: response }];
  }

  return segments;
}
