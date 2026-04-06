import fetch from "node-fetch";

const API_URL = process.env.API_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!API_URL) {
  console.error("API_URL is required");
  process.exit(1);
}

if (!WEBHOOK_SECRET) {
  console.error("WEBHOOK_SECRET is required");
  process.exit(1);
}

const response = await fetch(`${API_URL}/webhooks/morning/digest`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-webhook-secret": WEBHOOK_SECRET,
  },
});

if (!response.ok) {
  const text = await response.text();
  console.error(`Morning digest trigger failed: ${response.status} ${text}`);
  process.exit(1);
}

console.log("Morning digest triggered successfully");
process.exit(0);
