import { useEffect, useState } from "react";

function App() {
  const [businesses, setBusinesses] = useState([]);
  const [category, setCategory] = useState("All");

  useEffect(() => {
    fetch("http://localhost:3001/api/businesses")
      .then(res => res.json())
      .then(data => setBusinesses(data))
      .catch(err => console.error(err));
  }, []);

  const filteredBusinesses =
    category === "All"
      ? businesses
      : businesses.filter(b => b.category === category);
    

  const sortByRating = () => {
    const sorted = [...businesses].sort((a, b) => b.rating - a.rating);
    setBusinesses(sorted);
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "Arial" }}>
      <h1>LocalLink</h1>
      <p>Discover and support local businesses in your community.</p>

      {/* Category Filter */}
      <label>
        Filter by category:{" "}
        <select onChange={e => setCategory(e.target.value)}>
          <option>All</option>
          <option>Food</option>
          <option>Retail</option>
          <option>Services</option>
        </select>
      </label>

      <button onClick={sortByRating} style={{ marginLeft: "1rem" }}>
        Sort by Rating
      </button>


      <div style={{ marginTop: "2rem" }}>
        {filteredBusinesses.map(business => (
          <div
            key={business.id}
            style={{
              border: "1px solid #ccc",
              padding: "1rem",
              marginBottom: "1rem",
              borderRadius: "8px"
            }}
          >
            <h2>{business.name}</h2>
            <p><strong>Category:</strong> {business.category}</p>
            <p><strong>Rating:</strong> {business.rating}</p>
            <p>{business.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
