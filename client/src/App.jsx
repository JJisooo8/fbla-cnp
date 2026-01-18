import { useEffect, useState } from "react";
import styles from "./App.module.css";

// Use relative path in production (same domain), localhost in development
// Always use relative path in production to avoid CORS and work on any domain (preview/production)
const API_URL = import.meta.env.DEV 
  ? "http://localhost:3001/api"
  : "/api";

function App() {
  const [view, setView] = useState("home"); // home, business, favorites
  const [businesses, setBusinesses] = useState([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem("locallink_favorites");
    return saved ? JSON.parse(saved) : [];
  });
  const [recommendations, setRecommendations] = useState([]);
  const [trending, setTrending] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  
  // Filters
  const [category, setCategory] = useState("All");
  const [selectedTag, setSelectedTag] = useState("All");
  const [availableTags, setAvailableTags] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [minRating, setMinRating] = useState("");
  const [showDealsOnly, setShowDealsOnly] = useState(false);
  const [sortBy, setSortBy] = useState("local");

  // Review form
  const [reviewForm, setReviewForm] = useState({
    author: "",
    rating: 5,
    comment: "",
    verificationId: "",
    verificationAnswer: "",
    recaptchaToken: ""
  });
  const [verificationChallenge, setVerificationChallenge] = useState(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [recaptchaConfig, setRecaptchaConfig] = useState({ recaptchaEnabled: false, recaptchaSiteKey: null });
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);

  // Review sorting and interactions
  const [reviewSortBy, setReviewSortBy] = useState("relevant");
  const [upvotedReviews, setUpvotedReviews] = useState(() => {
    const saved = localStorage.getItem("locallink_upvoted_reviews");
    return saved ? JSON.parse(saved) : [];
  });
  const [reportedReviews, setReportedReviews] = useState(() => {
    const saved = localStorage.getItem("locallink_reported_reviews");
    return saved ? JSON.parse(saved) : [];
  });

  // Demo mode status
  const [demoStatus, setDemoStatus] = useState(null);

  // Scroll position management
  const [savedScrollPosition, setSavedScrollPosition] = useState(0);

  // Copy button state management
  const [copiedField, setCopiedField] = useState(null);

  // Save favorites to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("locallink_favorites", JSON.stringify(favorites));
  }, [favorites]);

  // Fetch with retry for cold start delays
  const fetchWithRetry = async (url, retries = 3, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      }
    }
  };

  // Fetch initial data with retry logic for Vercel cold starts
  useEffect(() => {
    const loadData = async () => {
      try {
        // Fetch businesses first (most important, triggers cold start)
        const bizData = await fetchWithRetry(`${API_URL}/businesses`, 3, 3000);
        setBusinesses(bizData);
        setFilteredBusinesses(bizData);

        // Then fetch supporting data in parallel
        const [trendData, analyticsData, tagsData, verificationConfig, demoStatusData] = await Promise.all([
          fetchWithRetry(`${API_URL}/trending`, 2, 2000),
          fetchWithRetry(`${API_URL}/analytics`, 2, 2000),
          fetchWithRetry(`${API_URL}/tags`, 2, 2000),
          fetchWithRetry(`${API_URL}/verification/config`, 2, 2000),
          fetchWithRetry(`${API_URL}/demo-status`, 2, 2000).catch(() => null)
        ]);

        setTrending(trendData);
        setAnalytics(analyticsData);
        setAvailableTags(tagsData);
        console.log("Verification config loaded:", verificationConfig);
        setRecaptchaConfig(verificationConfig || { recaptchaEnabled: false, recaptchaSiteKey: null });
        if (demoStatusData) {
          console.log("Demo status loaded:", demoStatusData);
          setDemoStatus(demoStatusData);
        }
        setLoading(false);
      } catch (err) {
        console.error('Error fetching data:', err);
        // Don't show alert - just log and keep loading state
        // The user can refresh to retry
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Load reCAPTCHA script is now handled in index.html
  // Just track if grecaptcha is ready
  useEffect(() => {
    // Check if grecaptcha is loaded (from index.html script)
    const checkRecaptcha = setInterval(() => {
      if (window.grecaptcha && window.grecaptcha.render) {
        console.log("reCAPTCHA API is ready");
        setRecaptchaLoaded(true);
        clearInterval(checkRecaptcha);
      }
    }, 500);

    // Cleanup after 10 seconds
    setTimeout(() => clearInterval(checkRecaptcha), 10000);

    return () => clearInterval(checkRecaptcha);
  }, []);

  // Apply filters and search
  useEffect(() => {
    const params = new URLSearchParams();
    if (category !== "All") params.append("category", category);
    if (selectedTag !== "All") params.append("tag", selectedTag);
    if (searchTerm) params.append("search", searchTerm);
    if (minRating) params.append("minRating", minRating);
    if (showDealsOnly) params.append("hasDeals", "true");
    if (sortBy) params.append("sort", sortBy);
    params.append("limit", "300");

    fetch(`${API_URL}/businesses?${params}`)
      .then(r => r.json())
      .then(data => setFilteredBusinesses(data))
      .catch(err => console.error(err));
  }, [category, selectedTag, searchTerm, minRating, showDealsOnly, sortBy]);

  // Fetch recommendations when favorites change
  useEffect(() => {
    if (favorites.length > 0) {
      fetch(`${API_URL}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favoriteIds: favorites })
      })
        .then(r => r.json())
        .then(data => setRecommendations(data))
        .catch(err => console.error(err));
    }
  }, [favorites]);

  const toggleFavorite = (id) => {
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  // Deduplicate chain businesses for front page display
  // Only show one instance of each chain unless user is searching
  const deduplicateChains = (businesses) => {
    if (searchTerm.trim()) {
      // If user is searching, show all results including chains
      return businesses;
    }

    const seen = new Set();
    const deduped = [];

    for (const biz of businesses) {
      if (biz.isChain) {
        // For chains, use the base name (e.g., "Publix" instead of "Publix Super Market #123")
        const baseName = biz.name.split(/[#\d]/)[0].trim().toLowerCase();

        if (!seen.has(baseName)) {
          seen.add(baseName);
          deduped.push(biz);
        }
        // Skip duplicate chains
      } else {
        // Always show local/independent businesses
        deduped.push(biz);
      }
    }

    return deduped;
  };

  const viewBusiness = (business) => {
    // Save current scroll position before navigating
    setSavedScrollPosition(window.scrollY);

    setSelectedBusiness(business);
    setView("business");
    setShowReviewForm(false);
    setDetailLoading(true);

    // Scroll to top when opening business panel
    window.scrollTo({ top: 0, behavior: 'instant' });

    fetch(`${API_URL}/businesses/${business.id}`)
      .then(r => r.json())
      .then(data => setSelectedBusiness(data))
      .catch(err => console.error(err))
      .finally(() => setDetailLoading(false));
  };

  const startReview = async () => {
    try {
      // Check if reCAPTCHA is available (loaded from index.html)
      const recaptchaAvailable = window.grecaptcha && window.grecaptcha.render && recaptchaConfig.recaptchaSiteKey;

      if (recaptchaAvailable) {
        // Use reCAPTCHA - show the form, then explicitly render the widget
        setVerificationChallenge(null);
        setShowReviewForm(true);
        console.log("Starting review with reCAPTCHA, site key:", recaptchaConfig.recaptchaSiteKey);

        // Wait for React to render the DOM, then explicitly render reCAPTCHA
        setTimeout(() => {
          const container = document.getElementById('recaptcha-container');
          if (container && window.grecaptcha && window.grecaptcha.render) {
            // Clear any existing widget
            container.innerHTML = '';
            try {
              window.grecaptcha.render('recaptcha-container', {
                sitekey: recaptchaConfig.recaptchaSiteKey
              });
              console.log("reCAPTCHA widget rendered successfully");
            } catch (err) {
              console.error("Error rendering reCAPTCHA:", err);
            }
          }
        }, 100);
      } else {
        // Fall back to math challenge
        console.log("reCAPTCHA not available, using math challenge");
        const res = await fetch(`${API_URL}/verification/challenge`);
        if (!res.ok) {
          throw new Error(`Server error: ${res.status}`);
        }
        const challenge = await res.json();
        setVerificationChallenge(challenge);
        setReviewForm(prev => ({ ...prev, verificationId: challenge.id }));
        setShowReviewForm(true);
      }
    } catch (err) {
      console.error("Verification load error:", err);
      alert("Failed to load verification. Please try again.");
    }
  };

  const submitReview = async (e) => {
    e.preventDefault();

    // Get reCAPTCHA token if available
    let recaptchaToken = "";
    const recaptchaAvailable = window.grecaptcha && recaptchaConfig.recaptchaSiteKey;

    if (recaptchaAvailable) {
      try {
        recaptchaToken = window.grecaptcha.getResponse();
        if (!recaptchaToken) {
          alert("Please complete the reCAPTCHA verification (check the 'I'm not a robot' box).");
          return;
        }
      } catch (err) {
        console.error("Error getting reCAPTCHA response:", err);
        alert("reCAPTCHA error. Please refresh and try again.");
        return;
      }
    }

    try {
      const submitData = {
        ...reviewForm,
        recaptchaToken: recaptchaToken
      };

      const res = await fetch(`${API_URL}/businesses/${selectedBusiness.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData)
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to submit review");
        // Reset reCAPTCHA on error
        if (window.grecaptcha) {
          window.grecaptcha.reset();
        }
        return;
      }

      alert("Review submitted successfully!");
      setShowReviewForm(false);
      setReviewForm({ author: "", rating: 5, comment: "", verificationId: "", verificationAnswer: "", recaptchaToken: "" });

      // Refresh business data
      const updatedBiz = await fetch(`${API_URL}/businesses/${selectedBusiness.id}`).then(r => r.json());
      setSelectedBusiness(updatedBiz);
    } catch (err) {
      console.error("Review submission error:", err);
      alert(`Failed to submit review: ${err.message || "Unknown error"}. Please try again.`);
      // Reset reCAPTCHA on error
      if (window.grecaptcha) {
        window.grecaptcha.reset();
      }
    }
  };

  // Save upvoted/reported reviews to localStorage
  useEffect(() => {
    localStorage.setItem("locallink_upvoted_reviews", JSON.stringify(upvotedReviews));
  }, [upvotedReviews]);

  useEffect(() => {
    localStorage.setItem("locallink_reported_reviews", JSON.stringify(reportedReviews));
  }, [reportedReviews]);

  // Upvote or remove upvote from a review
  const upvoteReview = async (reviewId) => {
    const alreadyUpvoted = upvotedReviews.includes(reviewId);

    try {
      const endpoint = alreadyUpvoted
        ? `${API_URL}/businesses/${selectedBusiness.id}/reviews/${reviewId}/remove-upvote`
        : `${API_URL}/businesses/${selectedBusiness.id}/reviews/${reviewId}/upvote`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (res.ok) {
        if (alreadyUpvoted) {
          setUpvotedReviews(prev => prev.filter(id => id !== reviewId));
        } else {
          setUpvotedReviews(prev => [...prev, reviewId]);
        }
        // Refresh business data to get updated helpful count
        const updatedBiz = await fetch(`${API_URL}/businesses/${selectedBusiness.id}`).then(r => r.json());
        setSelectedBusiness(updatedBiz);
      }
    } catch (err) {
      console.error("Failed to toggle upvote:", err);
    }
  };

  // Report a review
  const reportReview = async (reviewId, reason) => {
    if (reportedReviews.includes(reviewId)) {
      alert("You have already reported this review.");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/businesses/${selectedBusiness.id}/reviews/${reviewId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });

      const data = await res.json();

      if (res.ok) {
        setReportedReviews(prev => [...prev, reviewId]);
        alert(data.message);
        // Refresh business data
        const updatedBiz = await fetch(`${API_URL}/businesses/${selectedBusiness.id}`).then(r => r.json());
        setSelectedBusiness(updatedBiz);
      } else {
        alert(data.error || "Failed to report review");
      }
    } catch (err) {
      console.error("Failed to report review:", err);
      alert("Failed to report review. Please try again.");
    }
  };

  // Sort reviews based on selected criteria
  const getSortedReviews = (reviews) => {
    if (!reviews || reviews.length === 0) return [];

    const sorted = [...reviews];

    switch (reviewSortBy) {
      case "relevant":
        // Relevance: combination of upvotes + comment length + recency
        sorted.sort((a, b) => {
          const scoreA = (a.helpful || 0) * 10 + Math.min(a.comment.length / 20, 10) + (new Date(a.date).getTime() / 1e12);
          const scoreB = (b.helpful || 0) * 10 + Math.min(b.comment.length / 20, 10) + (new Date(b.date).getTime() / 1e12);
          return scoreB - scoreA;
        });
        break;
      case "newest":
        sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
        break;
      case "oldest":
        sorted.sort((a, b) => new Date(a.date) - new Date(b.date));
        break;
      default:
        break;
    }

    return sorted;
  };

  // Helper: Copy to clipboard with feedback
  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldName);
      // Reset after 2 seconds
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(() => {
      console.error(`Failed to copy ${fieldName}`);
    });
  };

  // Helper: Parse hours string into structured array
  const parseHours = (hoursString) => {
    if (!hoursString) return null;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date().getDay();

    // Use a Map to store hours by day (prevents duplicates)
    const hoursMap = new Map();

    // Simple hours parsing - expects format like "Mon-Fri 9:00 AM - 5:00 PM, Sat 10:00 AM - 4:00 PM"
    const parts = hoursString.split(',').map(s => s.trim());

    parts.forEach(part => {
      // Check for range format: "Mon-Fri 9:00 AM - 5:00 PM"
      const rangeMatch = part.match(/^([A-Za-z]+)-([A-Za-z]+)\s+(.+)$/);
      if (rangeMatch) {
        const [, startDay, endDay, time] = rangeMatch;
        const startIdx = dayNames.findIndex(d => d === startDay);
        const endIdx = dayNames.findIndex(d => d === endDay);

        if (startIdx !== -1 && endIdx !== -1) {
          for (let i = startIdx; i <= endIdx; i++) {
            // Only add if not already present (first entry wins)
            if (!hoursMap.has(dayNames[i])) {
              hoursMap.set(dayNames[i], { day: dayNames[i], time, isToday: i === today });
            }
          }
        }
      } else {
        // Single day format: "Sat 10:00 AM - 4:00 PM"
        const singleMatch = part.match(/^([A-Za-z]+)\s+(.+)$/);
        if (singleMatch) {
          const [, day, time] = singleMatch;
          const dayIdx = dayNames.findIndex(d => d === day);
          // Only add if not already present (first entry wins)
          if (dayIdx !== -1 && !hoursMap.has(day)) {
            hoursMap.set(day, { day, time, isToday: dayIdx === today });
          }
        }
      }
    });

    // Fill in any missing days as "Closed"
    dayNames.forEach((day, idx) => {
      if (!hoursMap.has(day)) {
        hoursMap.set(day, { day, time: 'Closed', isToday: idx === today });
      }
    });

    // Convert Map to array and sort by day order
    const hoursList = Array.from(hoursMap.values());
    hoursList.sort((a, b) => {
      return dayNames.indexOf(a.day) - dayNames.indexOf(b.day);
    });

    return hoursList;
  };

  // Helper: Apply filter and return to browse section
  const applyFilter = (filterType, value) => {
    setView("home");
    if (filterType === "category") {
      setCategory(value);
      setSelectedTag("All"); // Reset tag filter when changing category
    } else if (filterType === "tag") {
      // Use the tag dropdown instead of search bar
      setSelectedTag(value);
    }
    // Scroll to the browse section after a short delay to allow view change
    setTimeout(() => {
      const filtersSection = document.querySelector('[data-section="filters"]');
      if (filtersSection) {
        filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Helper: Extract domain from URL
  const extractDomain = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <header className={styles.header} role="banner">
          <div className={styles.headerContent}>
            <h1 className={styles.logo}>LocalLink</h1>
            <nav className={styles.nav} aria-label="Main navigation">
              <button className={styles.navButtonActive}>Home</button>
              <button className={styles.navButton}>Favorites (0)</button>
            </nav>
          </div>
        </header>
        <div className={styles.loadingContainer} role="status" aria-live="polite">
          <div className={styles.loadingHeader}>
            <div className={styles.loadingSpinner}></div>
            <span className={styles.loadingText}>Loading LocalLink...</span>
          </div>
          <div className={styles.skeletonGrid}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className={styles.skeletonCard}>
                <div className={styles.skeletonImage}></div>
                <div className={styles.skeletonCardContent}>
                  <div className={styles.skeletonTitle}></div>
                  <div className={styles.skeletonMeta}>
                    <div className={styles.skeletonBadge}></div>
                    <div className={styles.skeletonBadge}></div>
                  </div>
                  <div className={styles.skeletonText}></div>
                  <div className={styles.skeletonTextShort}></div>
                  <div className={styles.skeletonButton}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const localGems = [...businesses]
    .filter(biz => !biz.isChain)
    .sort((a, b) => b.relevancyScore - a.relevancyScore)
    .slice(0, 4);

  const categoryCounts = analytics?.byCategory || {};
  const totalCategoryCounts = analytics?.totalByCategory || {};
  const totalBusinessesCount = analytics?.totalBusinesses || 0;
  const topRated = analytics?.topRated || [];

  return (
    <div className={styles.container}>
      {/* Demo Mode Banner */}
      {demoStatus?.offlineMode && demoStatus?.metadata && (
        <div className={styles.demoBannerWrapper}>
          <div className={styles.demoBanner} role="banner" aria-label="Demo mode indicator">
            <span className={styles.demoBannerTitle}>Demo Mode - Offline Data</span>
            <span className={styles.demoBannerSeparator}>|</span>
            <span className={styles.demoBannerPill}>{demoStatus.businessCount} businesses</span>
            <span className={styles.demoBannerSeparator}>|</span>
            <span className={styles.demoBannerDetail}>
              Synced: {new Date(demoStatus.metadata.seedDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </span>
            {demoStatus.productionUrl && (
              <>
                <span className={styles.demoBannerSeparator}>|</span>
                <span className={styles.demoBannerDetail}>
                  Live:{' '}
                  <a
                    href={demoStatus.productionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.demoBannerLink}
                  >
                    {demoStatus.productionUrl.replace('https://', '')}
                  </a>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Skip Link for Accessibility */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Header */}
      <header className={styles.header} role="banner">
        <div className={styles.headerContent}>
          <h1
            className={styles.logo}
            onClick={() => setView("home")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setView("home")}
            aria-label="LocalLink - Go to home page"
          >
            LocalLink
          </h1>
          <nav className={styles.nav} aria-label="Main navigation">
            <button
              className={view === "home" ? styles.navButtonActive : styles.navButton}
              onClick={() => setView("home")}
              aria-current={view === "home" ? "page" : undefined}
            >
              Home
            </button>
            <button
              className={view === "favorites" ? styles.navButtonActive : styles.navButton}
              onClick={() => setView("favorites")}
              aria-current={view === "favorites" ? "page" : undefined}
              aria-label={`Favorites (${favorites.length} businesses)`}
            >
              Favorites ({favorites.length})
            </button>
          </nav>
        </div>
      </header>

      {/* Home View */}
      {view === "home" && (
        <main className={styles.content} id="main-content" role="main">
          {/* Hero Section */}
          <section className={styles.hero} aria-labelledby="hero-title">
            <h2 id="hero-title" className={styles.heroTitle}>
              Discover & Support Local Businesses
            </h2>
            <p className={styles.heroSubtitle}>
              Connecting you with the heart of Cumming, Georgia's business community.
            </p>
            <div className={styles.heroActions}>
              <div
                className={styles.scrollArrow}
                onClick={() => {
                  const filtersSection = document.querySelector('[data-section="filters"]');
                  if (filtersSection) {
                    filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const filtersSection = document.querySelector('[data-section="filters"]');
                    if (filtersSection) {
                      filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }
                }}
                aria-label="Scroll down to browse businesses"
              >
                ↓
              </div>
            </div>
          </section>

          {/* Analytics Cards */}
          {analytics && (
            <section className={styles.statsGrid} aria-label="Community statistics">
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{analytics.totalUserReviews || 0}</div>
                <div className={styles.statLabel}>Community Reviews</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{totalBusinessesCount}</div>
                <div className={styles.statLabel}>Local Businesses</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{analytics.dealsAvailable}</div>
                <div className={styles.statLabel}>Active Deals</div>
              </div>
            </section>
          )}

          {/* Trending Section */}
          {trending.length > 0 && (
            <section className={styles.section} aria-labelledby="trending-title">
              <h3 id="trending-title" className={styles.sectionTitle}>Trending Now</h3>
              <div className={styles.trendingGrid} role="list">
                {trending.filter(biz => !biz.isChain).slice(0, 3).map(biz => (
                  <article
                    key={biz.id}
                    className={styles.trendingCard}
                    onClick={() => viewBusiness(biz)}
                    role="listitem button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && viewBusiness(biz)}
                    aria-label={`View ${biz.name}`}
                  >
                    <img src={biz.image} alt={`${biz.name} storefront`} className={styles.trendingImage} />
                    <div className={styles.trendingContent}>
                      <h4 className={styles.trendingName}>{biz.name}</h4>
                      {biz.rating > 0 ? (
                        <div className={styles.rating} aria-label={`Rating: ${biz.rating.toFixed(1)} out of 5 stars`}>
                          ⭐ {biz.rating.toFixed(1)}
                        </div>
                      ) : (
                        <div className={styles.noRating}>No ratings yet</div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Local Gems */}
          {localGems.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Local Gems</h3>
              <p className={styles.sectionSubtitle}>
                Handpicked spots with strong local impact and standout ratings.
              </p>
              <div className={styles.recommendGrid}>
                {localGems.map(biz => (
                  <div
                    key={biz.id}
                    className={styles.recommendCard}
                    onClick={() => viewBusiness(biz)}
                  >
                    <img src={biz.image} alt={biz.name} className={styles.cardImage} />
                    <div className={styles.cardContent}>
                      <div className={styles.cardHeader}>
                        <h4 className={styles.cardTitle}>{biz.name}</h4>
                        <span className={styles.localBadge}>Local Favorite</span>
                      </div>
                      {biz.rating > 0 ? (
                        <div className={styles.cardRating}>⭐ {biz.rating.toFixed(1)}</div>
                      ) : (
                        <div className={styles.noRating}>No ratings yet</div>
                      )}
                      <p className={styles.cardCategory}>{biz.category}</p>
                      {biz.deal && (
                        <div className={styles.dealPill}>🎁 {biz.deal}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Recommended For You</h3>
              <div className={styles.recommendGrid}>
                {recommendations.map(biz => (
                  <div
                    key={biz.id}
                    className={styles.recommendCard}
                    onClick={() => viewBusiness(biz)}
                  >
                    <img src={biz.image} alt={biz.name} className={styles.cardImage} />
                    <div className={styles.cardContent}>
                      <h4 className={styles.cardTitle}>{biz.name}</h4>
                      {biz.rating > 0 ? (
                        <div className={styles.cardRating}>⭐ {biz.rating.toFixed(1)}</div>
                      ) : (
                        <div className={styles.noRating}>No ratings yet</div>
                      )}
                      <p className={styles.cardCategory}>{biz.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Browse Section with Filters */}
          <section className={styles.browseSection} data-section="filters" aria-labelledby="filters-title">
            <div className={styles.browseSectionHeader}>
              <div>
                <h3 id="filters-title" className={styles.sectionTitle}>Browse All Businesses</h3>
                <p className={styles.sectionSubtitle}>
                  Showing {filteredBusinesses.length} of {totalBusinessesCount} local businesses
                </p>
              </div>
            </div>

            <div className={styles.filters} role="search">
              <input
                type="text"
                placeholder="Search businesses..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className={styles.searchInput}
                aria-label="Search businesses by name"
              />

              <select
                value={category}
                onChange={e => {
                  setCategory(e.target.value);
                  setSelectedTag("All"); // Reset tag when category changes
                }}
                className={styles.select}
                aria-label="Filter by category"
              >
                <option value="All">All Categories</option>
                <option value="Food">Food ({totalCategoryCounts.Food || 0})</option>
                <option value="Retail">Retail ({totalCategoryCounts.Retail || 0})</option>
                <option value="Services">Services ({totalCategoryCounts.Services || 0})</option>
              </select>

              <select
                value={selectedTag}
                onChange={e => setSelectedTag(e.target.value)}
                className={styles.select}
                aria-label="Filter by label/type"
              >
                <option value="All">All Labels</option>
                {availableTags.map(({ tag, count }) => (
                  <option key={tag} value={tag}>
                    {tag} ({count})
                  </option>
                ))}
              </select>

              <select
                value={minRating}
                onChange={e => setMinRating(e.target.value)}
                className={styles.select}
                aria-label="Filter by minimum rating"
              >
                <option value="">Any Rating</option>
                <option value="4">4+ Stars</option>
                <option value="4.5">4.5+ Stars</option>
              </select>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={showDealsOnly}
                  onChange={e => setShowDealsOnly(e.target.checked)}
                  aria-label="Show only businesses with deals"
                />
                <span className={styles.checkboxLabel}>Deals Only</span>
              </label>
            </div>
          </section>

          {/* Business List */}
          <section className={styles.businessGrid} aria-label="Business listings">
            {filteredBusinesses.length === 0 ? (
              <div className={styles.noResults} role="status">
                No businesses found. Try adjusting your filters.
              </div>
            ) : (
              deduplicateChains(filteredBusinesses).map(biz => (
                <article
                  key={biz.id}
                  className={styles.businessCard}
                  onClick={() => viewBusiness(biz)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && viewBusiness(biz)}
                >
                  <img
                    src={biz.image}
                    alt={`${biz.name} storefront`}
                    className={styles.businessImage}
                  />
                  <div className={styles.businessContent}>
                    <div className={styles.businessHeader}>
                      <h3
                        className={styles.businessName}
                      >
                        {biz.name}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(biz.id);
                        }}
                        className={styles.favoriteBtn}
                        aria-label={favorites.includes(biz.id) ? `Remove ${biz.name} from favorites` : `Add ${biz.name} to favorites`}
                        aria-pressed={favorites.includes(biz.id)}
                      >
                        {favorites.includes(biz.id) ? "❤️" : "🤍"}
                      </button>
                    </div>
                    
                    <div className={styles.businessMeta}>
                      <span className={styles.category}>{biz.category}</span>
                      {biz.rating > 0 ? (
                        <span className={styles.rating}>⭐ {biz.rating.toFixed(1)}</span>
                      ) : (
                        <span className={styles.noRating}>No ratings yet</span>
                      )}
                      <span className={styles.reviews}>
                        {biz.reviewCount > 0 ? `(${biz.reviewCount} reviews)` : "No reviews yet"}
                      </span>
                      {biz.deal && <span className={styles.dealBadge}>Deal</span>}
                    </div>

                    <p className={styles.description}>{biz.description}</p>

                    {biz.deal && (
                      <div className={styles.deal}>
                        🎁 {biz.deal}
                      </div>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        viewBusiness(biz);
                      }}
                      className={styles.viewButton}
                      aria-label={`View details for ${biz.name}`}
                    >
                      View Details →
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </main>
      )}

      {/* Business Detail View - Redesigned */}
      {view === "business" && selectedBusiness && (
        <>
          <button
            onClick={() => {
              setView("home");
              // Restore scroll position after view change
              setTimeout(() => {
                window.scrollTo({ top: savedScrollPosition, behavior: 'instant' });
              }, 50);
            }}
            className={styles.backButton}
            style={{ margin: 'var(--space-4)' }}
          >
            ← Back to Browse
          </button>

          {detailLoading && (
            <div className={styles.detailLoading}>Loading business details...</div>
          )}

          <div className={styles.detailCard} style={{ maxWidth: '1400px', margin: '0 auto' }}>
            {/* Controlled Aspect-Ratio Banner */}
            <img
              src={selectedBusiness.image}
              alt={selectedBusiness.name}
              className={styles.detailBanner}
            />

            {/* Compact Identity Header */}
            <div className={styles.detailHeaderNew}>
              <div className={styles.detailHeaderTop}>
                <div className={styles.detailHeaderInfo}>
                  <h1 className={styles.detailTitleNew}>{selectedBusiness.name}</h1>

                  {/* Meta Row: Category, Price, Rating */}
                  <div className={styles.detailMetaRow}>
                    <button
                      onClick={() => applyFilter("category", selectedBusiness.category)}
                      className={styles.chipPrimaryInteractive}
                      title={`Filter by ${selectedBusiness.category}`}
                    >
                      {selectedBusiness.category}
                    </button>

                    {selectedBusiness.priceRange && (
                      <span
                        className={styles.chip}
                        title="Price level"
                      >
                        {selectedBusiness.priceRange}
                      </span>
                    )}

                    <div className={styles.ratingDisplay}>
                      <span className={styles.ratingStar}>★</span>
                      <span className={styles.ratingValue}>
                        {selectedBusiness.rating > 0 ? selectedBusiness.rating.toFixed(1) : '—'}
                      </span>
                      <span className={styles.ratingCount}>
                        {selectedBusiness.reviewCount > 0
                          ? `(${selectedBusiness.reviewCount})`
                          : '(No ratings)'}
                      </span>
                    </div>

                    {selectedBusiness.isOpenNow !== undefined && (
                      <span className={selectedBusiness.isOpenNow ? styles.statusPillOpen : styles.statusPillClosed}>
                        {selectedBusiness.isOpenNow ? '● Open now' : '● Closed'}
                      </span>
                    )}
                  </div>

                  {/* Tags as Interactive Chips */}
                  {selectedBusiness.tags && selectedBusiness.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
                      {selectedBusiness.tags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => applyFilter("tag", tag)}
                          className={styles.chipInteractive}
                          title={`Search for ${tag}`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Favorite Button */}
                <button
                  onClick={() => toggleFavorite(selectedBusiness.id)}
                  className={favorites.includes(selectedBusiness.id) ? styles.favoriteBtnActive : styles.favoriteBtn}
                  aria-label={favorites.includes(selectedBusiness.id) ? `Remove ${selectedBusiness.name} from favorites` : `Save ${selectedBusiness.name} to favorites`}
                  title="Save to favorites"
                >
                  {favorites.includes(selectedBusiness.id) ? "❤️" : "🤍"}
                </button>
              </div>

              {/* Primary Action Row */}
              <div className={styles.detailActions}>
                {selectedBusiness.googleMapsUrl && (
                  <a
                    href={selectedBusiness.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.btnSecondary}
                  >
                    <svg className={styles.btnIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Directions
                  </a>
                )}

                {selectedBusiness.website ? (
                  <a
                    href={selectedBusiness.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.btnSecondary}
                  >
                    <svg className={styles.btnIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Website
                  </a>
                ) : (
                  <button
                    className={styles.btnSecondary}
                    disabled
                    title="No website listed"
                  >
                    <svg className={styles.btnIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Website
                  </button>
                )}
              </div>
            </div>

            {/* Two-Column Layout: Main Content + Sidebar */}
            <div className={styles.detailLayout}>
              {/* Left Column: Main Content */}
              <div className={styles.detailMain}>
                {/* Description */}
                {selectedBusiness.description && (
                  <div className={styles.detailPanel}>
                    <h2 className={styles.detailPanelHeader}>About</h2>
                    <p style={{ fontSize: 'var(--text-body)', lineHeight: 'var(--leading-relaxed)', color: 'var(--color-gray-700)', margin: 0 }}>
                      {selectedBusiness.description}
                    </p>
                  </div>
                )}

                {/* Deal Callout */}
                {selectedBusiness.deal && (
                  <div className={styles.detailPanel} style={{ backgroundColor: 'var(--color-warning-bg)', border: '2px solid var(--color-secondary-700)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                      <span style={{ fontSize: '24px' }}>🎁</span>
                      <div>
                        <h3 className={styles.chipWarning} style={{ marginBottom: 'var(--space-2)' }}>Special Offer</h3>
                        <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-warning)', margin: 0 }}>
                          {selectedBusiness.deal}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reviews Section */}
                <div className={styles.detailPanel}>
                  <div className={styles.sectionHeaderWithAction}>
                    <h2 className={styles.sectionHeader}>Reviews</h2>
                    <div className={styles.reviewActions}>
                      {selectedBusiness.reviews.length > 1 && (
                        <select
                          value={reviewSortBy}
                          onChange={e => setReviewSortBy(e.target.value)}
                          className={styles.reviewSortSelect}
                          aria-label="Sort reviews"
                        >
                          <option value="relevant">Most Relevant</option>
                          <option value="newest">Newest First</option>
                          <option value="oldest">Oldest First</option>
                        </select>
                      )}
                      {!showReviewForm && (
                        <button onClick={startReview} className={styles.btnPrimary}>
                          Write a Review
                        </button>
                      )}
                    </div>
                  </div>

                  {showReviewForm && (verificationChallenge || recaptchaConfig.recaptchaSiteKey) && (
                    <form onSubmit={submitReview} className={styles.reviewForm} aria-labelledby="review-form-title">
                      <h4 id="review-form-title" className={styles.formTitle}>Write Your Review</h4>

                      {demoStatus?.offlineMode && (
                        <p className={styles.offlineNotice}>
                          (Currently in offline demo mode - reviews will not be reflected on the live website)
                        </p>
                      )}

                      <input
                        type="text"
                        placeholder="Your name"
                        value={reviewForm.author}
                        onChange={e => setReviewForm(prev => ({ ...prev, author: e.target.value }))}
                        className={styles.input}
                        aria-label="Your name"
                        required
                      />

                      <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="rating-slider">
                          Rating: {reviewForm.rating} ⭐
                        </label>
                        <input
                          id="rating-slider"
                          type="range"
                          min="1"
                          max="5"
                          value={reviewForm.rating}
                          onChange={e => setReviewForm(prev => ({ ...prev, rating: parseInt(e.target.value) }))}
                          className={styles.slider}
                          aria-label={`Rating: ${reviewForm.rating} out of 5 stars`}
                        />
                      </div>

                      <textarea
                        placeholder="Share your experience (min 10 characters)..."
                        value={reviewForm.comment}
                        onChange={e => setReviewForm(prev => ({ ...prev, comment: e.target.value }))}
                        className={styles.textarea}
                        rows={4}
                        aria-label="Your review"
                        required
                      />

                      {/* Verification: reCAPTCHA or Math Challenge */}
                      <div className={styles.verification}>
                        {recaptchaConfig.recaptchaSiteKey ? (
                          <>
                            <label className={styles.label}>
                              Please verify you're human:
                            </label>
                            {/* reCAPTCHA widget - explicitly rendered via grecaptcha.render() */}
                            <div
                              id="recaptcha-container"
                              style={{ marginTop: '8px' }}
                            ></div>
                          </>
                        ) : verificationChallenge && (
                          <>
                            <label className={styles.label} htmlFor="verification-answer">
                              Quick check: {verificationChallenge.question}
                            </label>
                            <input
                              id="verification-answer"
                              type="number"
                              placeholder="Answer"
                              value={reviewForm.verificationAnswer}
                              onChange={e => setReviewForm(prev => ({ ...prev, verificationAnswer: e.target.value }))}
                              className={styles.input}
                              aria-label="Verification answer"
                              required
                            />
                            <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-gray-500)', marginTop: 'var(--space-1)' }}>
                              Verified by quick check to prevent spam
                            </p>
                          </>
                        )}
                      </div>

                      <div className={styles.formButtons}>
                        <button type="submit" className={styles.submitBtn}>
                          Submit Review
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowReviewForm(false)}
                          className={styles.cancelBtn}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {selectedBusiness.reviews.length === 0 ? (
                    <div className={styles.emptyStateContainer}>
                      <div className={styles.emptyStateIcon}>💬</div>
                      <h3 className={styles.emptyStateTitle}>No reviews yet</h3>
                      <p className={styles.emptyStateMessage}>
                        This is a new listing. Be the first to share your experience!
                      </p>
                      {!showReviewForm && (
                        <button onClick={startReview} className={styles.btnAccent}>
                          Write the First Review
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className={styles.reviewsList}>
                      {getSortedReviews(selectedBusiness.reviews).map(review => (
                        <div key={review.id} className={styles.reviewItem}>
                          <div className={styles.reviewHeader}>
                            <strong className={styles.reviewAuthor}>{review.author}</strong>
                            <div className={styles.reviewRating}>
                              {"⭐".repeat(review.rating)}
                            </div>
                          </div>
                          <p className={styles.reviewComment}>{review.comment}</p>
                          <div className={styles.reviewFooter}>
                            <div className={styles.reviewDate}>
                              {new Date(review.date).toLocaleDateString()}
                            </div>
                            <div className={styles.reviewInteractions}>
                              <button
                                onClick={() => upvoteReview(review.id)}
                                className={upvotedReviews.includes(review.id) ? styles.upvoteButtonActive : styles.upvoteButton}
                                title={upvotedReviews.includes(review.id) ? "Click to remove your upvote" : "Mark as helpful"}
                              >
                                <span className={styles.upvoteIcon}>👍</span>
                                <span>{review.helpful || 0}</span>
                              </button>
                              <button
                                onClick={() => {
                                  const reason = window.prompt(
                                    "Why are you reporting this review?\n\nOptions:\n- Spam or fake review\n- Inappropriate content\n- Off-topic\n- Other",
                                    "Inappropriate content"
                                  );
                                  if (reason) reportReview(review.id, reason);
                                }}
                                className={reportedReviews.includes(review.id) ? styles.reportButtonReported : styles.reportButton}
                                disabled={reportedReviews.includes(review.id)}
                                title={reportedReviews.includes(review.id) ? "You reported this review" : "Report this review"}
                              >
                                {reportedReviews.includes(review.id) ? "Reported" : "Report"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Details Sidebar */}
              <div className={styles.detailSidebar}>
                {/* Contact & Location Panel */}
                <div className={styles.detailPanel}>
                  <h3 className={styles.detailPanelHeader}>Details</h3>

                  {/* Address */}
                  {selectedBusiness.address && (
                    <div className={styles.detailPanelSection}>
                      <div className={styles.detailPanelLabel}>Address</div>
                      <div className={styles.detailPanelValue}>
                        {selectedBusiness.googleMapsUrl ? (
                          <a
                            href={selectedBusiness.googleMapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.interactiveLink}
                          >
                            {selectedBusiness.address}
                          </a>
                        ) : (
                          selectedBusiness.address
                        )}
                        <button
                          onClick={() => copyToClipboard(selectedBusiness.address, 'address')}
                          className={copiedField === 'address' ? styles.copyActionSuccess : styles.copyAction}
                          title="Copy address"
                        >
                          {copiedField === 'address' ? (
                            <>
                              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Copied!
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Phone */}
                  {selectedBusiness.phone && (
                    <div className={styles.detailPanelSection}>
                      <div className={styles.detailPanelLabel}>Phone</div>
                      <div className={styles.detailPanelValue}>
                        <a
                          href={`tel:${selectedBusiness.phone}`}
                          className={styles.interactiveLink}
                        >
                          {selectedBusiness.phone}
                        </a>
                        <button
                          onClick={() => copyToClipboard(selectedBusiness.phone, 'phone')}
                          className={copiedField === 'phone' ? styles.copyActionSuccess : styles.copyAction}
                          title="Copy phone number"
                        >
                          {copiedField === 'phone' ? (
                            <>
                              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Copied!
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Website */}
                  <div className={styles.detailPanelSection}>
                    <div className={styles.detailPanelLabel}>Website</div>
                    {selectedBusiness.website ? (
                      <div className={styles.websiteSection}>
                        <a
                          href={selectedBusiness.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.btnSecondary}
                          style={{ width: '100%', justifyContent: 'center' }}
                        >
                          <svg className={styles.btnIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          Visit Website
                        </a>
                        <div className={styles.websiteDomain}>
                          {extractDomain(selectedBusiness.website)}
                        </div>
                      </div>
                    ) : (
                      <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-gray-400)', margin: 0 }}>
                        No website listed
                      </p>
                    )}
                  </div>

                  {/* Hours */}
                  {selectedBusiness.hours && (
                    <div className={styles.detailPanelSection}>
                      <div className={styles.detailPanelLabel}>Hours</div>
                      {parseHours(selectedBusiness.hours) ? (
                        <div className={styles.hoursList}>
                          {parseHours(selectedBusiness.hours).map(({ day, time, isToday }) => (
                            <div key={day} className={isToday ? styles.hoursRowToday : styles.hoursRow}>
                              <div className={styles.hoursDay}>{day}</div>
                              <div className={styles.hoursTime}>{time}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.detailPanelValue}>
                          {selectedBusiness.hours}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Favorites View */}
      {view === "favorites" && (
        <main className={styles.content} id="main-content" role="main">
          <h2 className={styles.pageTitle}>Your Favorite Businesses</h2>
          
          {favorites.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>You haven't saved any favorites yet.</p>
              <button onClick={() => setView("home")} className={styles.browseBtn}>
                Browse Businesses
              </button>
            </div>
          ) : (
            <section className={styles.businessGrid} aria-label="Favorite businesses">
              {businesses
                .filter(b => favorites.includes(b.id))
                .map(biz => (
                  <article
                    key={biz.id}
                    className={styles.businessCard}
                    onClick={() => viewBusiness(biz)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && viewBusiness(biz)}
                  >
                    <img
                      src={biz.image}
                      alt={`${biz.name} storefront`}
                      className={styles.businessImage}
                    />
                    <div className={styles.businessContent}>
                      <div className={styles.businessHeader}>
                        <h3
                          className={styles.businessName}
                        >
                          {biz.name}
                        </h3>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(biz.id);
                          }}
                          className={styles.favoriteBtn}
                          aria-label={`Remove ${biz.name} from favorites`}
                          aria-pressed="true"
                        >
                          ❤️
                        </button>
                      </div>
                      
                      <div className={styles.businessMeta}>
                        <span className={styles.category}>{biz.category}</span>
                      {biz.rating > 0 ? (
                        <span className={styles.rating}>⭐ {biz.rating.toFixed(1)}</span>
                      ) : (
                        <span className={styles.noRating}>No ratings yet</span>
                      )}
                      </div>

                      <p className={styles.description}>{biz.description}</p>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          viewBusiness(biz);
                        }}
                        className={styles.viewButton}
                        aria-label={`View details for ${biz.name}`}
                      >
                        View Details →
                      </button>
                    </div>
                  </article>
                ))}
            </section>
          )}
        </main>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerBrand}>
            <h3 className={styles.footerLogo}>LocalLink</h3>
            <p className={styles.footerTagline}>
              Connecting you with the heart of Cumming, Georgia's business community.
              Discover, support, and celebrate local businesses.
            </p>
          </div>
          <div className={styles.footerSection}>
            <h4 className={styles.footerSectionTitle}>Quick Links</h4>
            <button className={styles.footerLink} onClick={() => setView("home")}>
              Browse Businesses
            </button>
            <button className={styles.footerLink} onClick={() => setView("favorites")}>
              Your Favorites
            </button>
            <button className={styles.footerLink} onClick={() => setShowDealsOnly(true)}>
              View Deals
            </button>
          </div>
          <div className={styles.footerSection}>
            <h4 className={styles.footerSectionTitle}>Categories</h4>
            <button className={styles.footerLink} onClick={() => { setCategory("Food"); setView("home"); }}>
              Food & Dining
            </button>
            <button className={styles.footerLink} onClick={() => { setCategory("Retail"); setView("home"); }}>
              Retail & Shopping
            </button>
            <button className={styles.footerLink} onClick={() => { setCategory("Services"); setView("home"); }}>
              Local Services
            </button>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <p className={styles.footerText}>
            © 2024 LocalLink. Supporting local businesses.
          </p>
          <span className={styles.footerBadge}>
            FBLA Byte-Sized Business Boost
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
