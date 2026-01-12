import { useEffect, useState } from "react";

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
    params.append("limit", "30");

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
      <div style={styles.container}>
        <div style={styles.loading}>Loading LocalLink...</div>
      </div>
    );
  }

  const localGems = [...businesses]
    .filter(biz => !biz.isChain)
    .sort((a, b) => b.relevancyScore - a.relevancyScore)
    .slice(0, 4);

  const categoryCounts = analytics?.byCategory || {};
  const topRated = analytics?.topRated || [];

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.logo} onClick={() => setView("home")}>
            🏪 LocalLink
          </h1>
          <nav style={styles.nav}>
            <button
              style={view === "home" ? styles.navButtonActive : styles.navButton}
              onClick={() => setView("home")}
            >
              Home
            </button>
            <button
              style={view === "favorites" ? styles.navButtonActive : styles.navButton}
              onClick={() => setView("favorites")}
            >
              Favorites ({favorites.length})
            </button>
          </nav>
        </div>
      </header>

      {/* Home View */}
      {view === "home" && (
        <div style={styles.content}>
          {/* Hero Section */}
          <div style={styles.hero}>
            <h2 style={styles.heroTitle}>Discover & Support Local Businesses in Cumming, GA</h2>
            <p style={styles.heroSubtitle}>
              Explore the best local shops, restaurants, and services within 10 miles of Cumming, Georgia
            </p>
            <div style={styles.heroActions}>
              <button style={styles.heroPrimary} onClick={() => setView("home")}>
                Start Exploring
              </button>
              <button
                style={styles.heroSecondary}
                onClick={() => setView("favorites")}
              >
                View Favorites
              </button>
            </div>
          </div>

          {/* Analytics Cards */}
          {analytics && (
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{analytics.cachedBusinesses}</div>
                <div style={styles.statLabel}>Top Businesses Cached (Local Memory)</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>⭐ {analytics.avgRating}</div>
                <div style={styles.statLabel}>Average Rating</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{analytics.dealsAvailable}</div>
                <div style={styles.statLabel}>Active Deals</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{analytics.totalReviews}</div>
                <div style={styles.statLabel}>Total Reviews</div>
              </div>
            </div>
          )}

          {/* Trending Section */}
          {trending.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>🔥 Trending Now</h3>
              <div style={styles.trendingGrid}>
                {trending.filter(biz => !biz.isChain).slice(0, 3).map(biz => (
                  <div
                    key={biz.id}
                    style={styles.trendingCard}
                    onClick={() => viewBusiness(biz)}
                  >
                    <img src={biz.image} alt={biz.name} style={styles.trendingImage} />
                    <div style={styles.trendingContent}>
                      <h4 style={styles.trendingName}>{biz.name}</h4>
                      <div style={styles.rating}>⭐ {biz.rating}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Local Gems */}
          {localGems.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>✨ Local Gems</h3>
              <p style={styles.sectionSubtitle}>
                Handpicked spots with strong local impact and standout ratings.
              </p>
              <div style={styles.recommendGrid}>
                {localGems.map(biz => (
                  <div
                    key={biz.id}
                    style={styles.recommendCard}
                    onClick={() => viewBusiness(biz)}
                  >
                    <img src={biz.image} alt={biz.name} style={styles.cardImage} />
                    <div style={styles.cardContent}>
                      <div style={styles.cardHeader}>
                        <h4 style={styles.cardTitle}>{biz.name}</h4>
                        <span style={styles.localBadge}>Local Favorite</span>
                      </div>
                      <div style={styles.cardRating}>⭐ {biz.rating}</div>
                      <p style={styles.cardCategory}>{biz.category}</p>
                      {biz.deal && (
                        <div style={styles.dealPill}>🎁 {biz.deal}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>💡 Recommended For You</h3>
              <div style={styles.recommendGrid}>
                {recommendations.map(biz => (
                  <div
                    key={biz.id}
                    style={styles.recommendCard}
                    onClick={() => viewBusiness(biz)}
                  >
                    <img src={biz.image} alt={biz.name} style={styles.cardImage} />
                    <div style={styles.cardContent}>
                      <h4 style={styles.cardTitle}>{biz.name}</h4>
                      <div style={styles.cardRating}>⭐ {biz.rating}</div>
                      <p style={styles.cardCategory}>{biz.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Community Insights */}
          {analytics && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>📊 Community Insights</h3>
              <div style={styles.insightsGrid}>
                <div style={styles.insightCard}>
                  <h4 style={styles.insightTitle}>Top Categories</h4>
                  <ul style={styles.insightList}>
                    {Object.entries(categoryCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([cat, count]) => (
                        <li key={cat} style={styles.insightItem}>
                          <span>{cat}</span>
                          <span style={styles.insightValue}>{count}</span>
                        </li>
                      ))}
                  </ul>
                </div>
                <div style={styles.insightCard}>
                  <h4 style={styles.insightTitle}>Top Rated</h4>
                  <ul style={styles.insightList}>
                    {topRated.map(item => (
                      <li key={item.id} style={styles.insightItem}>
                        <span>{item.name}</span>
                        <span style={styles.insightValue}>⭐ {item.rating}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={styles.insightCard}>
                  <h4 style={styles.insightTitle}>Quick Picks</h4>
                  <p style={styles.insightBody}>
                    Filter by category or deals to find the perfect local spot for today.
                  </p>
                  <div style={styles.insightTags}>
                    {["Food", "Retail", "Services"].map(cat => (
                      <button
                        key={cat}
                        onClick={() => {
                          setCategory(cat);
                          setView("home");
                        }}
                        style={styles.insightTag}
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
          <div style={styles.filtersSection}>
            <h3 style={styles.sectionTitle}>Browse All Businesses in Cumming, GA</h3>

            <div style={styles.filters}>
              <input
                type="text"
                placeholder="🔍 Search businesses, tags, or categories..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={styles.searchInput}
              />
              
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={styles.select}
              >
                <option value="All">All</option>
                <option value="Food">Food ({categoryCounts.Food || 0})</option>
                <option value="Retail">Retail ({categoryCounts.Retail || 0})</option>
                <option value="Services">Services ({categoryCounts.Services || 0})</option>
              </select>

              <select
                value={minRating}
                onChange={e => setMinRating(e.target.value)}
                style={styles.select}
              >
                <option value="">Any Rating</option>
                <option value="4">4+ Stars</option>
                <option value="4.5">4.5+ Stars</option>
              </select>

              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={styles.select}
              >
                <option value="rating">Sort: Rating</option>
                <option value="reviews">Sort: Most Reviews</option>
                <option value="name">Sort: Name</option>
                <option value="local">Sort: Local Favorites</option>
              </select>

              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={showDealsOnly}
                  onChange={e => setShowDealsOnly(e.target.checked)}
                />
                <span style={styles.checkboxLabel}>Deals Only</span>
              </label>
            </div>
          </div>

          {/* Business List */}
          <div style={styles.businessGrid}>
            {filteredBusinesses.length === 0 ? (
              <div style={styles.noResults}>No businesses found. Try adjusting your filters.</div>
            ) : (
              deduplicateChains(filteredBusinesses).map(biz => (
                <div key={biz.id} style={styles.businessCard}>
                  <img
                    src={biz.image}
                    alt={biz.name}
                    style={styles.businessImage}
                    onClick={() => viewBusiness(biz)}
                  />
                  <div style={styles.businessContent}>
                    <div style={styles.businessHeader}>
                      <h3
                        style={styles.businessName}
                        onClick={() => viewBusiness(biz)}
                      >
                        {biz.name}
                      </h3>
                      <button
                        onClick={() => toggleFavorite(biz.id)}
                        style={styles.favoriteBtn}
                      >
                        {favorites.includes(biz.id) ? "❤️" : "🤍"}
                      </button>
                    </div>
                    
                    <div style={styles.businessMeta}>
                      <span style={styles.category}>{biz.category}</span>
                      <span style={styles.rating}>⭐ {biz.rating}</span>
                      <span style={styles.reviews}>({biz.reviewCount} reviews)</span>
                      {biz.deal && <span style={styles.dealBadge}>Deal</span>}
                    </div>

                    <p style={styles.description}>{biz.description}</p>

                    {biz.deal && (
                      <div style={styles.deal}>
                        🎁 {biz.deal}
                      </div>
                    )}

                    <button
                      onClick={() => viewBusiness(biz)}
                      style={styles.viewButton}
                    >
                      View Details →
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Business Detail View */}
      {view === "business" && selectedBusiness && (
        <div style={styles.content}>
          <button onClick={() => setView("home")} style={styles.backButton}>
            ← Back to Browse
          </button>

          {detailLoading && (
            <div style={styles.detailLoading}>Loading business details...</div>
          )}

          <div style={styles.detailCard}>
            <img
              src={selectedBusiness.image}
              alt={selectedBusiness.name}
              style={styles.detailImage}
            />
            
            <div style={styles.detailContent}>
              <div style={styles.detailHeader}>
                <div>
                  <h2 style={styles.detailTitle}>{selectedBusiness.name}</h2>
                  <div style={styles.detailMeta}>
                    <span style={styles.category}>{selectedBusiness.category}</span>
                    <span style={styles.priceRange}>{selectedBusiness.priceRange}</span>
                  </div>
                </div>
                <button
                  onClick={() => toggleFavorite(selectedBusiness.id)}
                  style={styles.favoriteBtnLarge}
                >
                  {favorites.includes(selectedBusiness.id) ? "❤️" : "🤍"}
                </button>
              </div>

              <div style={styles.ratingSection}>
                <div style={styles.bigRating}>⭐ {selectedBusiness.rating}</div>
                <div style={styles.reviewCount}>
                  {selectedBusiness.reviewCount} reviews
                </div>
              </div>

              <p style={styles.detailDescription}>{selectedBusiness.description}</p>

              {selectedBusiness.deal && (
                <div style={styles.dealLarge}>
                  🎁 <strong>Special Offer:</strong> {selectedBusiness.deal}
                </div>
              )}

              <div style={styles.infoGrid}>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>📍 Address</div>
                  <div style={styles.infoValue}>{selectedBusiness.address}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>📞 Phone</div>
                  <div style={styles.infoValue}>{selectedBusiness.phone}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>🕐 Hours</div>
                  <div style={styles.infoValue}>
                    {selectedBusiness.hours}
                    {selectedBusiness.isOpenNow !== undefined && (
                      <span style={selectedBusiness.isOpenNow ? styles.openNow : styles.closedNow}>
                        {selectedBusiness.isOpenNow ? ' • Open Now' : ' • Closed'}
                      </span>
                    )}
                  </div>
                </div>
                {selectedBusiness.website && (
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>🌐 Website</div>
                    <div style={styles.infoValue}>
                      <a
                        href={selectedBusiness.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        Visit Website
                      </a>
                    </div>
                  </div>
                )}
                {selectedBusiness.googleMapsUrl && (
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>🗺️ Directions</div>
                    <div style={styles.infoValue}>
                      <a
                        href={selectedBusiness.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                )}
              </div>

              <div style={styles.tags}>
                {selectedBusiness.tags.map(tag => (
                  <span key={tag} style={styles.tag}>{tag}</span>
                ))}
              </div>

              {/* Reviews Section */}
              <div style={styles.reviewsSection}>
                <div style={styles.reviewsHeader}>
                  <h3 style={styles.reviewsTitle}>Customer Reviews</h3>
                  {!showReviewForm && (
                    <button onClick={startReview} style={styles.writeReviewBtn}>
                      Write a Review
                    </button>
                  )}
                </div>

                {showReviewForm && verificationChallenge && (
                  <form onSubmit={submitReview} style={styles.reviewForm}>
                    <h4 style={styles.formTitle}>Write Your Review</h4>
                    
                    <input
                      type="text"
                      placeholder="Your name"
                      value={reviewForm.author}
                      onChange={e => setReviewForm(prev => ({ ...prev, author: e.target.value }))}
                      style={styles.input}
                      required
                    />

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Rating: {reviewForm.rating} ⭐</label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        value={reviewForm.rating}
                        onChange={e => setReviewForm(prev => ({ ...prev, rating: parseInt(e.target.value) }))}
                        style={styles.slider}
                      />
                    </div>

                    <textarea
                      placeholder="Share your experience (min 10 characters)..."
                      value={reviewForm.comment}
                      onChange={e => setReviewForm(prev => ({ ...prev, comment: e.target.value }))}
                      style={styles.textarea}
                      rows={4}
                      required
                    />

                    <div style={styles.verification}>
                      <label style={styles.label}>
                        Verification (anti-spam): {verificationChallenge.question}
                      </label>
                      <input
                        type="number"
                        placeholder="Answer"
                        value={reviewForm.verificationAnswer}
                        onChange={e => setReviewForm(prev => ({ ...prev, verificationAnswer: e.target.value }))}
                        style={styles.input}
                        required
                      />
                    </div>

                    <div style={styles.formButtons}>
                      <button type="submit" style={styles.submitBtn}>
                        Submit Review
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReviewForm(false)}
                        style={styles.cancelBtn}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {selectedBusiness.reviews.length === 0 ? (
                  <p style={styles.noReviews}>No reviews yet. Be the first to review!</p>
                ) : (
                  <div style={styles.reviewsList}>
                    {selectedBusiness.reviews.map(review => (
                      <div key={review.id} style={styles.reviewItem}>
                        <div style={styles.reviewHeader}>
                          <strong style={styles.reviewAuthor}>{review.author}</strong>
                          <div style={styles.reviewRating}>
                            {"⭐".repeat(review.rating)}
                          </div>
                        </div>
                        <p style={styles.reviewComment}>{review.comment}</p>
                        <div style={styles.reviewDate}>
                          {new Date(review.date).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Favorites View */}
      {view === "favorites" && (
        <div style={styles.content}>
          <h2 style={styles.pageTitle}>Your Favorite Businesses</h2>
          
          {favorites.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyText}>You haven't saved any favorites yet.</p>
              <button onClick={() => setView("home")} style={styles.browseBtn}>
                Browse Businesses
              </button>
            </div>
          ) : (
            <div style={styles.businessGrid}>
              {businesses
                .filter(b => favorites.includes(b.id))
                .map(biz => (
                  <div key={biz.id} style={styles.businessCard}>
                    <img
                      src={biz.image}
                      alt={biz.name}
                      style={styles.businessImage}
                      onClick={() => viewBusiness(biz)}
                    />
                    <div style={styles.businessContent}>
                      <div style={styles.businessHeader}>
                        <h3
                          style={styles.businessName}
                          onClick={() => viewBusiness(biz)}
                        >
                          {biz.name}
                        </h3>
                        <button
                          onClick={() => toggleFavorite(biz.id)}
                          style={styles.favoriteBtn}
                        >
                          ❤️
                        </button>
                      </div>
                      
                      <div style={styles.businessMeta}>
                        <span style={styles.category}>{biz.category}</span>
                        <span style={styles.rating}>⭐ {biz.rating}</span>
                      </div>

                      <p style={styles.description}>{biz.description}</p>

                      <button
                        onClick={() => viewBusiness(biz)}
                        style={styles.viewButton}
                      >
                        View Details →
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>
          LocalLink - Supporting local businesses since 2024 | 
          Made for FBLA Byte-Sized Business Boost
        </p>
      </footer>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#f8f9fa",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  loading: {
    textAlign: "center",
    padding: "4rem",
    fontSize: "1.5rem",
    color: "#666"
  },
  header: {
    backgroundColor: "#fff",
    borderBottom: "2px solid #e9ecef",
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
  },
  headerContent: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "1rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  logo: {
    fontSize: "1.8rem",
    fontWeight: "bold",
    color: "#2c3e50",
    margin: 0,
    cursor: "pointer",
    transition: "color 0.2s"
  },
  nav: {
    display: "flex",
    gap: "1rem"
  },
  navButton: {
    padding: "0.5rem 1.5rem",
    border: "none",
    background: "transparent",
    color: "#666",
    fontSize: "1rem",
    cursor: "pointer",
    borderRadius: "8px",
    transition: "all 0.2s",
    fontWeight: "500"
  },
  navButtonActive: {
    padding: "0.5rem 1.5rem",
    border: "none",
    background: "#3498db",
    color: "#fff",
    fontSize: "1rem",
    cursor: "pointer",
    borderRadius: "8px",
    fontWeight: "500"
  },
  content: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "2rem"
  },
  hero: {
    textAlign: "center",
    padding: "3rem 2rem",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    borderRadius: "16px",
    marginBottom: "2rem",
    color: "#fff"
  },
  heroTitle: {
    fontSize: "2.5rem",
    fontWeight: "bold",
    margin: "0 0 1rem 0"
  },
  heroSubtitle: {
    fontSize: "1.2rem",
    opacity: 0.95,
    margin: 0
  },
  heroActions: {
    display: "flex",
    justifyContent: "center",
    gap: "1rem",
    marginTop: "2rem",
    flexWrap: "wrap"
  },
  heroPrimary: {
    padding: "0.85rem 1.75rem",
    backgroundColor: "#ffffff",
    color: "#5a67d8",
    border: "none",
    borderRadius: "999px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer"
  },
  heroSecondary: {
    padding: "0.85rem 1.75rem",
    backgroundColor: "transparent",
    color: "#ffffff",
    border: "2px solid rgba(255,255,255,0.7)",
    borderRadius: "999px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer"
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1rem",
    marginBottom: "2rem"
  },
  statCard: {
    backgroundColor: "#fff",
    padding: "1.5rem",
    borderRadius: "12px",
    textAlign: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
  },
  statNumber: {
    fontSize: "2rem",
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: "0.5rem"
  },
  statLabel: {
    fontSize: "0.9rem",
    color: "#666"
  },
  section: {
    marginBottom: "3rem"
  },
  sectionTitle: {
    fontSize: "1.8rem",
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: "1rem"
  },
  sectionSubtitle: {
    marginTop: "-0.5rem",
    marginBottom: "1.5rem",
    color: "#5f6c7b"
  },
  trendingGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "1rem"
  },
  trendingCard: {
    backgroundColor: "#fff",
    borderRadius: "12px",
    overflow: "hidden",
    cursor: "pointer",
    transition: "transform 0.2s, box-shadow 0.2s",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
  },
  trendingImage: {
    width: "100%",
    height: "200px",
    objectFit: "cover"
  },
  trendingContent: {
    padding: "1rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  trendingName: {
    fontSize: "1.2rem",
    fontWeight: "600",
    margin: 0,
    color: "#2c3e50"
  },
  recommendGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "1rem"
  },
  recommendCard: {
    backgroundColor: "#fff",
    borderRadius: "12px",
    overflow: "hidden",
    cursor: "pointer",
    transition: "transform 0.2s",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
  },
  cardImage: {
    width: "100%",
    height: "150px",
    objectFit: "cover"
  },
  cardContent: {
    padding: "1rem"
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem"
  },
  cardTitle: {
    fontSize: "1.1rem",
    fontWeight: "600",
    margin: "0 0 0.5rem 0",
    color: "#2c3e50"
  },
  localBadge: {
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
    fontSize: "0.7rem",
    fontWeight: "600",
    padding: "0.25rem 0.5rem",
    borderRadius: "999px",
    whiteSpace: "nowrap"
  },
  cardRating: {
    fontSize: "0.9rem",
    color: "#f39c12",
    marginBottom: "0.25rem"
  },
  cardCategory: {
    fontSize: "0.85rem",
    color: "#666",
    margin: 0
  },
  dealPill: {
    marginTop: "0.75rem",
    backgroundColor: "#fff3cd",
    color: "#856404",
    borderRadius: "999px",
    padding: "0.35rem 0.75rem",
    fontSize: "0.75rem",
    display: "inline-flex",
    alignItems: "center"
  },
  insightsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "1.5rem"
  },
  insightCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "1.5rem",
    boxShadow: "0 2px 10px rgba(0,0,0,0.08)"
  },
  insightTitle: {
    fontSize: "1.1rem",
    fontWeight: "700",
    color: "#2c3e50",
    margin: "0 0 1rem 0"
  },
  insightList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem"
  },
  insightItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#4a5568",
    fontSize: "0.95rem"
  },
  insightValue: {
    fontWeight: "600",
    color: "#2c3e50"
  },
  insightBody: {
    margin: 0,
    color: "#4a5568",
    lineHeight: "1.6",
    marginBottom: "1rem"
  },
  insightTags: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap"
  },
  insightTag: {
    border: "1px solid #e2e8f0",
    padding: "0.4rem 0.75rem",
    borderRadius: "999px",
    backgroundColor: "#f8fafc",
    color: "#2c3e50",
    fontSize: "0.85rem",
    cursor: "pointer"
  },
  filtersSection: {
    marginBottom: "2rem"
  },
  filters: {
    display: "flex",
    gap: "1rem",
    flexWrap: "wrap",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: "1.5rem",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
  },
  searchInput: {
    flex: "1 1 300px",
    padding: "0.75rem 1rem",
    border: "2px solid #e9ecef",
    borderRadius: "8px",
    fontSize: "1rem",
    outline: "none",
    transition: "border-color 0.2s"
  },
  select: {
    padding: "0.75rem 1rem",
    border: "2px solid #e9ecef",
    borderRadius: "8px",
    fontSize: "1rem",
    backgroundColor: "#fff",
    cursor: "pointer",
    outline: "none"
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    cursor: "pointer"
  },
  checkboxLabel: {
    fontSize: "1rem",
    color: "#2c3e50"
  },
  businessGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: "1.5rem"
  },
  businessCard: {
    backgroundColor: "#fff",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    transition: "transform 0.2s, box-shadow 0.2s"
  },
  businessImage: {
    width: "100%",
    height: "200px",
    objectFit: "cover",
    cursor: "pointer"
  },
  businessContent: {
    padding: "1.5rem"
  },
  businessHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    marginBottom: "0.75rem"
  },
  businessName: {
    fontSize: "1.4rem",
    fontWeight: "600",
    margin: 0,
    color: "#2c3e50",
    cursor: "pointer",
    transition: "color 0.2s"
  },
  favoriteBtn: {
    fontSize: "1.5rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "0.25rem",
    transition: "transform 0.2s"
  },
  businessMeta: {
    display: "flex",
    gap: "1rem",
    alignItems: "center",
    marginBottom: "0.75rem",
    flexWrap: "wrap"
  },
  category: {
    padding: "0.25rem 0.75rem",
    backgroundColor: "#e3f2fd",
    color: "#1976d2",
    borderRadius: "6px",
    fontSize: "0.85rem",
    fontWeight: "500"
  },
  rating: {
    fontSize: "0.95rem",
    color: "#f39c12",
    fontWeight: "500"
  },
  reviews: {
    fontSize: "0.85rem",
    color: "#666"
  },
  dealBadge: {
    backgroundColor: "#fff3cd",
    color: "#856404",
    borderRadius: "999px",
    padding: "0.2rem 0.6rem",
    fontSize: "0.75rem",
    fontWeight: "600"
  },
  description: {
    fontSize: "0.95rem",
    color: "#555",
    lineHeight: "1.5",
    marginBottom: "1rem"
  },
  deal: {
    backgroundColor: "#fff3cd",
    border: "1px solid #ffc107",
    padding: "0.75rem",
    borderRadius: "8px",
    fontSize: "0.9rem",
    color: "#856404",
    marginBottom: "1rem"
  },
  viewButton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: "#3498db",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  noResults: {
    gridColumn: "1 / -1",
    textAlign: "center",
    padding: "3rem",
    color: "#666",
    fontSize: "1.1rem"
  },
  backButton: {
    padding: "0.75rem 1.5rem",
    backgroundColor: "#6c757d",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    cursor: "pointer",
    marginBottom: "2rem",
    transition: "background-color 0.2s"
  },
  detailLoading: {
    padding: "1rem 1.5rem",
    backgroundColor: "#fff",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    marginBottom: "1.5rem",
    color: "#4a5568",
    fontWeight: "500"
  },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(0,0,0,0.1)"
  },
  detailImage: {
    width: "100%",
    height: "400px",
    objectFit: "cover"
  },
  detailContent: {
    padding: "2rem"
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    marginBottom: "1.5rem"
  },
  detailTitle: {
    fontSize: "2.5rem",
    fontWeight: "bold",
    margin: "0 0 0.5rem 0",
    color: "#2c3e50"
  },
  detailMeta: {
    display: "flex",
    gap: "1rem"
  },
  priceRange: {
    padding: "0.25rem 0.75rem",
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
    borderRadius: "6px",
    fontSize: "0.85rem",
    fontWeight: "500"
  },
  favoriteBtnLarge: {
    fontSize: "2rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "0.5rem"
  },
  ratingSection: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1.5rem"
  },
  bigRating: {
    fontSize: "2.5rem",
    fontWeight: "bold",
    color: "#f39c12"
  },
  reviewCount: {
    fontSize: "1.1rem",
    color: "#666"
  },
  detailDescription: {
    fontSize: "1.1rem",
    color: "#555",
    lineHeight: "1.7",
    marginBottom: "1.5rem"
  },
  dealLarge: {
    backgroundColor: "#fff3cd",
    border: "2px solid #ffc107",
    padding: "1.25rem",
    borderRadius: "12px",
    fontSize: "1.1rem",
    color: "#856404",
    marginBottom: "2rem"
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "1.5rem",
    marginBottom: "2rem"
  },
  infoItem: {
    padding: "1rem",
    backgroundColor: "#f8f9fa",
    borderRadius: "8px"
  },
  infoLabel: {
    fontSize: "0.9rem",
    color: "#666",
    marginBottom: "0.5rem",
    fontWeight: "500"
  },
  infoValue: {
    fontSize: "1rem",
    color: "#2c3e50"
  },
  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginBottom: "2rem"
  },
  tag: {
    padding: "0.5rem 1rem",
    backgroundColor: "#e9ecef",
    color: "#495057",
    borderRadius: "20px",
    fontSize: "0.85rem",
    fontWeight: "500"
  },
  reviewsSection: {
    borderTop: "2px solid #e9ecef",
    paddingTop: "2rem"
  },
  reviewsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1.5rem"
  },
  reviewsTitle: {
    fontSize: "1.8rem",
    fontWeight: "bold",
    color: "#2c3e50",
    margin: 0
  },
  writeReviewBtn: {
    padding: "0.75rem 1.5rem",
    backgroundColor: "#28a745",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  reviewForm: {
    backgroundColor: "#f8f9fa",
    padding: "2rem",
    borderRadius: "12px",
    marginBottom: "2rem"
  },
  formTitle: {
    fontSize: "1.3rem",
    fontWeight: "600",
    marginBottom: "1.5rem",
    color: "#2c3e50"
  },
  formGroup: {
    marginBottom: "1.5rem"
  },
  label: {
    display: "block",
    fontSize: "1rem",
    fontWeight: "500",
    marginBottom: "0.5rem",
    color: "#2c3e50"
  },
  input: {
    width: "100%",
    padding: "0.75rem",
    border: "2px solid #e9ecef",
    borderRadius: "8px",
    fontSize: "1rem",
    outline: "none",
    marginBottom: "1rem",
    boxSizing: "border-box"
  },
  slider: {
    width: "100%",
    height: "8px",
    borderRadius: "4px",
    outline: "none"
  },
  textarea: {
    width: "100%",
    padding: "0.75rem",
    border: "2px solid #e9ecef",
    borderRadius: "8px",
    fontSize: "1rem",
    outline: "none",
    marginBottom: "1rem",
    fontFamily: "inherit",
    resize: "vertical",
    boxSizing: "border-box"
  },
  verification: {
    backgroundColor: "#fff",
    padding: "1rem",
    borderRadius: "8px",
    marginBottom: "1rem"
  },
  formButtons: {
    display: "flex",
    gap: "1rem"
  },
  submitBtn: {
    padding: "0.75rem 2rem",
    backgroundColor: "#28a745",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  cancelBtn: {
    padding: "0.75rem 2rem",
    backgroundColor: "#6c757d",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  noReviews: {
    textAlign: "center",
    padding: "2rem",
    color: "#666",
    fontSize: "1.1rem"
  },
  reviewsList: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem"
  },
  reviewItem: {
    padding: "1.5rem",
    backgroundColor: "#f8f9fa",
    borderRadius: "12px"
  },
  reviewHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.75rem"
  },
  reviewAuthor: {
    fontSize: "1.1rem",
    color: "#2c3e50"
  },
  reviewRating: {
    fontSize: "1rem",
    color: "#f39c12"
  },
  reviewComment: {
    fontSize: "1rem",
    color: "#555",
    lineHeight: "1.6",
    marginBottom: "0.75rem"
  },
  reviewDate: {
    fontSize: "0.85rem",
    color: "#999"
  },
  pageTitle: {
    fontSize: "2.5rem",
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: "2rem"
  },
  emptyState: {
    textAlign: "center",
    padding: "4rem 2rem",
    backgroundColor: "#fff",
    borderRadius: "16px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
  },
  emptyText: {
    fontSize: "1.2rem",
    color: "#666",
    marginBottom: "2rem"
  },
  browseBtn: {
    padding: "1rem 2rem",
    backgroundColor: "#3498db",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "1.1rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  locationPicker: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "1rem",
    backgroundColor: "#fff",
    borderRadius: "8px",
    marginBottom: "1rem",
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
  },
  locationLabel: {
    fontSize: "1rem",
    fontWeight: "500",
    color: "#2c3e50"
  },
  locationSelect: {
    padding: "0.5rem 1rem",
    border: "2px solid #e9ecef",
    borderRadius: "8px",
    fontSize: "1rem",
    cursor: "pointer",
    backgroundColor: "#fff",
    flex: 1,
    maxWidth: "300px"
  },
  openNow: {
    color: "#27ae60",
    fontWeight: "600"
  },
  closedNow: {
    color: "#e74c3c",
    fontWeight: "600"
  },
  link: {
    color: "#3498db",
    textDecoration: "none",
    fontWeight: "500",
    transition: "color 0.2s"
  },
  footer: {
    backgroundColor: "#2c3e50",
    color: "#fff",
    padding: "2rem",
    textAlign: "center",
    marginTop: "4rem"
  },
  footerText: {
    margin: 0,
    fontSize: "0.95rem",
    opacity: 0.9
  }
};

export default App;
