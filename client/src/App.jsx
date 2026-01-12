import { useEffect, useState } from "react";
import styles from "./App.module.css";

const API_URL = "http://localhost:3001/api";

function App() {
  const [view, setView] = useState("home"); // home, business, favorites
  const [businesses, setBusinesses] = useState([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [trending, setTrending] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  
  // Filters
  const [category, setCategory] = useState("All");
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
    verificationAnswer: ""
  });
  const [verificationChallenge, setVerificationChallenge] = useState(null);
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Load favorites from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("locallink_favorites");
    if (saved) {
      setFavorites(JSON.parse(saved));
    }
  }, []);

  // Save favorites to localStorage
  useEffect(() => {
    localStorage.setItem("locallink_favorites", JSON.stringify(favorites));
  }, [favorites]);

  // Fetch initial data
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/businesses`).then(r => r.json()),
      fetch(`${API_URL}/trending`).then(r => r.json()),
      fetch(`${API_URL}/analytics`).then(r => r.json())
    ])
      .then(([bizData, trendData, analyticsData]) => {
        setBusinesses(bizData);
        setFilteredBusinesses(bizData);
        setTrending(trendData);
        setAnalytics(analyticsData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching data:', err);
        alert('Failed to fetch business data. Please try again.');
        setLoading(false);
      });
  }, []);

  // Apply filters and search
  useEffect(() => {
    const params = new URLSearchParams();
    if (category !== "All") params.append("category", category);
    if (searchTerm) params.append("search", searchTerm);
    if (minRating) params.append("minRating", minRating);
    if (showDealsOnly) params.append("hasDeals", "true");
    if (sortBy) params.append("sort", sortBy);
    params.append("limit", "300");

    fetch(`${API_URL}/businesses?${params}`)
      .then(r => r.json())
      .then(data => setFilteredBusinesses(data))
      .catch(err => console.error(err));
  }, [category, searchTerm, minRating, showDealsOnly, sortBy]);

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
    setSelectedBusiness(business);
    setView("business");
    setShowReviewForm(false);
    setDetailLoading(true);

    fetch(`${API_URL}/businesses/${business.id}`)
      .then(r => r.json())
      .then(data => setSelectedBusiness(data))
      .catch(err => console.error(err))
      .finally(() => setDetailLoading(false));
  };

  const startReview = async () => {
    try {
      const res = await fetch(`${API_URL}/verification/challenge`);
      const challenge = await res.json();
      setVerificationChallenge(challenge);
      setReviewForm(prev => ({ ...prev, verificationId: challenge.id }));
      setShowReviewForm(true);
    } catch (err) {
      alert("Failed to load verification. Please try again.");
    }
  };

  const submitReview = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/businesses/${selectedBusiness.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewForm)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || "Failed to submit review");
        return;
      }

      alert("Review submitted successfully!");
      setShowReviewForm(false);
      setReviewForm({ author: "", rating: 5, comment: "", verificationId: "", verificationAnswer: "" });
      
      // Refresh business data
      const updatedBiz = await fetch(`${API_URL}/businesses/${selectedBusiness.id}`).then(r => r.json());
      setSelectedBusiness(updatedBiz);
    } catch (err) {
      alert("Failed to submit review. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading} role="status" aria-live="polite">
          Loading LocalLink...
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
                <div className={styles.statNumber}>{totalBusinessesCount}</div>
                <div className={styles.statLabel}>Local Businesses</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{analytics.totalUserReviews || 0}</div>
                <div className={styles.statLabel}>Community Reviews</div>
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

          {/* Community Insights */}
          {analytics && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Community Insights</h3>
              <div className={styles.insightsGrid}>
                <div className={styles.insightCard}>
                  <h4 className={styles.insightTitle}>Top Categories</h4>
                  <ul className={styles.insightList}>
                    {Object.entries(categoryCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([cat, count]) => (
                        <li key={cat} className={styles.insightItem}>
                          <span>{cat}</span>
                          <span className={styles.insightValue}>{count}</span>
                        </li>
                      ))}
                  </ul>
                </div>
                <div className={styles.insightCard}>
                  <h4 className={styles.insightTitle}>Top Rated</h4>
                  <ul className={styles.insightList}>
                    {topRated.map(item => (
                      <li key={item.id} className={styles.insightItem}>
                        <span>{item.name}</span>
                        <span className={styles.insightValue}>⭐ {item.rating}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={styles.insightCard}>
                  <h4 className={styles.insightTitle}>Quick Picks</h4>
                  <p className={styles.insightBody}>
                    Filter by category or deals to find the perfect local spot for today.
                  </p>
                  <div className={styles.insightTags}>
                    {["Food", "Retail", "Services"].map(cat => (
                      <button
                        key={cat}
                        onClick={() => {
                          setCategory(cat);
                          setView("home");
                        }}
                        className={styles.insightTag}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <section className={styles.filtersSection} data-section="filters" aria-labelledby="filters-title">
            <h3 id="filters-title" className={styles.sectionTitle}>Browse All Businesses</h3>
            <p className={styles.sectionSubtitle}>
              Showing top {filteredBusinesses.length} results of {totalBusinessesCount} businesses.
            </p>

            <div className={styles.filters} role="search">
              <input
                type="text"
                placeholder="Search businesses, tags, or categories..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className={styles.searchInput}
                aria-label="Search businesses by name, tags, or categories"
              />
              
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className={styles.select}
                aria-label="Filter by category"
              >
                <option value="All">All Categories</option>
                <option value="Food">Food ({totalCategoryCounts.Food || 0})</option>
                <option value="Retail">Retail ({totalCategoryCounts.Retail || 0})</option>
                <option value="Services">Services ({totalCategoryCounts.Services || 0})</option>
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

              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className={styles.select}
                aria-label="Sort businesses"
              >
                <option value="rating">Sort: Rating</option>
                <option value="reviews">Sort: Most Reviews</option>
                <option value="name">Sort: Name</option>
                <option value="local">Sort: Local Favorites</option>
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

      {/* Business Detail View */}
      {view === "business" && selectedBusiness && (
        <main className={styles.content} id="main-content" role="main">
          <button onClick={() => setView("home")} className={styles.backButton}>
            ← Back to Browse
          </button>

          {detailLoading && (
            <div className={styles.detailLoading}>Loading business details...</div>
          )}

          <div className={styles.detailCard}>
            <img
              src={selectedBusiness.image}
              alt={selectedBusiness.name}
              className={styles.detailImage}
            />
            
            <div className={styles.detailContent}>
              <div className={styles.detailHeader}>
                <div>
                  <h2 className={styles.detailTitle}>{selectedBusiness.name}</h2>
                  <div className={styles.detailMeta}>
                    <span className={styles.category}>{selectedBusiness.category}</span>
                    <span className={styles.priceRange}>{selectedBusiness.priceRange}</span>
                  </div>
                </div>
                <button
                  onClick={() => toggleFavorite(selectedBusiness.id)}
                  className={styles.favoriteBtnLarge}
                  aria-label={favorites.includes(selectedBusiness.id) ? `Remove ${selectedBusiness.name} from favorites` : `Add ${selectedBusiness.name} to favorites`}
                  aria-pressed={favorites.includes(selectedBusiness.id)}
                >
                  {favorites.includes(selectedBusiness.id) ? "❤️" : "🤍"}
                </button>
              </div>

              <div className={styles.ratingSection}>
                {selectedBusiness.rating > 0 ? (
                  <div className={styles.bigRating} aria-label={`Average rating: ${selectedBusiness.rating.toFixed(1)} out of 5 stars`}>
                    ⭐ {selectedBusiness.rating.toFixed(1)}
                  </div>
                ) : (
                  <div className={styles.noRating}>No ratings yet</div>
                )}
                <div className={styles.reviewCount}>
                  {selectedBusiness.reviewCount > 0
                    ? `${selectedBusiness.reviewCount} reviews`
                    : "No reviews yet"}
                </div>
              </div>

              <p className={styles.detailDescription}>{selectedBusiness.description}</p>

              {selectedBusiness.deal && (
                <div className={styles.dealLarge}>
                  🎁 <strong>Special Offer:</strong> {selectedBusiness.deal}
                </div>
              )}

              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <div className={styles.infoLabel}>📍 Address</div>
                  <div className={styles.infoValue}>{selectedBusiness.address}</div>
                </div>
                <div className={styles.infoItem}>
                  <div className={styles.infoLabel}>📞 Phone</div>
                  <div className={styles.infoValue}>{selectedBusiness.phone}</div>
                </div>
                <div className={styles.infoItem}>
                  <div className={styles.infoLabel}>🕐 Hours</div>
                  <div className={styles.infoValue}>
                    {selectedBusiness.hours}
                    {selectedBusiness.isOpenNow !== undefined && (
                      <span className={selectedBusiness.isOpenNow ? styles.openNow : styles.closedNow}>
                        {selectedBusiness.isOpenNow ? ' • Open Now' : ' • Closed'}
                      </span>
                    )}
                  </div>
                </div>
                {selectedBusiness.website && (
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>🌐 Website</div>
                    <div className={styles.infoValue}>
                      <a
                        href={selectedBusiness.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.link}
                      >
                        Visit Website
                      </a>
                    </div>
                  </div>
                )}
                {selectedBusiness.googleMapsUrl && (
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>🗺️ Directions</div>
                    <div className={styles.infoValue}>
                      <a
                        href={selectedBusiness.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.link}
                      >
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.tags}>
                {selectedBusiness.tags.map(tag => (
                  <span key={tag} className={styles.tag}>{tag}</span>
                ))}
              </div>

              {/* Reviews Section */}
              <div className={styles.reviewsSection}>
                <div className={styles.reviewsHeader}>
                  <h3 className={styles.reviewsTitle}>Customer Reviews</h3>
                  {!showReviewForm && (
                    <button onClick={startReview} className={styles.writeReviewBtn}>
                      Write a Review
                    </button>
                  )}
                </div>

                {showReviewForm && verificationChallenge && (
                  <form onSubmit={submitReview} className={styles.reviewForm} aria-labelledby="review-form-title">
                    <h4 id="review-form-title" className={styles.formTitle}>Write Your Review</h4>

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

                    <div className={styles.verification}>
                      <label className={styles.label} htmlFor="verification-answer">
                        Verification (anti-spam): {verificationChallenge.question}
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
                  <p className={styles.noReviews}>No reviews yet. Be the first to review!</p>
                ) : (
                  <div className={styles.reviewsList}>
                    {selectedBusiness.reviews.map(review => (
                      <div key={review.id} className={styles.reviewItem}>
                        <div className={styles.reviewHeader}>
                          <strong className={styles.reviewAuthor}>{review.author}</strong>
                          <div className={styles.reviewRating}>
                            {"⭐".repeat(review.rating)}
                          </div>
                        </div>
                        <p className={styles.reviewComment}>{review.comment}</p>
                        <div className={styles.reviewDate}>
                          {new Date(review.date).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
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
        <p className={styles.footerText}>
          LocalLink - Supporting local businesses since 2024 | 
          Made for FBLA Byte-Sized Business Boost
        </p>
      </footer>
    </div>
  );
}

export default App;
