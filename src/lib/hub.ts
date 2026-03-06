let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getHubToken(): Promise<string> {
  // Return cached token if still valid (with 60s margin)
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  // Get SuiviPro auth token from localStorage
  const authToken = localStorage.getItem('suivipro_token');
  if (!authToken) throw new Error('Non authentifié');

  // Call our own backend proxy (credentials stay server-side)
  const res = await fetch('/api/hub/token', {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!res.ok) {
    throw new Error(`Hub login failed: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;

  return cachedToken!;
}
