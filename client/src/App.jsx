import { useEffect, useState, useRef } from "react";

const API_URL = "http://localhost:3001/api";

// FBLA Brand Colors
const COLORS = {
  navyBlue: "#1e3a8a",
  darkBlue: "#1e40af",
  gold: "#f59e0b",
  lightGold: "#fbbf24",
  white: "#ffffff",
  lightGray: "#f3f4f6",
  darkGray: "#6b7280",
  textDark: "#1f2937"
};

function App() {
  const [view, setView] = useState("home");
  const [businesses, setBusinesses] = useState([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [trending, setTrending] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  const [category, setCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [minRating, setMinRating] = useState("");
  const [showDealsOnly, setShowDealsOnly] = useState(false);
  const [sortBy, setSortBy] = useState("local");

  const [reviewForm, setReviewForm] = useState({
    author: "",
    rating: 5,
    comment: "",
    verificationId: "",
    verificationAnswer: ""
  });
  const [verificationChallenge, setVerificationChallenge] = useState(null);
  const [showReviewForm, setShowReviewForm] = useState(false);

  const contentRef = useRef(null);

  // Parallax scroll effect
  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Load favorites from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("locallink_favorites");
    if (saved) {
      setFavorites(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("locallink_favorites", JSON.stringify(favorites));
  }, [favorites]);

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

  const deduplicateChains = (businesses) => {
    if (searchTerm.trim()) {
      return businesses;
    }

    const seen = new Set();
    const deduped = [];

    for (const biz of businesses) {
      if (biz.isChain) {
        const baseName = biz.name.split(/[#\d]/)[0].trim().toLowerCase();
        if (!seen.has(baseName)) {
          seen.add(baseName);
          deduped.push(biz);
        }
      } else {
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

      const updatedBiz = await fetch(`${API_URL}/businesses/${selectedBusiness.id}`).then(r => r.json());
      setSelectedBusiness(updatedBiz);
    } catch (err) {
      alert("Failed to submit review. Please try again.");
    }
  };

  const scrollToContent = () => {
    contentRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.spinner}></div>
          <p>Loading LocalLink...</p>
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
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.logo} onClick={() => setView("home")}>
            <span style={styles.logoIcon}>◆</span>
            <span>LocalLink</span>
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
              Favorites
              <span style={styles.badge}>{favorites.length}</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Home View */}
      {view === "home" && (
        <div style={styles.content}>
          {/* Hero Section with Parallax */}
          <div style={{
            ...styles.hero,
            transform: `translateY(${scrollY * 0.5}px)`,
          }}>
            <div style={styles.heroOverlay}>
              <h2 style={styles.heroTitle}>Discover & Support Local Businesses</h2>
              <p style={styles.heroSubtitle}>
                Connecting you with the best of Cumming, Georgia
              </p>

              {/* Scroll Down Arrow */}
              <div style={styles.scrollDown} onClick={scrollToContent}>
                <svg style={styles.scrollArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span style={styles.scrollText}>Explore</span>
              </div>
            </div>
          </div>

          <div ref={contentRef}>
            {/* Statistics Cards */}
            {analytics && (
              <div style={styles.statsGrid}>
                <div style={styles.statCard}>
                  <div style={styles.statIcon}>🏪</div>
                  <div style={styles.statNumber}>{totalBusinessesCount}</div>
                  <div style={styles.statLabel}>Local Businesses</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statIcon}>⭐</div>
                  <div style={styles.statNumber}>{analytics.totalUserReviews || 0}</div>
                  <div style={styles.statLabel}>Community Reviews</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statIcon}>🎁</div>
                  <div style={styles.statNumber}>{analytics.dealsAvailable}</div>
                  <div style={styles.statLabel}>Active Deals</div>
                </div>
              </div>
            )}

            {/* Trending Section */}
            {trending.length > 0 && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>
                  <span style={styles.titleAccent}></span>
                  Trending Now
                </h3>
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
                        {biz.rating > 0 ? (
                          <div style={styles.rating}>★ {biz.rating.toFixed(1)}</div>
                        ) : (
                          <div style={styles.noRating}>No ratings yet</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Local Gems */}
            {localGems.length > 0 && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>
                  <span style={styles.titleAccent}></span>
                  Local Favorites
                </h3>
                <p style={styles.sectionSubtitle}>
                  Handpicked spots with outstanding ratings and community impact
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
                          <span style={styles.localBadge}>Local</span>
                        </div>
                        {biz.rating > 0 ? (
                          <div style={styles.cardRating}>★ {biz.rating.toFixed(1)}</div>
                        ) : (
                          <div style={styles.noRating}>No ratings yet</div>
                        )}
                        <p style={styles.cardCategory}>{biz.category}</p>
                        {biz.deal && (
                          <div style={styles.dealPill}>{biz.deal}</div>
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
                <h3 style={styles.sectionTitle}>
                  <span style={styles.titleAccent}></span>
                  Recommended For You
                </h3>
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
                        {biz.rating > 0 ? (
                          <div style={styles.cardRating}>★ {biz.rating.toFixed(1)}</div>
                        ) : (
                          <div style={styles.noRating}>No ratings yet</div>
                        )}
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
                <h3 style={styles.sectionTitle}>
                  <span style={styles.titleAccent}></span>
                  Community Insights
                </h3>
                <div style={styles.insightsGrid}>
                  <div style={styles.insightCard}>
                    <h4 style={styles.insightTitle}>Popular Categories</h4>
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
                          <span style={styles.insightValue}>★ {item.rating}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div style={styles.insightCard}>
                    <h4 style={styles.insightTitle}>Quick Filters</h4>
                    <p style={styles.insightBody}>
                      Filter by category or deals to find the perfect spot
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
              <h3 style={styles.sectionTitle}>
                <span style={styles.titleAccent}></span>
                Browse All Businesses
              </h3>
              <p style={styles.sectionSubtitle}>
                Showing {filteredBusinesses.length} of {totalBusinessesCount} businesses
              </p>

              <div style={styles.filters}>
                <input
                  type="text"
                  placeholder="Search businesses, tags, or categories..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={styles.searchInput}
                />

                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  style={styles.select}
                >
                  <option value="All">All Categories</option>
                  <option value="Food">Food ({totalCategoryCounts.Food || 0})</option>
                  <option value="Retail">Retail ({totalCategoryCounts.Retail || 0})</option>
                  <option value="Services">Services ({totalCategoryCounts.Services || 0})</option>
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
                          {favorites.includes(biz.id) ? "❤" : "♡"}
                        </button>
                      </div>

                      <div style={styles.businessMeta}>
                        <span style={styles.category}>{biz.category}</span>
                        {biz.rating > 0 ? (
                          <span style={styles.rating}>★ {biz.rating.toFixed(1)}</span>
                        ) : (
                          <span style={styles.noRating}>No ratings yet</span>
                        )}
                        <span style={styles.reviews}>
                          {biz.reviewCount > 0 ? `${biz.reviewCount} reviews` : "No reviews yet"}
                        </span>
                        {biz.deal && <span style={styles.dealBadge}>Deal</span>}
                      </div>

                      <p style={styles.description}>{biz.description}</p>

                      {biz.deal && (
                        <div style={styles.deal}>
                          {biz.deal}
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
        </div>
      )}

      {/* Business Detail View */}
      {view === "business" && selectedBusiness && (
        <div style={styles.content}>
          <button onClick={() => setView("home")} style={styles.backButton}>
            ← Back to Browse
          </button>

          {detailLoading && (
            <div style={styles.detailLoading}>
              <div style={styles.spinner}></div>
              Loading details...
            </div>
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
                  {favorites.includes(selectedBusiness.id) ? "❤" : "♡"}
                </button>
              </div>

              <div style={styles.ratingSection}>
                {selectedBusiness.rating > 0 ? (
                  <div style={styles.bigRating}>★ {selectedBusiness.rating.toFixed(1)}</div>
                ) : (
                  <div style={styles.noRating}>No ratings yet</div>
                )}
                <div style={styles.reviewCount}>
                  {selectedBusiness.reviewCount > 0
                    ? `${selectedBusiness.reviewCount} reviews`
                    : "No reviews yet"}
                </div>
              </div>

              <p style={styles.detailDescription}>{selectedBusiness.description}</p>

              {selectedBusiness.deal && (
                <div style={styles.dealLarge}>
                  <strong>Special Offer:</strong> {selectedBusiness.deal}
                </div>
              )}

              <div style={styles.infoGrid}>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Address</div>
                  <div style={styles.infoValue}>{selectedBusiness.address}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Phone</div>
                  <div style={styles.infoValue}>{selectedBusiness.phone}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Hours</div>
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
                    <div style={styles.infoLabel}>Website</div>
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
                    <div style={styles.infoLabel}>Directions</div>
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
                      <label style={styles.label}>Rating: {reviewForm.rating} ★</label>
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
                        Verification: {verificationChallenge.question}
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
                            {"★".repeat(review.rating)}
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
                          ❤
                        </button>
                      </div>

                      <div style={styles.businessMeta}>
                        <span style={styles.category}>{biz.category}</span>
                        {biz.rating > 0 ? (
                          <span style={styles.rating}>★ {biz.rating.toFixed(1)}</span>
                        ) : (
                          <span style={styles.noRating}>No ratings yet</span>
                        )}
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
          LocalLink - Supporting local businesses | Made for FBLA Byte-Sized Business Boost
        </p>
      </footer>

      {/* Add keyframes for animations in a style tag */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        .card-hover:hover {
          transform: translateY(-8px) scale(1.02);
          box-shadow: 0 12px 24px rgba(30, 58, 138, 0.2);
        }

        .button-hover:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    backgroundColor: COLORS.lightGray,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  },
  loading: {
    textAlign: "center",
    padding: "4rem",
    fontSize: "1.2rem",
    color: COLORS.darkGray,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.5rem"
  },
  spinner: {
    width: "48px",
    height: "48px",
    border: `4px solid ${COLORS.lightGray}`,
    borderTop: `4px solid ${COLORS.navyBlue}`,
    borderRadius: "50%",
    animation: "spin 1s linear infinite"
  },
  header: {
    backgroundColor: COLORS.navyBlue,
    borderBottom: `3px solid ${COLORS.gold}`,
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
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
    color: COLORS.white,
    margin: 0,
    cursor: "pointer",
    transition: "transform 0.2s",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem"
  },
  logoIcon: {
    color: COLORS.gold,
    fontSize: "1.4rem"
  },
  nav: {
    display: "flex",
    gap: "1rem"
  },
  navButton: {
    padding: "0.6rem 1.5rem",
    border: "none",
    background: "transparent",
    color: COLORS.white,
    fontSize: "1rem",
    cursor: "pointer",
    borderRadius: "8px",
    transition: "all 0.3s",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem"
  },
  navButtonActive: {
    padding: "0.6rem 1.5rem",
    border: "none",
    background: COLORS.gold,
    color: COLORS.navyBlue,
    fontSize: "1rem",
    cursor: "pointer",
    borderRadius: "8px",
    fontWeight: "600",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    boxShadow: "0 2px 8px rgba(245, 158, 11, 0.3)"
  },
  badge: {
    backgroundColor: COLORS.white,
    color: COLORS.navyBlue,
    borderRadius: "50%",
    width: "22px",
    height: "22px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: "bold"
  },
  content: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "0"
  },
  hero: {
    height: "85vh",
    background: `linear-gradient(135deg, ${COLORS.navyBlue} 0%, ${COLORS.darkBlue} 50%, ${COLORS.navyBlue} 100%)`,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    transition: "transform 0.1s ease-out"
  },
  heroOverlay: {
    position: "relative",
    zIndex: 2,
    textAlign: "center",
    color: COLORS.white,
    padding: "2rem",
    animation: "fadeIn 1s ease-out"
  },
  heroTitle: {
    fontSize: "3.5rem",
    fontWeight: "bold",
    margin: "0 0 1rem 0",
    textShadow: "2px 2px 4px rgba(0,0,0,0.3)",
    letterSpacing: "-0.5px"
  },
  heroSubtitle: {
    fontSize: "1.4rem",
    opacity: 0.95,
    margin: "0 0 3rem 0",
    fontWeight: "300"
  },
  scrollDown: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
    cursor: "pointer",
    animation: "bounce 2s infinite",
    transition: "all 0.3s"
  },
  scrollArrow: {
    width: "48px",
    height: "48px",
    color: COLORS.gold,
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
  },
  scrollText: {
    fontSize: "0.9rem",
    fontWeight: "600",
    color: COLORS.gold,
    textTransform: "uppercase",
    letterSpacing: "1px"
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "2rem",
    padding: "3rem 2rem",
    animation: "fadeIn 0.8s ease-out"
  },
  statCard: {
    backgroundColor: COLORS.white,
    padding: "2rem",
    borderRadius: "16px",
    textAlign: "center",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    transition: "all 0.3s",
    border: `2px solid transparent`,
    className: "card-hover"
  },
  statIcon: {
    fontSize: "2.5rem",
    marginBottom: "1rem"
  },
  statNumber: {
    fontSize: "2.5rem",
    fontWeight: "bold",
    color: COLORS.navyBlue,
    marginBottom: "0.5rem"
  },
  statLabel: {
    fontSize: "1rem",
    color: COLORS.darkGray,
    fontWeight: "500"
  },
  section: {
    padding: "3rem 2rem",
    animation: "fadeIn 0.8s ease-out"
  },
  sectionTitle: {
    fontSize: "2rem",
    fontWeight: "bold",
    color: COLORS.navyBlue,
    marginBottom: "0.5rem",
    display: "flex",
    alignItems: "center",
    gap: "1rem"
  },
  titleAccent: {
    width: "4px",
    height: "32px",
    backgroundColor: COLORS.gold,
    borderRadius: "2px"
  },
  sectionSubtitle: {
    marginTop: "0.5rem",
    marginBottom: "2rem",
    color: COLORS.darkGray,
    fontSize: "1.1rem"
  },
  trendingGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "2rem"
  },
  trendingCard: {
    backgroundColor: COLORS.white,
    borderRadius: "16px",
    overflow: "hidden",
    cursor: "pointer",
    transition: "all 0.3s",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    className: "card-hover"
  },
  trendingImage: {
    width: "100%",
    height: "220px",
    objectFit: "cover",
    transition: "transform 0.3s"
  },
  trendingContent: {
    padding: "1.5rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  trendingName: {
    fontSize: "1.3rem",
    fontWeight: "600",
    margin: 0,
    color: COLORS.navyBlue
  },
  recommendGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "2rem"
  },
  recommendCard: {
    backgroundColor: COLORS.white,
    borderRadius: "16px",
    overflow: "hidden",
    cursor: "pointer",
    transition: "all 0.3s",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    className: "card-hover"
  },
  cardImage: {
    width: "100%",
    height: "180px",
    objectFit: "cover",
    transition: "transform 0.3s"
  },
  cardContent: {
    padding: "1.5rem"
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    marginBottom: "0.75rem"
  },
  cardTitle: {
    fontSize: "1.2rem",
    fontWeight: "600",
    margin: 0,
    color: COLORS.navyBlue
  },
  localBadge: {
    backgroundColor: COLORS.gold,
    color: COLORS.white,
    fontSize: "0.7rem",
    fontWeight: "600",
    padding: "0.3rem 0.6rem",
    borderRadius: "12px",
    whiteSpace: "nowrap"
  },
  cardRating: {
    fontSize: "1rem",
    color: COLORS.gold,
    marginBottom: "0.5rem",
    fontWeight: "600"
  },
  noRating: {
    fontSize: "0.9rem",
    color: COLORS.darkGray,
    fontWeight: "500"
  },
  cardCategory: {
    fontSize: "0.9rem",
    color: COLORS.darkGray,
    margin: 0
  },
  dealPill: {
    marginTop: "1rem",
    backgroundColor: "#fef3c7",
    color: "#92400e",
    borderRadius: "12px",
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    display: "inline-block"
  },
  insightsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "2rem"
  },
  insightCard: {
    backgroundColor: COLORS.white,
    borderRadius: "16px",
    padding: "2rem",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    transition: "all 0.3s",
    className: "card-hover"
  },
  insightTitle: {
    fontSize: "1.2rem",
    fontWeight: "700",
    color: COLORS.navyBlue,
    margin: "0 0 1.5rem 0"
  },
  insightList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1rem"
  },
  insightItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: COLORS.textDark,
    fontSize: "1rem"
  },
  insightValue: {
    fontWeight: "600",
    color: COLORS.navyBlue
  },
  insightBody: {
    margin: "0 0 1.5rem 0",
    color: COLORS.darkGray,
    lineHeight: "1.6"
  },
  insightTags: {
    display: "flex",
    gap: "0.75rem",
    flexWrap: "wrap"
  },
  insightTag: {
    border: `2px solid ${COLORS.navyBlue}`,
    padding: "0.5rem 1rem",
    borderRadius: "20px",
    backgroundColor: COLORS.white,
    color: COLORS.navyBlue,
    fontSize: "0.9rem",
    cursor: "pointer",
    transition: "all 0.3s",
    fontWeight: "500"
  },
  filtersSection: {
    padding: "2rem",
    marginBottom: "2rem"
  },
  filters: {
    display: "flex",
    gap: "1rem",
    flexWrap: "wrap",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: "2rem",
    borderRadius: "16px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)"
  },
  searchInput: {
    flex: "1 1 300px",
    padding: "0.9rem 1.2rem",
    border: `2px solid ${COLORS.lightGray}`,
    borderRadius: "12px",
    fontSize: "1rem",
    outline: "none",
    transition: "all 0.3s"
  },
  select: {
    padding: "0.9rem 1.2rem",
    border: `2px solid ${COLORS.lightGray}`,
    borderRadius: "12px",
    fontSize: "1rem",
    backgroundColor: COLORS.white,
    cursor: "pointer",
    outline: "none",
    transition: "all 0.3s",
    fontWeight: "500"
  },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    cursor: "pointer",
    userSelect: "none"
  },
  checkboxLabel: {
    fontSize: "1rem",
    color: COLORS.navyBlue,
    fontWeight: "500"
  },
  businessGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: "2rem",
    padding: "2rem"
  },
  businessCard: {
    backgroundColor: COLORS.white,
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    transition: "all 0.3s",
    className: "card-hover"
  },
  businessImage: {
    width: "100%",
    height: "220px",
    objectFit: "cover",
    cursor: "pointer",
    transition: "transform 0.3s"
  },
  businessContent: {
    padding: "1.5rem"
  },
  businessHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    marginBottom: "1rem"
  },
  businessName: {
    fontSize: "1.4rem",
    fontWeight: "600",
    margin: 0,
    color: COLORS.navyBlue,
    cursor: "pointer",
    transition: "color 0.3s"
  },
  favoriteBtn: {
    fontSize: "1.8rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "0.25rem",
    transition: "transform 0.3s",
    color: "#ef4444"
  },
  businessMeta: {
    display: "flex",
    gap: "1rem",
    alignItems: "center",
    marginBottom: "1rem",
    flexWrap: "wrap"
  },
  category: {
    padding: "0.4rem 1rem",
    backgroundColor: `${COLORS.navyBlue}15`,
    color: COLORS.navyBlue,
    borderRadius: "12px",
    fontSize: "0.85rem",
    fontWeight: "600"
  },
  rating: {
    fontSize: "1rem",
    color: COLORS.gold,
    fontWeight: "600"
  },
  reviews: {
    fontSize: "0.9rem",
    color: COLORS.darkGray
  },
  dealBadge: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
    borderRadius: "12px",
    padding: "0.3rem 0.8rem",
    fontSize: "0.75rem",
    fontWeight: "600"
  },
  description: {
    fontSize: "1rem",
    color: COLORS.darkGray,
    lineHeight: "1.6",
    marginBottom: "1.5rem"
  },
  deal: {
    backgroundColor: "#fef3c7",
    border: "2px solid #fbbf24",
    padding: "1rem",
    borderRadius: "12px",
    fontSize: "0.95rem",
    color: "#92400e",
    marginBottom: "1.5rem",
    fontWeight: "500"
  },
  viewButton: {
    width: "100%",
    padding: "0.9rem",
    backgroundColor: COLORS.navyBlue,
    color: COLORS.white,
    border: "none",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s",
    className: "button-hover"
  },
  noResults: {
    gridColumn: "1 / -1",
    textAlign: "center",
    padding: "4rem",
    color: COLORS.darkGray,
    fontSize: "1.2rem"
  },
  backButton: {
    padding: "0.9rem 2rem",
    backgroundColor: COLORS.darkGray,
    color: COLORS.white,
    border: "none",
    borderRadius: "12px",
    fontSize: "1rem",
    cursor: "pointer",
    margin: "2rem",
    transition: "all 0.3s",
    fontWeight: "600"
  },
  detailLoading: {
    padding: "2rem",
    backgroundColor: COLORS.white,
    borderRadius: "16px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    margin: "2rem",
    color: COLORS.darkGray,
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    gap: "1rem"
  },
  detailCard: {
    backgroundColor: COLORS.white,
    borderRadius: "20px",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    margin: "2rem"
  },
  detailImage: {
    width: "100%",
    height: "450px",
    objectFit: "cover"
  },
  detailContent: {
    padding: "3rem"
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    marginBottom: "2rem"
  },
  detailTitle: {
    fontSize: "2.8rem",
    fontWeight: "bold",
    margin: "0 0 1rem 0",
    color: COLORS.navyBlue
  },
  detailMeta: {
    display: "flex",
    gap: "1rem"
  },
  priceRange: {
    padding: "0.4rem 1rem",
    backgroundColor: `${COLORS.gold}20`,
    color: COLORS.navyBlue,
    borderRadius: "12px",
    fontSize: "0.9rem",
    fontWeight: "600"
  },
  favoriteBtnLarge: {
    fontSize: "2.5rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "0.5rem",
    transition: "transform 0.3s",
    color: "#ef4444"
  },
  ratingSection: {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
    marginBottom: "2rem",
    padding: "1.5rem",
    backgroundColor: COLORS.lightGray,
    borderRadius: "16px"
  },
  bigRating: {
    fontSize: "3rem",
    fontWeight: "bold",
    color: COLORS.gold
  },
  reviewCount: {
    fontSize: "1.2rem",
    color: COLORS.darkGray
  },
  detailDescription: {
    fontSize: "1.2rem",
    color: COLORS.darkGray,
    lineHeight: "1.8",
    marginBottom: "2rem"
  },
  dealLarge: {
    backgroundColor: "#fef3c7",
    border: "3px solid #fbbf24",
    padding: "1.5rem",
    borderRadius: "16px",
    fontSize: "1.1rem",
    color: "#92400e",
    marginBottom: "2.5rem",
    fontWeight: "500"
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "1.5rem",
    marginBottom: "2.5rem"
  },
  infoItem: {
    padding: "1.5rem",
    backgroundColor: COLORS.lightGray,
    borderRadius: "12px"
  },
  infoLabel: {
    fontSize: "0.9rem",
    color: COLORS.darkGray,
    marginBottom: "0.75rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  },
  infoValue: {
    fontSize: "1.1rem",
    color: COLORS.navyBlue,
    fontWeight: "500"
  },
  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.75rem",
    marginBottom: "2.5rem"
  },
  tag: {
    padding: "0.6rem 1.2rem",
    backgroundColor: COLORS.lightGray,
    color: COLORS.navyBlue,
    borderRadius: "20px",
    fontSize: "0.9rem",
    fontWeight: "500"
  },
  reviewsSection: {
    borderTop: `3px solid ${COLORS.lightGray}`,
    paddingTop: "2.5rem"
  },
  reviewsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "2rem"
  },
  reviewsTitle: {
    fontSize: "2rem",
    fontWeight: "bold",
    color: COLORS.navyBlue,
    margin: 0
  },
  writeReviewBtn: {
    padding: "0.9rem 2rem",
    backgroundColor: COLORS.gold,
    color: COLORS.white,
    border: "none",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s",
    className: "button-hover"
  },
  reviewForm: {
    backgroundColor: COLORS.lightGray,
    padding: "2.5rem",
    borderRadius: "16px",
    marginBottom: "2.5rem"
  },
  formTitle: {
    fontSize: "1.5rem",
    fontWeight: "600",
    marginBottom: "2rem",
    color: COLORS.navyBlue
  },
  formGroup: {
    marginBottom: "2rem"
  },
  label: {
    display: "block",
    fontSize: "1rem",
    fontWeight: "600",
    marginBottom: "0.75rem",
    color: COLORS.navyBlue
  },
  input: {
    width: "100%",
    padding: "1rem",
    border: `2px solid ${COLORS.lightGray}`,
    borderRadius: "12px",
    fontSize: "1rem",
    outline: "none",
    marginBottom: "1.5rem",
    boxSizing: "border-box",
    transition: "all 0.3s"
  },
  slider: {
    width: "100%",
    height: "8px",
    borderRadius: "4px",
    outline: "none",
    cursor: "pointer"
  },
  textarea: {
    width: "100%",
    padding: "1rem",
    border: `2px solid ${COLORS.lightGray}`,
    borderRadius: "12px",
    fontSize: "1rem",
    outline: "none",
    marginBottom: "1.5rem",
    fontFamily: "inherit",
    resize: "vertical",
    boxSizing: "border-box",
    transition: "all 0.3s"
  },
  verification: {
    backgroundColor: COLORS.white,
    padding: "1.5rem",
    borderRadius: "12px",
    marginBottom: "1.5rem"
  },
  formButtons: {
    display: "flex",
    gap: "1rem"
  },
  submitBtn: {
    padding: "1rem 2.5rem",
    backgroundColor: COLORS.gold,
    color: COLORS.white,
    border: "none",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s",
    className: "button-hover"
  },
  cancelBtn: {
    padding: "1rem 2.5rem",
    backgroundColor: COLORS.darkGray,
    color: COLORS.white,
    border: "none",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s"
  },
  noReviews: {
    textAlign: "center",
    padding: "3rem",
    color: COLORS.darkGray,
    fontSize: "1.2rem"
  },
  reviewsList: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem"
  },
  reviewItem: {
    padding: "2rem",
    backgroundColor: COLORS.lightGray,
    borderRadius: "16px",
    transition: "all 0.3s"
  },
  reviewHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem"
  },
  reviewAuthor: {
    fontSize: "1.2rem",
    color: COLORS.navyBlue,
    fontWeight: "600"
  },
  reviewRating: {
    fontSize: "1.1rem",
    color: COLORS.gold
  },
  reviewComment: {
    fontSize: "1.1rem",
    color: COLORS.darkGray,
    lineHeight: "1.7",
    marginBottom: "1rem"
  },
  reviewDate: {
    fontSize: "0.9rem",
    color: COLORS.darkGray
  },
  pageTitle: {
    fontSize: "2.8rem",
    fontWeight: "bold",
    color: COLORS.navyBlue,
    marginBottom: "2rem",
    padding: "2rem 2rem 0"
  },
  emptyState: {
    textAlign: "center",
    padding: "5rem 2rem",
    backgroundColor: COLORS.white,
    borderRadius: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    margin: "2rem"
  },
  emptyText: {
    fontSize: "1.3rem",
    color: COLORS.darkGray,
    marginBottom: "2.5rem"
  },
  browseBtn: {
    padding: "1.2rem 3rem",
    backgroundColor: COLORS.navyBlue,
    color: COLORS.white,
    border: "none",
    borderRadius: "12px",
    fontSize: "1.1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s",
    className: "button-hover"
  },
  openNow: {
    color: "#22c55e",
    fontWeight: "600"
  },
  closedNow: {
    color: "#ef4444",
    fontWeight: "600"
  },
  link: {
    color: COLORS.navyBlue,
    textDecoration: "none",
    fontWeight: "600",
    transition: "color 0.3s",
    borderBottom: `2px solid ${COLORS.gold}`
  },
  footer: {
    backgroundColor: COLORS.navyBlue,
    color: COLORS.white,
    padding: "2.5rem",
    textAlign: "center",
    marginTop: "4rem",
    borderTop: `4px solid ${COLORS.gold}`
  },
  footerText: {
    margin: 0,
    fontSize: "1rem",
    opacity: 0.9
  }
};

export default App;
