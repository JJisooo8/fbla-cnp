import { useEffect, useState } from "react";
import styles from "./App.module.css";

// Use relative path in production (same domain), localhost in development
// Always use relative path in production to avoid CORS and work on any domain (preview/production)
const API_URL = import.meta.env.DEV
  ? "http://localhost:3001/api"
  : "/api";

function App() {
  const [view, setView] = useState("home"); // home, business, favorites, login, signup, myReviews
  const [businesses, setBusinesses] = useState([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  // Favorites are now user-specific - start empty and load when user is authenticated
  const [favorites, setFavorites] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [myReviews, setMyReviews] = useState([]);
  const [myReviewsLoading, setMyReviewsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // Authentication state
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(() => {
    return localStorage.getItem("locallink_auth_token");
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  // Auth forms
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [signupForm, setSignupForm] = useState({ username: "", password: "", confirmPassword: "" });
  const [previousView, setPreviousView] = useState(null); // Track view before auth redirect

  // Navigate to auth view (clear forms, scroll to top, save previous view)
  const navigateToAuth = (authView) => {
    // Save current view to return to after auth (unless already on an auth page)
    if (view !== "login" && view !== "signup") {
      setPreviousView({ view, business: selectedBusiness });
    }
    // Clear forms
    setLoginForm({ username: "", password: "" });
    setSignupForm({ username: "", password: "", confirmPassword: "" });
    setAuthError("");
    setView(authView);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Filters
  const [selectedTags, setSelectedTags] = useState([]); // Multiple tag selection
  const [availableTags, setAvailableTags] = useState([]);
  const [labelSearchTerm, setLabelSearchTerm] = useState(""); // For filtering labels
  const [searchTerm, setSearchTerm] = useState("");
  const [minRating, setMinRating] = useState("");
  const [showDealsOnly, setShowDealsOnly] = useState(false);
  const [sortBy, setSortBy] = useState("local");

  // Review form
  const [reviewForm, setReviewForm] = useState({
    rating: 5,
    comment: "",
    verificationId: "",
    verificationAnswer: "",
    recaptchaToken: "",
    // Category ratings
    foodQuality: 3,
    service: 3,
    cleanliness: 3,
    atmosphere: 3,
    isAnonymous: false
  });
  const [verificationChallenge, setVerificationChallenge] = useState(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [recaptchaConfig, setRecaptchaConfig] = useState({ recaptchaEnabled: false, recaptchaSiteKey: null });
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);

  // Edit review state
  const [editingReview, setEditingReview] = useState(null);
  const [editForm, setEditForm] = useState({
    rating: 5,
    comment: "",
    foodQuality: 3,
    service: 3,
    cleanliness: 3,
    atmosphere: 3,
    isAnonymous: false
  });

  // Review sorting and interactions
  const [reviewSortBy, setReviewSortBy] = useState("relevant");
  // Stable sort order - only updated on business load or sort option change (not on upvote)
  const [sortedReviewIds, setSortedReviewIds] = useState([]);
  // NOTE: Upvotes are now tracked server-side in each review's upvotedBy array
  // No localStorage tracking - follows Reddit-style architecture where vote state
  // is tied to user accounts, not browser storage
  const [reportedReviews, setReportedReviews] = useState(() => {
    const saved = localStorage.getItem("locallink_reported_reviews");
    return saved ? JSON.parse(saved) : [];
  });

  // Helper function to check if current user has upvoted a review (Reddit-style)
  const hasUserUpvoted = (review) => {
    if (!user || !review.upvotedBy) return false;
    return review.upvotedBy.includes(user.id);
  };

  // Demo mode status
  const [demoStatus, setDemoStatus] = useState(null);

  // Scroll position management
  const [savedScrollPosition, setSavedScrollPosition] = useState(0);

  // Pagination state
  const [visibleReviewsCount, setVisibleReviewsCount] = useState(3);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  const [businessPage, setBusinessPage] = useState(1);
  const INITIAL_REVIEWS_COUNT = 3;
  const REVIEWS_LOAD_MORE = 20;
  const BUSINESSES_PER_PAGE = 12;

  // Copy button state management
  const [copiedField, setCopiedField] = useState(null);

  // Track if initial URL has been processed
  const [urlInitialized, setUrlInitialized] = useState(false);

  // Helper to get auth headers
  const getAuthHeaders = () => {
    if (!authToken) return {};
    return { Authorization: `Bearer ${authToken}` };
  };

  // Verify token on mount and fetch user info
  useEffect(() => {
    const verifyAuth = async () => {
      if (!authToken) {
        setAuthLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: getAuthHeaders()
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          // Token invalid, clear it
          localStorage.removeItem("locallink_auth_token");
          setAuthToken(null);
          setUser(null);
        }
      } catch (error) {
        console.error("Auth verification error:", error);
      } finally {
        setAuthLoading(false);
      }
    };

    verifyAuth();
  }, [authToken]);

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm)
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.error || "Login failed.");
        return;
      }

      // Save token and user
      localStorage.setItem("locallink_auth_token", data.token);
      setAuthToken(data.token);
      setUser(data.user);
      setLoginForm({ username: "", password: "" });
      // Return to previous view or home
      if (previousView) {
        setView(previousView.view);
        if (previousView.business) {
          setSelectedBusiness(previousView.business);
        }
        setPreviousView(null);
      } else {
        setView("home");
      }
    } catch (error) {
      console.error("Login error:", error);
      setAuthError("Unable to connect to server. Please check your connection and try again.");
    }
  };

  // Handle signup
  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError("");

    // Client-side validation
    if (signupForm.username.length < 3) {
      setAuthError("Username must be at least 3 characters long.");
      return;
    }
    if (signupForm.password.length < 6) {
      setAuthError("Password must be at least 6 characters long.");
      return;
    }
    if (signupForm.password !== signupForm.confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupForm)
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.error || "Signup failed.");
        return;
      }

      // Save token and user
      localStorage.setItem("locallink_auth_token", data.token);
      setAuthToken(data.token);
      setUser(data.user);
      setSignupForm({ username: "", password: "", confirmPassword: "" });
      // Return to previous view or home
      if (previousView) {
        setView(previousView.view);
        if (previousView.business) {
          setSelectedBusiness(previousView.business);
        }
        setPreviousView(null);
      } else {
        setView("home");
      }
    } catch (error) {
      console.error("Signup error:", error);
      setAuthError("Unable to connect to server. Please check your connection and try again.");
    }
  };

  // Handle logout - refresh page to reset all personalized content
  const handleLogout = () => {
    localStorage.removeItem("locallink_auth_token");
    // Refresh the page to fully reset all state and show anonymous view
    window.location.href = '/';
  };

  // URL Routing: Parse URL on initial load
  useEffect(() => {
    const parseUrl = () => {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);

      if (path.startsWith('/business/')) {
        const businessId = path.split('/business/')[1];
        if (businessId) {
          // Will be handled after businesses load
          return { view: 'business', businessId };
        }
      } else if (path === '/favorites') {
        return { view: 'favorites', businessId: null };
      }
      return { view: 'home', businessId: null };
    };

    const { view: urlView, businessId } = parseUrl();

    if (urlView === 'favorites') {
      setView('favorites');
    } else if (urlView === 'business' && businessId) {
      // Store the business ID to load after businesses are fetched
      sessionStorage.setItem('pendingBusinessId', businessId);
    }
    // home view is default, no action needed

    setUrlInitialized(true);
  }, []);

  // URL Routing: Update URL when view changes
  useEffect(() => {
    if (!urlInitialized) return;

    let newPath = '/';
    if (view === 'favorites') {
      newPath = '/favorites';
    } else if (view === 'business' && selectedBusiness) {
      newPath = `/business/${selectedBusiness.id}`;
    }

    // Only push state if path actually changed
    if (window.location.pathname !== newPath) {
      // Before pushing new state, save current scroll position in current state
      const currentState = {
        ...window.history.state,
        scrollY: window.scrollY
      };
      window.history.replaceState(currentState, '', window.location.pathname);

      // Now push the new state
      window.history.pushState({ view, businessId: selectedBusiness?.id, scrollY: 0 }, '', newPath);
    }
  }, [view, selectedBusiness, urlInitialized]);

  // URL Routing: Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = (event) => {
      const path = window.location.pathname;
      const state = event.state || {};

      if (path.startsWith('/business/')) {
        const businessId = path.split('/business/')[1];
        if (businessId && businesses.length > 0) {
          const business = businesses.find(b => b.id === businessId);
          if (business) {
            setSelectedBusiness(business);
            setView('business');
            window.scrollTo({ top: 0, behavior: 'instant' });
            // Fetch full details with auth headers
            fetch(`${API_URL}/businesses/${businessId}`, {
              headers: getAuthHeaders()
            })
              .then(r => r.json())
              .then(data => setSelectedBusiness(data))
              .catch(err => console.error(err));
            return;
          }
        }
        // Business not found, go home
        setView('home');
        setSelectedBusiness(null);
      } else if (path === '/favorites') {
        setView('favorites');
        setSelectedBusiness(null);
      } else {
        // Going back to home - restore scroll position
        setView('home');
        setSelectedBusiness(null);
        // Restore scroll position from state or savedScrollPosition
        const scrollY = state.scrollY || savedScrollPosition || 0;
        setTimeout(() => {
          window.scrollTo({ top: scrollY, behavior: 'instant' });
        }, 50);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [businesses, savedScrollPosition]);

  // Load favorites from user-specific localStorage when user changes
  useEffect(() => {
    if (user) {
      // Load favorites for this specific user
      const userFavoritesKey = `locallink_favorites_${user.id}`;
      const saved = localStorage.getItem(userFavoritesKey);
      if (saved) {
        try {
          setFavorites(JSON.parse(saved));
        } catch {
          setFavorites([]);
        }
      } else {
        setFavorites([]);
      }
    } else {
      // Clear favorites when logged out
      setFavorites([]);
    }
  }, [user]);

  // Save favorites to user-specific localStorage whenever they change (only if logged in)
  useEffect(() => {
    if (user) {
      const userFavoritesKey = `locallink_favorites_${user.id}`;
      localStorage.setItem(userFavoritesKey, JSON.stringify(favorites));
    }
  }, [favorites, user]);

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

        // Check if we need to navigate to a specific business from URL
        const pendingBusinessId = sessionStorage.getItem('pendingBusinessId');
        if (pendingBusinessId) {
          sessionStorage.removeItem('pendingBusinessId');
          const business = bizData.find(b => b.id === pendingBusinessId);
          if (business) {
            setSelectedBusiness(business);
            setView('business');
            // Fetch full details with auth headers
            fetch(`${API_URL}/businesses/${pendingBusinessId}`, {
              headers: getAuthHeaders()
            })
              .then(r => r.json())
              .then(data => setSelectedBusiness(data))
              .catch(err => console.error(err));
          }
        }

        // Then fetch supporting data in parallel
        const [analyticsData, tagsData, verificationConfig, demoStatusData] = await Promise.all([
          fetchWithRetry(`${API_URL}/analytics`, 2, 2000),
          fetchWithRetry(`${API_URL}/tags`, 2, 2000),
          fetchWithRetry(`${API_URL}/verification/config`, 2, 2000),
          fetchWithRetry(`${API_URL}/demo-status`, 2, 2000).catch(() => null)
        ]);

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
    if (searchTerm) params.append("search", searchTerm);
    if (minRating) params.append("minRating", minRating);
    if (showDealsOnly) params.append("hasDeals", "true");
    if (sortBy) params.append("sort", sortBy);
    params.append("limit", "300");

    fetch(`${API_URL}/businesses?${params}`)
      .then(r => r.json())
      .then(data => {
        // Client-side filtering for selected tags (supports multiple)
        if (selectedTags.length > 0) {
          const filtered = data.filter(biz => {
            const bizTags = biz.tags || [];
            const bizCategory = biz.category || "";
            // Match if business has any of the selected tags OR matches category
            return selectedTags.some(tag =>
              bizTags.includes(tag) || bizCategory === tag
            );
          });
          setFilteredBusinesses(filtered);
        } else {
          setFilteredBusinesses(data);
        }
      })
      .catch(err => console.error(err));
  }, [selectedTags, searchTerm, minRating, showDealsOnly, sortBy]);

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

  // Fetch my reviews when viewing the my reviews page
  const fetchMyReviews = async () => {
    if (!user) return;
    setMyReviewsLoading(true);
    try {
      const res = await fetch(`${API_URL}/my-reviews`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setMyReviews(data.reviews || []);
      } else {
        console.error("Failed to fetch my reviews");
        setMyReviews([]);
      }
    } catch (err) {
      console.error("Error fetching my reviews:", err);
      setMyReviews([]);
    } finally {
      setMyReviewsLoading(false);
    }
  };

  // Navigate to My Reviews page
  const goToMyReviews = () => {
    setView("myReviews");
    fetchMyReviews();
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const toggleFavorite = (id) => {
    // Require login to favorite businesses
    if (!user) {
      alert("Please log in to save favorites.");
      navigateToAuth("login");
      return;
    }
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  // SVG Heart Icon component for favorites
  const HeartIcon = ({ filled, size = 20 }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );

  // Reset business page when filters change
  useEffect(() => {
    setBusinessPage(1);
  }, [selectedTags, searchTerm, minRating, showDealsOnly, sortBy]);

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
    // Reset review visibility when viewing new business
    setVisibleReviewsCount(INITIAL_REVIEWS_COUNT);
    setReviewsExpanded(false);

    // Scroll to top when opening business panel
    window.scrollTo({ top: 0, behavior: 'instant' });

    fetch(`${API_URL}/businesses/${business.id}`, {
      headers: getAuthHeaders()
    })
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

    // Check if user is logged in
    if (!user) {
      alert("Please log in to submit a review.");
      navigateToAuth("login");
      return;
    }

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
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(submitData)
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          alert("Please log in to submit a review.");
          navigateToAuth("login");
          return;
        }
        alert(data.error || "Failed to submit review");
        // Reset reCAPTCHA on error
        if (window.grecaptcha) {
          window.grecaptcha.reset();
        }
        return;
      }

      alert("Review submitted successfully!");
      setShowReviewForm(false);

      // Optimistically update the UI with the new review immediately
      if (data.review) {
        setSelectedBusiness(prev => ({
          ...prev,
          reviews: [...(prev.reviews || []), data.review],
          reviewCount: (prev.reviewCount || 0) + 1
        }));
      }

      setReviewForm({
        rating: 5,
        comment: "",
        verificationId: "",
        verificationAnswer: "",
        recaptchaToken: "",
        foodQuality: 3,
        service: 3,
        cleanliness: 3,
        atmosphere: 3,
        isAnonymous: false
      });

      // Don't fetch from server - it may return stale data due to Vercel's serverless architecture
      // The optimistic update is sufficient; fresh data loads on next navigation
    } catch (err) {
      console.error("Review submission error:", err);
      alert(`Failed to submit review: ${err.message || "Unknown error"}. Please try again.`);
      // Reset reCAPTCHA on error
      if (window.grecaptcha) {
        window.grecaptcha.reset();
      }
    }
  };

  // Save reported reviews to localStorage (upvotes are now server-side only)
  useEffect(() => {
    localStorage.setItem("locallink_reported_reviews", JSON.stringify(reportedReviews));
  }, [reportedReviews]);

  // Upvote or remove upvote from a review (Reddit-style - server-side tracking)
  const upvoteReview = async (reviewId) => {
    // Check if user is logged in
    if (!user) {
      alert("Please log in to upvote reviews.");
      navigateToAuth("login");
      return;
    }

    // Find the review to check if already upvoted (from upvotedBy array)
    const review = (selectedBusiness?.reviews || []).find(r => r.id === reviewId);
    if (!review) return;

    const alreadyUpvoted = (review.upvotedBy || []).includes(user.id);

    // Optimistically update the UI - update the upvotedBy array and helpful count
    setSelectedBusiness(prev => ({
      ...prev,
      reviews: (prev.reviews || []).map(r => {
        if (r.id !== reviewId) return r;
        if (alreadyUpvoted) {
          // Remove upvote
          const newUpvotedBy = (r.upvotedBy || []).filter(id => id !== user.id);
          return { ...r, upvotedBy: newUpvotedBy, helpful: newUpvotedBy.length };
        } else {
          // Add upvote
          const newUpvotedBy = [...(r.upvotedBy || []), user.id];
          return { ...r, upvotedBy: newUpvotedBy, helpful: newUpvotedBy.length };
        }
      })
    }));

    try {
      const endpoint = alreadyUpvoted
        ? `${API_URL}/businesses/${selectedBusiness.id}/reviews/${reviewId}/remove-upvote`
        : `${API_URL}/businesses/${selectedBusiness.id}/reviews/${reviewId}/upvote`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        }
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Failed to toggle upvote:", data.error);
        if (res.status === 401) {
          alert("Please log in to upvote reviews.");
          navigateToAuth("login");
        }
        // Revert optimistic update on failure
        setSelectedBusiness(prev => ({
          ...prev,
          reviews: (prev.reviews || []).map(r => {
            if (r.id !== reviewId) return r;
            if (alreadyUpvoted) {
              // Restore upvote
              const newUpvotedBy = [...(r.upvotedBy || []), user.id];
              return { ...r, upvotedBy: newUpvotedBy, helpful: data.helpful !== undefined ? data.helpful : newUpvotedBy.length };
            } else {
              // Remove upvote
              const newUpvotedBy = (r.upvotedBy || []).filter(id => id !== user.id);
              return { ...r, upvotedBy: newUpvotedBy, helpful: data.helpful !== undefined ? data.helpful : newUpvotedBy.length };
            }
          })
        }));
      } else {
        // Success! Update with server's actual helpful count to ensure accuracy
        // (handles concurrent upvotes from other users)
        if (data.helpful !== undefined) {
          setSelectedBusiness(prev => ({
            ...prev,
            reviews: (prev.reviews || []).map(r => {
              if (r.id !== reviewId) return r;
              return { ...r, helpful: data.helpful };
            })
          }));
        }
      }
    } catch (err) {
      console.error("Failed to toggle upvote:", err);
      // Revert optimistic update on error
      setSelectedBusiness(prev => ({
        ...prev,
        reviews: (prev.reviews || []).map(r => {
          if (r.id !== reviewId) return r;
          if (alreadyUpvoted) {
            // Restore upvote
            const newUpvotedBy = [...(r.upvotedBy || []), user.id];
            return { ...r, upvotedBy: newUpvotedBy, helpful: newUpvotedBy.length };
          } else {
            // Remove upvote
            const newUpvotedBy = (r.upvotedBy || []).filter(id => id !== user.id);
            return { ...r, upvotedBy: newUpvotedBy, helpful: newUpvotedBy.length };
          }
        })
      }));
    }
  };

  // Edit a review
  const startEditReview = (review) => {
    setEditingReview(review);
    setEditForm({
      rating: review.rating,
      comment: review.comment || "",
      foodQuality: review.foodQuality || 3,
      service: review.service || 3,
      cleanliness: review.cleanliness || 3,
      atmosphere: review.atmosphere || 3,
      isAnonymous: review.isAnonymous || false
    });
  };

  const cancelEditReview = () => {
    setEditingReview(null);
    setEditForm({
      rating: 5,
      comment: "",
      foodQuality: 3,
      service: 3,
      cleanliness: 3,
      atmosphere: 3,
      isAnonymous: false
    });
  };

  const submitEditReview = async (e) => {
    e.preventDefault();

    if (!editingReview) return;

    try {
      const res = await fetch(`${API_URL}/businesses/${selectedBusiness.id}/reviews/${editingReview.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify(editForm)
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to update review");
        return;
      }

      // Update the review in the UI
      setSelectedBusiness(prev => ({
        ...prev,
        reviews: (prev.reviews || []).map(r =>
          r.id === editingReview.id ? data.review : r
        )
      }));

      alert("Review updated successfully!");
      cancelEditReview();
    } catch (err) {
      console.error("Failed to update review:", err);
      alert("Failed to update review. Please try again.");
    }
  };

  // Delete a review
  const deleteReview = async (reviewId) => {
    if (!window.confirm("Are you sure you want to delete this review? This action cannot be undone.")) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/businesses/${selectedBusiness.id}/reviews/${reviewId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to delete review");
        return;
      }

      // Remove the review from the UI
      setSelectedBusiness(prev => ({
        ...prev,
        reviews: (prev.reviews || []).filter(r => r.id !== reviewId),
        reviewCount: Math.max(0, (prev.reviewCount || 0) - 1)
      }));

      alert("Review deleted successfully!");
    } catch (err) {
      console.error("Failed to delete review:", err);
      alert("Failed to delete review. Please try again.");
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
        // Don't fetch - trust the local state; hiding happens automatically if 3+ reports
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
          const scoreA = (a.helpful || 0) * 10 + Math.min((a.comment || '').length / 20, 10) + (new Date(a.date).getTime() / 1e12);
          const scoreB = (b.helpful || 0) * 10 + Math.min((b.comment || '').length / 20, 10) + (new Date(b.date).getTime() / 1e12);
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

  // Update sorted review order ONLY when business changes or sort option changes (not on upvote)
  useEffect(() => {
    if (selectedBusiness?.reviews && selectedBusiness.reviews.length > 0) {
      const sorted = getSortedReviews(selectedBusiness.reviews);
      setSortedReviewIds(sorted.map(r => r.id));
    } else {
      setSortedReviewIds([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusiness?.id, reviewSortBy]); // Only re-sort when business ID or sort option changes

  // Get reviews in stable sorted order (preserves order during upvotes)
  const getStableSortedReviews = (reviews) => {
    if (!reviews || reviews.length === 0) return [];

    // If we have a stable order, use it
    if (sortedReviewIds.length > 0) {
      const reviewMap = new Map(reviews.map(r => [r.id, r]));
      const ordered = sortedReviewIds
        .map(id => reviewMap.get(id))
        .filter(Boolean);

      // Add any new reviews that aren't in the sorted order (newly added)
      const newReviews = reviews.filter(r => !sortedReviewIds.includes(r.id));
      return [...newReviews, ...ordered];
    }

    // Fallback to dynamic sort if no stable order yet
    return getSortedReviews(reviews);
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

  // Helper: Apply filter (toggle tag) and return to browse section
  const applyFilter = (filterType, value) => {
    setView("home");
    // Toggle the tag in selectedTags array
    setSelectedTags(prev =>
      prev.includes(value)
        ? prev.filter(t => t !== value)
        : [...prev, value]
    );
    // Scroll to the browse section after a short delay to allow view change
    setTimeout(() => {
      const filtersSection = document.querySelector('[data-section="filters"]');
      if (filtersSection) {
        filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Helper: Toggle tag selection
  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
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

  // Developer tool: Export businesses to JSON/CSV
  const exportBusinesses = (format) => {
    const businessesToExport = deduplicateChains(filteredBusinesses);
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'json') {
      const dataStr = JSON.stringify(businessesToExport, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `locallink-businesses-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (format === 'csv') {
      // CSV headers
      const headers = ['id', 'name', 'category', 'rating', 'reviewCount', 'address', 'phone', 'website', 'tags', 'deal'];
      const csvRows = [headers.join(',')];

      businessesToExport.forEach(biz => {
        const row = [
          biz.id,
          `"${(biz.name || '').replace(/"/g, '""')}"`,
          biz.category || '',
          biz.rating || '',
          biz.reviewCount || 0,
          `"${(biz.address || '').replace(/"/g, '""')}"`,
          biz.phone || '',
          biz.website || '',
          `"${(biz.tags || []).join('; ')}"`,
          `"${(biz.deal || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
      });

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `locallink-businesses-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  // Note: Loading state is now handled inline in the main view
  // This allows the header and navigation to appear immediately
  // while content loads progressively

  const localGems = [...businesses]
    .filter(biz => !biz.isChain)
    .sort((a, b) => {
      const diff = b.relevancyScore - a.relevancyScore;
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    })
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
            {user ? (
              <div className={styles.userMenu}>
                <span className={styles.username}>Hi, {user.username}</span>
                <button
                  className={view === "myReviews" ? styles.navButtonActive : styles.navButton}
                  onClick={goToMyReviews}
                  aria-current={view === "myReviews" ? "page" : undefined}
                >
                  My Reviews
                </button>
                <button
                  className={styles.navButton}
                  onClick={handleLogout}
                  aria-label="Log out"
                >
                  Log Out
                </button>
              </div>
            ) : (
              <div className={styles.authButtons}>
                <button
                  className={view === "login" ? styles.navButtonActive : styles.navButton}
                  onClick={() => navigateToAuth("login")}
                >
                  Log In
                </button>
                <button
                  className={view === "signup" ? styles.authButtonSignup : styles.authButtonSignup}
                  onClick={() => navigateToAuth("signup")}
                >
                  Sign Up
                </button>
              </div>
            )}
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
                      <div className={styles.cardRatingRow}>
                        {biz.rating > 0 ? (
                          <span className={styles.cardRating}>⭐ {biz.rating.toFixed(1)}</span>
                        ) : (
                          <span className={styles.noRating}>No ratings</span>
                        )}
                        <span className={styles.cardReviewCount}>
                          {biz.reviewCount > 0 ? `(${biz.reviewCount} ${biz.reviewCount === 1 ? 'review' : 'reviews'})` : ''}
                        </span>
                      </div>
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
                  {(() => {
                    const dedupedCount = deduplicateChains(filteredBusinesses).length;
                    const startNum = (businessPage - 1) * BUSINESSES_PER_PAGE + 1;
                    const endNum = Math.min(businessPage * BUSINESSES_PER_PAGE, dedupedCount);
                    return dedupedCount > BUSINESSES_PER_PAGE
                      ? `Showing ${startNum}-${endNum} of ${dedupedCount} businesses`
                      : `Showing ${dedupedCount} ${dedupedCount === 1 ? 'business' : 'businesses'}`;
                  })()}
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

            {/* Label/Tag Chip Filter */}
            <div className={styles.labelFilterSection}>
              <div className={styles.labelFilterHeader}>
                <input
                  type="text"
                  placeholder="Search labels (e.g., Pizza, Coffee, Salon)..."
                  value={labelSearchTerm}
                  onChange={e => setLabelSearchTerm(e.target.value)}
                  className={styles.labelSearchInput}
                  aria-label="Search for labels to filter by"
                />
                {selectedTags.length > 0 && (
                  <button
                    onClick={() => setSelectedTags([])}
                    className={styles.clearFiltersBtn}
                    aria-label="Clear all selected labels"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Selected Tags */}
              {selectedTags.length > 0 && (
                <div className={styles.selectedTagsRow}>
                  <span className={styles.selectedTagsLabel}>Active filters:</span>
                  <div className={styles.tagChipsContainer}>
                    {selectedTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={styles.tagChipSelected}
                        aria-label={`Remove ${tag} filter`}
                      >
                        {tag} ×
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Available Tags (filtered by search) */}
              <div className={styles.availableTagsRow}>
                {(() => {
                  const searchLower = labelSearchTerm.toLowerCase().trim();
                  const filteredTags = availableTags
                    .filter(({ tag }) =>
                      !selectedTags.includes(tag) &&
                      (searchLower === '' || tag.toLowerCase().includes(searchLower))
                    )
                    .slice(0, searchLower ? 20 : 12); // Show more when searching

                  if (filteredTags.length === 0 && labelSearchTerm) {
                    return <span className={styles.noLabelsFound}>No labels match "{labelSearchTerm}"</span>;
                  }

                  return filteredTags.map(({ tag, count }) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={styles.tagChip}
                      aria-label={`Filter by ${tag}`}
                    >
                      {tag} <span className={styles.tagCount}>({count})</span>
                    </button>
                  ));
                })()}
                {!labelSearchTerm && availableTags.filter(t => !selectedTags.includes(t.tag)).length > 12 && (
                  <span className={styles.moreLabelsHint}>
                    Type to search {availableTags.length - 12} more labels...
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Business List */}
          <section className={styles.businessGrid} aria-label="Business listings">
            {loading ? (
              // Show skeleton cards while loading
              <>
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
              </>
            ) : filteredBusinesses.length === 0 ? (
              <div className={styles.noResults} role="status">
                No businesses found. Try adjusting your filters.
              </div>
            ) : (
              (() => {
                const allBusinesses = deduplicateChains(filteredBusinesses);
                const totalBusinessPages = Math.ceil(allBusinesses.length / BUSINESSES_PER_PAGE);
                const startIdx = (businessPage - 1) * BUSINESSES_PER_PAGE;
                const paginatedBusinesses = allBusinesses.slice(startIdx, startIdx + BUSINESSES_PER_PAGE);

                return paginatedBusinesses.map(biz => (
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
                        className={favorites.includes(biz.id) ? styles.favoriteBtnActive : styles.favoriteBtn}
                        aria-label={favorites.includes(biz.id) ? `Remove ${biz.name} from favorites` : (user ? `Add ${biz.name} to favorites` : "Log in to save favorites")}
                        aria-pressed={favorites.includes(biz.id)}
                        title={user ? (favorites.includes(biz.id) ? "Remove from favorites" : "Add to favorites") : "Log in to save favorites"}
                      >
                        <HeartIcon filled={favorites.includes(biz.id)} size={18} />
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
              ));
              })()
            )}
          </section>

          {/* Business Pagination Controls */}
          {filteredBusinesses.length > BUSINESSES_PER_PAGE && (
            <div className={styles.paginationControls} style={{ marginTop: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
              <button
                onClick={() => setBusinessPage(p => Math.max(1, p - 1))}
                disabled={businessPage === 1}
                className={styles.paginationBtn}
              >
                Previous
              </button>
              <div className={styles.paginationNumbers}>
                {(() => {
                  const totalPages = Math.ceil(deduplicateChains(filteredBusinesses).length / BUSINESSES_PER_PAGE);
                  const pages = [];
                  const maxVisiblePages = 8;

                  if (totalPages <= maxVisiblePages) {
                    // Show all pages if total is 8 or less
                    for (let i = 1; i <= totalPages; i++) {
                      pages.push(i);
                    }
                  } else {
                    // Calculate the range of pages to show (8 pages centered around current)
                    let startPage = Math.max(1, businessPage - Math.floor(maxVisiblePages / 2));
                    let endPage = startPage + maxVisiblePages - 1;

                    // Adjust if we're near the end
                    if (endPage > totalPages) {
                      endPage = totalPages;
                      startPage = Math.max(1, endPage - maxVisiblePages + 1);
                    }

                    // Always show first page with ellipsis if needed
                    if (startPage > 1) {
                      pages.push(1);
                      if (startPage > 2) pages.push('...');
                    }

                    // Add the range of pages
                    for (let i = startPage; i <= endPage; i++) {
                      if (!pages.includes(i)) pages.push(i);
                    }

                    // Always show last page with ellipsis if needed
                    if (endPage < totalPages) {
                      if (endPage < totalPages - 1) pages.push('...');
                      if (!pages.includes(totalPages)) pages.push(totalPages);
                    }
                  }

                  return pages.map((page, idx) => (
                    page === '...' ? (
                      <span key={`ellipsis-${idx}`} className={styles.paginationEllipsis}>...</span>
                    ) : (
                      <button
                        key={page}
                        onClick={() => setBusinessPage(page)}
                        className={businessPage === page ? styles.paginationBtnActive : styles.paginationBtn}
                      >
                        {page}
                      </button>
                    )
                  ));
                })()}
              </div>
              <button
                onClick={() => setBusinessPage(p => Math.min(Math.ceil(deduplicateChains(filteredBusinesses).length / BUSINESSES_PER_PAGE), p + 1))}
                disabled={businessPage >= Math.ceil(deduplicateChains(filteredBusinesses).length / BUSINESSES_PER_PAGE)}
                className={styles.paginationBtn}
              >
                Next
              </button>
            </div>
          )}

          {/* Developer Export Tool */}
          <div className={styles.devExportSection}>
            <details className={styles.devExportDetails}>
              <summary className={styles.devExportSummary}>Developer Tools</summary>
              <div className={styles.devExportContent}>
                <p className={styles.devExportText}>
                  Export {deduplicateChains(filteredBusinesses).length} currently displayed businesses:
                </p>
                <div className={styles.devExportButtons}>
                  <button
                    onClick={() => exportBusinesses('json')}
                    className={styles.devExportBtn}
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() => exportBusinesses('csv')}
                    className={styles.devExportBtn}
                  >
                    Export CSV
                  </button>
                </div>
              </div>
            </details>
          </div>
        </main>
      )}

      {/* Business Detail View - Redesigned */}
      {view === "business" && selectedBusiness && (
        <>
          <button
            onClick={() => {
              const targetScroll = savedScrollPosition;
              setSelectedBusiness(null);
              setView("home");
              // Restore scroll position after view change using requestAnimationFrame
              // for better reliability across different render speeds
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  window.scrollTo({ top: targetScroll, behavior: 'instant' });
                });
              });
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
                          ? `(${selectedBusiness.reviewCount} ${selectedBusiness.reviewCount === 1 ? 'review' : 'reviews'})`
                          : '(No reviews)'}
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

                {/* Favorite Button - Large prominent button in detail view */}
                <button
                  onClick={() => toggleFavorite(selectedBusiness.id)}
                  className={favorites.includes(selectedBusiness.id) ? styles.favoriteBtnLargeActive : styles.favoriteBtnLarge}
                  aria-label={favorites.includes(selectedBusiness.id) ? `Remove ${selectedBusiness.name} from favorites` : (user ? `Save ${selectedBusiness.name} to favorites` : "Log in to save favorites")}
                  title={user ? (favorites.includes(selectedBusiness.id) ? "Remove from favorites" : "Save to favorites") : "Log in to save favorites"}
                >
                  <HeartIcon filled={favorites.includes(selectedBusiness.id)} size={20} />
                  <span>{favorites.includes(selectedBusiness.id) ? "Favorited" : "Favorite"}</span>
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
                    <h2 className={styles.sectionHeader}>{selectedBusiness.reviewCount || selectedBusiness.reviews?.length || 0} {(selectedBusiness.reviewCount || selectedBusiness.reviews?.length || 0) === 1 ? 'Review' : 'Reviews'}</h2>
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
                        user ? (
                          <button onClick={startReview} className={styles.btnPrimary}>
                            Write a Review
                          </button>
                        ) : (
                          <button
                            onClick={() => navigateToAuth("login")}
                            className={styles.btnPrimary}
                            title="Log in to write a review"
                          >
                            Log in to Review
                          </button>
                        )
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

                      {/* Posting as info */}
                      <div className={styles.postingAs}>
                        <span>Posting as: </span>
                        <strong>{reviewForm.isAnonymous ? "Anonymous" : user?.username}</strong>
                      </div>

                      {/* Anonymous checkbox */}
                      <label className={styles.anonymousCheckbox}>
                        <input
                          type="checkbox"
                          checked={reviewForm.isAnonymous}
                          onChange={e => setReviewForm(prev => ({ ...prev, isAnonymous: e.target.checked }))}
                        />
                        <span>Post anonymously (hide your username)</span>
                      </label>

                      <div className={styles.formGroup}>
                        <label className={styles.label} htmlFor="rating-slider">
                          Overall Rating: {reviewForm.rating} ⭐
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

                      {/* Category Ratings Section */}
                      <div className={styles.categoryRatingsForm}>
                        <h5 className={styles.categoryRatingsTitle}>Rate by Category</h5>
                        <div className={styles.categoryRatingsGrid}>
                          <div className={styles.categoryRatingItem}>
                            <label className={styles.categoryLabel}>
                              Food Quality: {reviewForm.foodQuality}/5
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={reviewForm.foodQuality}
                              onChange={e => setReviewForm(prev => ({ ...prev, foodQuality: parseInt(e.target.value) }))}
                              className={styles.categorySlider}
                            />
                          </div>
                          <div className={styles.categoryRatingItem}>
                            <label className={styles.categoryLabel}>
                              Service: {reviewForm.service}/5
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={reviewForm.service}
                              onChange={e => setReviewForm(prev => ({ ...prev, service: parseInt(e.target.value) }))}
                              className={styles.categorySlider}
                            />
                          </div>
                          <div className={styles.categoryRatingItem}>
                            <label className={styles.categoryLabel}>
                              Cleanliness: {reviewForm.cleanliness}/5
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={reviewForm.cleanliness}
                              onChange={e => setReviewForm(prev => ({ ...prev, cleanliness: parseInt(e.target.value) }))}
                              className={styles.categorySlider}
                            />
                          </div>
                          <div className={styles.categoryRatingItem}>
                            <label className={styles.categoryLabel}>
                              Atmosphere: {reviewForm.atmosphere}/5
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={reviewForm.atmosphere}
                              onChange={e => setReviewForm(prev => ({ ...prev, atmosphere: parseInt(e.target.value) }))}
                              className={styles.categorySlider}
                            />
                          </div>
                        </div>
                      </div>

                      <textarea
                        placeholder="Share your experience (optional)..."
                        value={reviewForm.comment}
                        onChange={e => setReviewForm(prev => ({ ...prev, comment: e.target.value }))}
                        className={styles.textarea}
                        rows={4}
                        aria-label="Your review (optional)"
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

                  {/* Aggregate Category Ratings - shown if 10+ reviews with ratings */}
                  {selectedBusiness.categoryRatings && (
                    <div className={styles.aggregateCategoryRatings}>
                      <h4 className={styles.aggregateTitle}>Rating Breakdown</h4>
                      <div className={styles.aggregateGrid}>
                        {selectedBusiness.categoryRatings.foodQuality && (
                          <div className={styles.aggregateItem}>
                            <span className={styles.aggregateLabel}>Food Quality</span>
                            <div className={styles.aggregateBar}>
                              <div
                                className={styles.aggregateBarFill}
                                style={{ width: `${(selectedBusiness.categoryRatings.foodQuality / 5) * 100}%` }}
                              ></div>
                            </div>
                            <span className={styles.aggregateValue}>{selectedBusiness.categoryRatings.foodQuality}</span>
                          </div>
                        )}
                        {selectedBusiness.categoryRatings.service && (
                          <div className={styles.aggregateItem}>
                            <span className={styles.aggregateLabel}>Service</span>
                            <div className={styles.aggregateBar}>
                              <div
                                className={styles.aggregateBarFill}
                                style={{ width: `${(selectedBusiness.categoryRatings.service / 5) * 100}%` }}
                              ></div>
                            </div>
                            <span className={styles.aggregateValue}>{selectedBusiness.categoryRatings.service}</span>
                          </div>
                        )}
                        {selectedBusiness.categoryRatings.cleanliness && (
                          <div className={styles.aggregateItem}>
                            <span className={styles.aggregateLabel}>Cleanliness</span>
                            <div className={styles.aggregateBar}>
                              <div
                                className={styles.aggregateBarFill}
                                style={{ width: `${(selectedBusiness.categoryRatings.cleanliness / 5) * 100}%` }}
                              ></div>
                            </div>
                            <span className={styles.aggregateValue}>{selectedBusiness.categoryRatings.cleanliness}</span>
                          </div>
                        )}
                        {selectedBusiness.categoryRatings.atmosphere && (
                          <div className={styles.aggregateItem}>
                            <span className={styles.aggregateLabel}>Atmosphere</span>
                            <div className={styles.aggregateBar}>
                              <div
                                className={styles.aggregateBarFill}
                                style={{ width: `${(selectedBusiness.categoryRatings.atmosphere / 5) * 100}%` }}
                              ></div>
                            </div>
                            <span className={styles.aggregateValue}>{selectedBusiness.categoryRatings.atmosphere}</span>
                          </div>
                        )}
                      </div>
                      <p className={styles.aggregateNote}>
                        Based on {selectedBusiness.categoryRatings.reviewsWithRatings} reviews with category ratings
                      </p>
                    </div>
                  )}

                  {selectedBusiness.reviews.length === 0 ? (
                    <div className={styles.emptyStateContainer}>
                      <div className={styles.emptyStateIcon}>💬</div>
                      <h3 className={styles.emptyStateTitle}>No reviews yet</h3>
                      <p className={styles.emptyStateMessage}>
                        This is a new listing. Be the first to share your experience!
                      </p>
                      {!showReviewForm && (
                        user ? (
                          <button onClick={startReview} className={styles.btnAccent}>
                            Write the First Review
                          </button>
                        ) : (
                          <button
                            onClick={() => navigateToAuth("login")}
                            className={styles.btnAccent}
                            title="Log in to write a review"
                          >
                            Log in to Write the First Review
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className={styles.reviewsList}>
                      {(() => {
                        const sortedReviews = getStableSortedReviews(selectedBusiness.reviews);
                        const displayedReviews = sortedReviews.slice(0, visibleReviewsCount);

                        return displayedReviews.map(review => (
                        <div key={review.id} className={styles.reviewItem}>
                          {/* Edit form for this review */}
                          {editingReview && editingReview.id === review.id ? (
                            <form onSubmit={submitEditReview} className={styles.editReviewForm}>
                              <h4 className={styles.editFormTitle}>Edit Your Review</h4>

                              <div className={styles.formGroup}>
                                <label className={styles.label}>
                                  Overall Rating: {editForm.rating} ⭐
                                </label>
                                <input
                                  type="range"
                                  min="1"
                                  max="5"
                                  value={editForm.rating}
                                  onChange={(e) => setEditForm(prev => ({ ...prev, rating: parseInt(e.target.value) }))}
                                  className={styles.slider}
                                />
                              </div>

                              <div className={styles.categoryRatingsForm}>
                                <div className={styles.categoryRatingsGrid}>
                                  <div className={styles.categoryRatingItem}>
                                    <label className={styles.categoryLabel}>Food Quality: {editForm.foodQuality}/5</label>
                                    <input
                                      type="range"
                                      min="1"
                                      max="5"
                                      value={editForm.foodQuality}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, foodQuality: parseInt(e.target.value) }))}
                                      className={styles.categorySlider}
                                    />
                                  </div>
                                  <div className={styles.categoryRatingItem}>
                                    <label className={styles.categoryLabel}>Service: {editForm.service}/5</label>
                                    <input
                                      type="range"
                                      min="1"
                                      max="5"
                                      value={editForm.service}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, service: parseInt(e.target.value) }))}
                                      className={styles.categorySlider}
                                    />
                                  </div>
                                  <div className={styles.categoryRatingItem}>
                                    <label className={styles.categoryLabel}>Cleanliness: {editForm.cleanliness}/5</label>
                                    <input
                                      type="range"
                                      min="1"
                                      max="5"
                                      value={editForm.cleanliness}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, cleanliness: parseInt(e.target.value) }))}
                                      className={styles.categorySlider}
                                    />
                                  </div>
                                  <div className={styles.categoryRatingItem}>
                                    <label className={styles.categoryLabel}>Atmosphere: {editForm.atmosphere}/5</label>
                                    <input
                                      type="range"
                                      min="1"
                                      max="5"
                                      value={editForm.atmosphere}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, atmosphere: parseInt(e.target.value) }))}
                                      className={styles.categorySlider}
                                    />
                                  </div>
                                </div>
                              </div>

                              <textarea
                                value={editForm.comment}
                                onChange={(e) => setEditForm(prev => ({ ...prev, comment: e.target.value }))}
                                className={styles.textarea}
                                rows={3}
                                placeholder="Your review (optional)"
                              />

                              <label className={styles.anonymousCheckbox}>
                                <input
                                  type="checkbox"
                                  checked={editForm.isAnonymous}
                                  onChange={(e) => setEditForm(prev => ({ ...prev, isAnonymous: e.target.checked }))}
                                />
                                <span>Post anonymously</span>
                              </label>

                              <div className={styles.formButtons}>
                                <button type="submit" className={styles.submitBtn}>Save Changes</button>
                                <button type="button" onClick={cancelEditReview} className={styles.cancelBtn}>Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className={styles.reviewHeader}>
                                <strong className={styles.reviewAuthor}>
                                  {review.isAnonymous ? "Anonymous" : review.author}
                                  {user && review.userId === user.id && (
                                    <span className={styles.yourReviewBadge}>Your Review</span>
                                  )}
                                </strong>
                                <div className={styles.reviewRating}>
                                  {"⭐".repeat(review.rating)}
                                </div>
                              </div>

                              {/* Individual Category Ratings */}
                              {(review.foodQuality || review.service || review.cleanliness || review.atmosphere) && (
                                <div className={styles.reviewCategoryRatings}>
                                  {review.foodQuality && (
                                    <span className={styles.reviewCategoryBadge}>
                                      Food: {review.foodQuality}/5
                                    </span>
                                  )}
                                  {review.service && (
                                    <span className={styles.reviewCategoryBadge}>
                                      Service: {review.service}/5
                                    </span>
                                  )}
                                  {review.cleanliness && (
                                    <span className={styles.reviewCategoryBadge}>
                                      Clean: {review.cleanliness}/5
                                    </span>
                                  )}
                                  {review.atmosphere && (
                                    <span className={styles.reviewCategoryBadge}>
                                      Atmosphere: {review.atmosphere}/5
                                    </span>
                                  )}
                                </div>
                              )}

                              {review.comment && <p className={styles.reviewComment}>{review.comment}</p>}

                              {review.editedAt && (
                                <p className={styles.reviewEdited}>
                                  (edited {new Date(review.editedAt).toLocaleDateString()})
                                </p>
                              )}

                              <div className={styles.reviewFooter}>
                                <div className={styles.reviewDate}>
                                  {new Date(review.date).toLocaleDateString()}
                                </div>
                                <div className={styles.reviewInteractions}>
                                  {/* Edit/Delete buttons for own reviews */}
                                  {user && review.userId === user.id && (
                                    <>
                                      <button
                                        onClick={() => startEditReview(review)}
                                        className={styles.editButton}
                                        title="Edit your review"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => deleteReview(review.id)}
                                        className={styles.deleteButton}
                                        title="Delete your review"
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                  <button
                                    onClick={() => upvoteReview(review.id)}
                                    className={hasUserUpvoted(review) ? styles.upvoteButtonActive : styles.upvoteButton}
                                    title={hasUserUpvoted(review) ? "Click to remove your upvote" : (user ? "Mark as helpful" : "Log in to upvote")}
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
                            </>
                          )}
                        </div>
                      ));
                      })()}

                      {/* See More / Hide Reviews Controls */}
                      {selectedBusiness.reviews.length > INITIAL_REVIEWS_COUNT && (
                        <div className={styles.reviewsLoadMore}>
                          {visibleReviewsCount < selectedBusiness.reviews.length && (
                            <button
                              onClick={() => {
                                setVisibleReviewsCount(prev => Math.min(prev + REVIEWS_LOAD_MORE, selectedBusiness.reviews.length));
                                setReviewsExpanded(true);
                              }}
                              className={styles.seeMoreBtn}
                            >
                              See more reviews ({selectedBusiness.reviews.length - visibleReviewsCount} remaining)
                            </button>
                          )}
                          {reviewsExpanded && (
                            <button
                              onClick={() => {
                                setVisibleReviewsCount(INITIAL_REVIEWS_COUNT);
                                setReviewsExpanded(false);
                              }}
                              className={styles.hideReviewsBtn}
                            >
                              Hide reviews
                            </button>
                          )}
                        </div>
                      )}
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

          {/* Show login prompt if not authenticated */}
          {!user ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>❤️</div>
              <h3 className={styles.emptyStateTitle}>Log in to save favorites</h3>
              <p className={styles.emptyStateMessage}>
                Create an account or log in to save your favorite businesses and receive personalized recommendations.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => navigateToAuth("login")} className={styles.btnPrimary}>
                  Log In
                </button>
                <button onClick={() => navigateToAuth("signup")} className={styles.btnSecondary}>
                  Create Account
                </button>
              </div>
            </div>
          ) : favorites.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>You haven't saved any favorites yet.</p>
              <button onClick={() => setView("home")} className={styles.browseBtn}>
                Browse Businesses
              </button>
            </div>
          ) : (
            <>
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
                            className={styles.favoriteBtnActive}
                            aria-label={`Remove ${biz.name} from favorites`}
                            aria-pressed="true"
                            title="Remove from favorites"
                          >
                            <HeartIcon filled={true} size={18} />
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
              <div className={styles.clearFavoritesContainer}>
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to clear all favorites?')) {
                      setFavorites([]);
                    }
                  }}
                  className={styles.clearFavoritesBtn}
                  aria-label="Clear all favorites"
                >
                  Clear All Favorites
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* My Reviews View */}
      {view === "myReviews" && (
        <main className={styles.content} id="main-content" role="main">
          <h2 className={styles.pageTitle}>My Reviews</h2>

          {myReviewsLoading ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>Loading your reviews...</p>
            </div>
          ) : myReviews.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>📝</div>
              <h3 className={styles.emptyStateTitle}>No reviews yet</h3>
              <p className={styles.emptyStateMessage}>
                You haven't written any reviews yet. Explore businesses and share your experiences!
              </p>
              <button onClick={() => setView("home")} className={styles.btnPrimary}>
                Browse Businesses
              </button>
            </div>
          ) : (
            <div className={styles.myReviewsList}>
              {myReviews.map(review => (
                <article key={review.id} className={styles.myReviewCard}>
                  <div className={styles.myReviewHeader}>
                    <div className={styles.myReviewBusiness}>
                      {review.businessImage && (
                        <img
                          src={review.businessImage}
                          alt={review.businessName}
                          className={styles.myReviewBusinessImage}
                        />
                      )}
                      <div className={styles.myReviewBusinessInfo}>
                        <h3 className={styles.myReviewBusinessName}>{review.businessName}</h3>
                        <span className={styles.myReviewBusinessCategory}>{review.businessCategory}</span>
                      </div>
                    </div>
                    <button
                      className={styles.myReviewViewBtn}
                      onClick={() => {
                        const business = businesses.find(b => b.id === review.businessId);
                        if (business) {
                          viewBusiness(business);
                        } else {
                          // Fetch and navigate to business
                          fetch(`${API_URL}/businesses/${review.businessId}`, {
                            headers: getAuthHeaders()
                          })
                            .then(r => r.json())
                            .then(data => {
                              setSelectedBusiness(data);
                              setView("business");
                              window.scrollTo({ top: 0, behavior: 'instant' });
                            })
                            .catch(err => console.error(err));
                        }
                      }}
                    >
                      View Business →
                    </button>
                  </div>

                  <div className={styles.myReviewContent}>
                    <div className={styles.myReviewRating}>
                      <span className={styles.myReviewStars}>
                        {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                      </span>
                      <span className={styles.myReviewDate}>
                        {new Date(review.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                        {review.editedAt && " (edited)"}
                      </span>
                    </div>

                    {review.comment && (
                      <p className={styles.myReviewComment}>{review.comment}</p>
                    )}

                    <div className={styles.myReviewCategories}>
                      {review.foodQuality && (
                        <span className={styles.myReviewCategoryRating}>
                          Food: {review.foodQuality}/5
                        </span>
                      )}
                      {review.service && (
                        <span className={styles.myReviewCategoryRating}>
                          Service: {review.service}/5
                        </span>
                      )}
                      {review.cleanliness && (
                        <span className={styles.myReviewCategoryRating}>
                          Clean: {review.cleanliness}/5
                        </span>
                      )}
                      {review.atmosphere && (
                        <span className={styles.myReviewCategoryRating}>
                          Vibe: {review.atmosphere}/5
                        </span>
                      )}
                    </div>

                    <div className={styles.myReviewActions}>
                      <span className={styles.myReviewHelpful}>
                        👍 {review.helpful || 0} found helpful
                      </span>
                      <div className={styles.myReviewButtons}>
                        <button
                          className={styles.myReviewEditBtn}
                          onClick={() => {
                            // Navigate to business and open edit mode
                            const business = businesses.find(b => b.id === review.businessId);
                            if (business) {
                              setSelectedBusiness(business);
                              setView("business");
                              // Fetch full details and then open edit
                              fetch(`${API_URL}/businesses/${review.businessId}`, {
                                headers: getAuthHeaders()
                              })
                                .then(r => r.json())
                                .then(data => {
                                  setSelectedBusiness(data);
                                  // Find the review in the loaded data and start edit
                                  const reviewToEdit = data.reviews?.find(r => r.id === review.id);
                                  if (reviewToEdit) {
                                    setEditingReview(reviewToEdit);
                                    setEditForm({
                                      rating: reviewToEdit.rating,
                                      comment: reviewToEdit.comment || "",
                                      foodQuality: reviewToEdit.foodQuality || 3,
                                      service: reviewToEdit.service || 3,
                                      cleanliness: reviewToEdit.cleanliness || 3,
                                      atmosphere: reviewToEdit.atmosphere || 3,
                                      isAnonymous: reviewToEdit.isAnonymous || false
                                    });
                                  }
                                  window.scrollTo({ top: 0, behavior: 'instant' });
                                })
                                .catch(err => console.error(err));
                            }
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className={styles.myReviewDeleteBtn}
                          onClick={async () => {
                            if (!window.confirm("Are you sure you want to delete this review? This action cannot be undone.")) {
                              return;
                            }
                            try {
                              const res = await fetch(`${API_URL}/businesses/${review.businessId}/reviews/${review.id}`, {
                                method: "DELETE",
                                headers: getAuthHeaders()
                              });
                              if (res.ok) {
                                setMyReviews(prev => prev.filter(r => r.id !== review.id));
                                alert("Review deleted successfully!");
                              } else {
                                const data = await res.json();
                                alert(data.error || "Failed to delete review");
                              }
                            } catch (err) {
                              console.error("Failed to delete review:", err);
                              alert("Failed to delete review. Please try again.");
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      )}

      {/* Login View */}
      {view === "login" && (
        <main className={styles.content} id="main-content" role="main">
          <div className={styles.authContainer}>
            <div className={styles.authCard}>
              <h2 className={styles.authTitle}>Log In</h2>
              <p className={styles.authSubtitle}>Welcome back! Log in to leave reviews and interact with the community.</p>

              {authError && (
                <div className={styles.authError} role="alert">
                  {authError}
                </div>
              )}

              <form onSubmit={handleLogin} className={styles.authForm}>
                <div className={styles.formGroup}>
                  <label htmlFor="login-username" className={styles.label}>Username</label>
                  <input
                    id="login-username"
                    type="text"
                    value={loginForm.username}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                    className={styles.input}
                    placeholder="Enter your username"
                    required
                    autoComplete="username"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="login-password" className={styles.label}>Password</label>
                  <input
                    id="login-password"
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    className={styles.input}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                  />
                </div>

                <button type="submit" className={styles.authSubmitBtn}>
                  Log In
                </button>
              </form>

              <p className={styles.authSwitch}>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => navigateToAuth("signup")}
                  className={styles.authSwitchLink}
                >
                  Sign up
                </button>
              </p>
            </div>
          </div>
        </main>
      )}

      {/* Signup View */}
      {view === "signup" && (
        <main className={styles.content} id="main-content" role="main">
          <div className={styles.authContainer}>
            <div className={styles.authCard}>
              <h2 className={styles.authTitle}>Create Account</h2>
              <p className={styles.authSubtitle}>Join LocalLink to share your experiences and support local businesses.</p>

              {authError && (
                <div className={styles.authError} role="alert">
                  {authError}
                </div>
              )}

              <form onSubmit={handleSignup} className={styles.authForm}>
                <div className={styles.formGroup}>
                  <label htmlFor="signup-username" className={styles.label}>Username</label>
                  <input
                    id="signup-username"
                    type="text"
                    value={signupForm.username}
                    onChange={(e) => setSignupForm(prev => ({ ...prev, username: e.target.value }))}
                    className={styles.input}
                    placeholder="Choose a username (3-20 characters)"
                    required
                    minLength={3}
                    maxLength={20}
                    pattern="[a-zA-Z0-9_]+"
                    title="Username can only contain letters, numbers, and underscores"
                    autoComplete="username"
                  />
                  <p className={styles.inputHint}>Letters, numbers, and underscores only</p>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-password" className={styles.label}>Password</label>
                  <input
                    id="signup-password"
                    type="password"
                    value={signupForm.password}
                    onChange={(e) => setSignupForm(prev => ({ ...prev, password: e.target.value }))}
                    className={styles.input}
                    placeholder="Create a password (min 6 characters)"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <p className={styles.inputHint}>Must be at least 6 characters</p>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="signup-confirm" className={styles.label}>Confirm Password</label>
                  <input
                    id="signup-confirm"
                    type="password"
                    value={signupForm.confirmPassword}
                    onChange={(e) => setSignupForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className={styles.input}
                    placeholder="Confirm your password"
                    required
                    autoComplete="new-password"
                  />
                </div>

                <button type="submit" className={styles.authSubmitBtn}>
                  Create Account
                </button>
              </form>

              <p className={styles.authSwitch}>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => navigateToAuth("login")}
                  className={styles.authSwitchLink}
                >
                  Log in
                </button>
              </p>
            </div>
          </div>
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
