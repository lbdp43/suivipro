const HUB_API_URL = import.meta.env.VITE_HUB_API_URL;
const HUB_EMAIL = import.meta.env.VITE_HUB_EMAIL;
const HUB_PASSWORD = import.meta.env.VITE_HUB_PASSWORD;

let cachedToken = null;
let tokenExpiry = 0;

export async function getHubToken() {
  // Return cached token if still valid (with 60s margin)
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  const res = await fetch(`${HUB_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: HUB_EMAIL, password: HUB_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Hub login failed: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  // Cache for 23 hours (assuming 24h token validity)
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;

  return cachedToken;
}
