// Generates three realistic sample datasets (with intentional anomalies)
// so reviewers can try the app without collecting their own data.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "..", "datasets");
mkdirSync(out, { recursive: true });

// Small deterministic PRNG (mulberry32)
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260103);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

// ── 1. Sales orders (main dataset) ────────────────────────────────────────
const regions = ["North", "South", "East", "West", "Central"];
// West is deliberately the top region
const regionWeights = { North: 0.12, South: 0.16, East: 0.2, West: 0.37, Central: 0.15 };
function pickRegion() {
  let r = rand();
  for (const [k, w] of Object.entries(regionWeights)) { if ((r -= w) <= 0) return k; }
  return "Central";
}
const categories = ["Electronics", "Home & Kitchen", "Sports", "Books", "Beauty"];
const products = {
  Electronics: [
    ["Noise-Cancelling Headphones", 249.99], ["Smart Watch S2", 399.0], ["4K Action Camera", 179.5],
    ["Wireless Keyboard", 89.9], ["USB-C Hub 8-in-1", 59.99],
  ],
  "Home & Kitchen": [
    ["Espresso Machine", 149.0], ["Nonstick Cookware Set", 119.99], ["Robot Vacuum E5", 289.0],
    ["Stand Mixer", 209.99], ["Air Purifier XL", 129.5],
  ],
  Sports: [
    ["Trail Running Shoes", 139.0], ["Adjustable Dumbbells", 229.0], ["Yoga Mat Pro", 79.99],
    ["Cycling Helmet", 64.5],
  ],
  Books: [
    ["The Data Cookbook", 39.99], ["Design Systems Handbook", 49.5], ["Growth Analytics 101", 24.99],
  ],
  Beauty: [
    ["Facial Serum 30ml", 45.0], ["Ceramic Hair Dryer", 89.0], ["Lavender Candle Set", 34.99],
  ],
};
const customers = [
  "Ava Thompson", "Liam Rodriguez", "Sofia Kim", "Noah Patel", "Mia Chen", "Ethan Brown",
  "Isabella Garcia", "Lucas Nguyen", "Charlotte Lee", "Ethan Walker", "Amelia Scott", "Oliver King",
  "Harper Wright", "Elijah Torres", "Evelyn Adams", "James Hall", "Abigail Young", "Henry Green",
  "Ella Lewis", "Leo Martin", "Scarlet Clark", "Owen Baker", "Aria Nelson", "Mason Hill",
  "Chloe Diaz", "Jack Rivera", "Luna Cooper", "Owen Price", "Nora Sanders", "Hudson Reed",
];
// A few corporate buyers appear far more often → customer concentration
const customerWeights = customers.map((name) =>
  ["Ava Thompson", "Noah Patel", "Lucas Nguyen"].includes(name) ? 0.09 : 0.6 / customers.length
);
function pickCustomer() {
  const total = customerWeights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < customers.length; i++) { if ((r -= customerWeights[i]) <= 0) return customers[i]; }
  return customers[0];
}

const salesRows = [];
const startDate = Date.UTC(2024, 0, 1);
const days = Math.round((Date.UTC(2025, 5, 30) - startDate) / 86400000);
let orderId = 10001;

for (let d = 0; d < days; d++) {
  const date = new Date(startDate + d * 86400000);
  const weekday = date.getUTCDay();
  const weekendBoost = weekday === 0 || weekday === 6 ? 1.25 : 1;
  // Slow growth over time + a bad dip in March 2025 (in-store outage)
  const growth = 1 + d / days * 0.35;
  const outage = d >= 424 && d <= 431 ? 0.25 : 1; // 2025 holidays dip
  const n = Math.max(0, Math.round((1 + rand() * 1.6) * weekendBoost * growth * outage));
  for (let k = 0; k < n; k++) {
    const category = pick(categories);
    const [product, base] = pick(products[category]);
    const region = pickRegion();
    let qty = Math.max(1, Math.round(rand() * 4));
    let unitPrice = round2(base * (0.9 + rand() * 0.2));
    let discount = pick([0, 0, 0, 0.05, 0.1, 0.15]);
    const dateStr = date.toISOString().slice(0, 10);
    // Planted anomalies
    if (rand() < 0.0035) qty = Math.round(35 + rand() * 30);          // bulk outlier
    if (rand() < 0.0012) unitPrice = round2(unitPrice * 8);           // pricing error
    const revenue = round2(qty * unitPrice * (1 - discount));
    salesRows.push([
      `SO-${orderId++}`, dateStr, region, category, product, pickCustomer(),
      qty, `USD`, unitPrice, discount, revenue,
      pick(["Online", "Retail Store", "Partner"]),
    ]);
  }
}
const salesHeaders = [
  "order_id", "order_date", "region", "product_category", "product_name",
  "customer_name", "quantity", "currency", "unit_price", "discount", "revenue", "sales_channel",
];
writeFileSync(join(out, "sales_orders.csv"), toCsv(salesHeaders, salesRows));
console.log("sales_orders.csv:", salesRows.length, "rows");

// ── 2. Customers ─────────────────────────────────────────────────────────
const cities = ["Berlin", "Toronto", "Austin", "London", "Lisbon", "Mumbai", "Singapore", "Warsaw"];
const segments = ["Consumer", "SMB", "Enterprise"];
const custRows = customers.flatMap((name, i) => {
  const segment = name === "Ava Thompson" || name === "Noah Patel" ? "Enterprise" : pick(segments);
  const signup = new Date(startDate + Math.floor(rand() * days) * 86400000).toISOString().slice(0, 10);
  const ltv = segment === "Enterprise" ? round2(8000 + rand() * 14000) : segment === "SMB" ? round2(2000 + rand() * 5000) : round2(200 + rand() * 1800);
  return [[`CU-${String(i + 1).padStart(4, "0")}`, name, name + "@example.com", segment, pick(cities), signup, ltv, rand() < 0.08 ? "true" : "false"]];
});
writeFileSync(
  join(out, "customers.csv"),
  toCsv(["customer_id", "customer_name", "email", "segment", "city", "signup_date", "lifetime_value", "churned"],
        custRows)
);
console.log("customers.csv:", custRows.length, "rows");

// ── 3. Product returns & refunds (join dataset with data-quality quirks) ──
const returnRows = [];
let tid = 1;
const reasons = ["Damaged in transit", "Wrong item", "Quality issue", "Changed mind", "Late delivery"];
for (let i = 0; i < 420; i++) {
  const sale = salesRows[Math.floor(rand() * salesRows.length)];
  const date = new Date(Date.parse(sale[1]) + Math.floor(rand() * 20) * 86400000).toISOString().slice(0, 10);
  const refund = round2(Number(sale[10]) * (0.5 + rand() * 0.5));
  // occasional null refund amount + occasional negative (data error)
  returnRows.push([
    `RT-${String(tid++).padStart(5, "0")}`,
    sale[0],
    sale[5],
    reasons[Math.floor(rand() * reasons.length)],
    rand() < 0.06 ? "" : refund,          // 6% missing
    date,
  ]);
}
const refundHeaders = ["return_id", "order_id", "customer_name", "reason", "refund_amount", "return_date"];
writeFileSync(join(out, "returns_refunds.csv"), toCsv(refundHeaders, returnRows));
console.log("returns_refunds.csv:", returnRows.length, "rows");
