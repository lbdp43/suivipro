let cachedToken: string | null = null;
let tokenExpiry = 0;

function getAuthHeaders() {
  const authToken = localStorage.getItem('suivipro_token');
  if (!authToken) throw new Error('Non authentifié');
  return { Authorization: `Bearer ${authToken}` };
}

export async function getHubToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  const res = await fetch('/api/hub/token', {
    headers: getAuthHeaders(),
  });

  if (res.status === 404) {
    const data = await res.json();
    if (data.error === 'hub_not_configured') {
      throw new Error('HUB_NOT_CONFIGURED');
    }
  }

  if (!res.ok) {
    throw new Error(`Hub login failed: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken!;
}

export function clearHubTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

export async function getHubStatus(): Promise<{ configured: boolean; hub_email: string }> {
  const res = await fetch('/api/hub/status', {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur');
  return res.json();
}

export async function saveHubCredentials(hub_email: string, hub_password: string): Promise<void> {
  const res = await fetch('/api/hub/credentials', {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ hub_email, hub_password }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Erreur');
  }

  clearHubTokenCache();
}

export async function getHubChannels(): Promise<Array<{ id: string; name: string; description?: string }>> {
  const res = await fetch('/api/hub/channels', {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Erreur');
  }

  const data = await res.json();
  return data.channels || [];
}
