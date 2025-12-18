import express from "express";
import cors from "cors";

const businesses = [
  {
    id: 1,
    name: "Sunrise Café",
    category: "Food",
    rating: 4.6,
    description: "A cozy café offering breakfast, lunch, and locally roasted coffee."
  },
  {
    id: 2,
    name: "PageTurner Books",
    category: "Retail",
    rating: 4.9,
    description: "Independent bookstore featuring local authors and events."
  },
  {
    id: 3,
    name: "SparkTech Repairs",
    category: "Services",
    rating: 4.4,
    description: "Affordable phone and laptop repair by certified technicians."
  }
];

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server is healthy" });
});

app.get("/api/businesses", (req, res) => {
  res.json(businesses);
});

app.listen(3001, () => {
  console.log("API running on http://localhost:3001");
});
