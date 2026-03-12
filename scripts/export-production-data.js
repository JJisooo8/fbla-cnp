#!/usr/bin/env node

/**
 * Export production business & review data for local development.
 *
 * Usage:
 *   node scripts/export-production-data.js <production-url>
 *
 * Example:
 *   node scripts/export-production-data.js https://your-app.vercel.app
 *
 * This fetches all businesses and reviews from the production API's
 * /api/export-data endpoint and writes them to:
 *   - server/data/businesses.json  (business listings)
 *   - server/data/metadata.json    (sync metadata)
 *   - server/reviews.json          (review data for the review system)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "server", "data");
const REVIEWS_FILE = path.join(ROOT, "server", "reviews.json");

const productionUrl = process.argv[2];

if (!productionUrl) {
  console.error("Usage: node scripts/export-production-data.js <production-url>");
  console.error("Example: node scripts/export-production-data.js https://your-app.vercel.app");
  process.exit(1);
}

const baseUrl = productionUrl.replace(/\/$/, "");

async function main() {
  console.log(`Fetching data from ${baseUrl}/api/export-data ...`);

  const response = await fetch(`${baseUrl}/api/export-data`);
  if (!response.ok) {
    console.error(`Failed: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const data = await response.json();

  console.log(`Received ${data.businessCount} businesses and ${data.reviewCount} reviews`);

  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Write businesses (strip reviews from the business objects to keep file clean,
  // reviews are stored separately in reviews.json)
  const businesses = data.businesses.map(biz => {
    const { reviews, categoryRatings, ...rest } = biz;
    return rest;
  });

  fs.writeFileSync(
    path.join(DATA_DIR, "businesses.json"),
    JSON.stringify(businesses, null, 2)
  );
  console.log(`Wrote ${businesses.length} businesses to server/data/businesses.json`);

  // Write metadata
  const now = new Date();
  const metadata = {
    seedDate: now.toISOString(),
    seedDateFormatted: now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    businessCount: businesses.length,
    categories: {
      Food: businesses.filter(b => b.category === "Food").length,
      Retail: businesses.filter(b => b.category === "Retail").length,
      Services: businesses.filter(b => b.category === "Services").length,
    },
    location: "Cumming, Georgia",
    source: `Exported from production (${baseUrl})`,
  };

  fs.writeFileSync(
    path.join(DATA_DIR, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );
  console.log("Wrote server/data/metadata.json");

  // Write reviews (the raw Map entries for the review system)
  if (data.reviews && data.reviews.length > 0) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data.reviews, null, 2));
    console.log(`Wrote ${data.reviewCount} reviews to server/reviews.json`);
  }

  console.log("\nDone! Your local server will now use this data automatically.");
}

main().catch(err => {
  console.error("Export failed:", err.message);
  process.exit(1);
});
