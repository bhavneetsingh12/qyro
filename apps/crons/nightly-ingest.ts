import fetch from "node-fetch";
import { createHmac } from "node:crypto";

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

const rawBody = "";
const timestamp = String(Date.now());
const signature = createHmac("sha256", WEBHOOK_SECRET)
  .update(`${timestamp}.${rawBody}`, "utf8")
  .digest("hex");

const response = await fetch(`${API_URL}/webhooks/nightly/ingest`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": signature,
  },
  body: rawBody,
});

if (!response.ok) {
  const text = await response.text();
  console.error(`Nightly ingest trigger failed: ${response.status} ${text}`);
  process.exit(1);
}

console.log("Nightly ingest triggered successfully");
process.exit(0);
