'use strict';

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    getDestBranch:   () => fetchDestBranch(message.prInfo),
    checkAllowed:    () => checkAllowed(message.repo, message.destBranch),
    validateToken:   () => validateToken(),
    fetchWorkspaces: () => fetchPaginatedAll('workspaces?pagelen=50'),
    fetchRepos:      () => fetchPaginatedAll(`repositories/${message.workspace}?pagelen=100&sort=slug`),
    fetchBranches:   () => fetchPaginatedAll(`repositories/${message.workspace}/${message.repo}/refs/branches?pagelen=100&sort=name`),
  };

  const handler = handlers[message.action];
  if (handler) {
    handler().then(sendResponse);
    return true; // async response
  }
});

// ─── Bitbucket API helpers ────────────────────────────────────────────────────

async function getCredentials() {
  const { bbEmail, bbApiToken } = await browser.storage.sync.get(['bbEmail', 'bbApiToken']);
  return { email: bbEmail ?? null, token: bbApiToken ?? null };
}

function authHeaders({ email, token }) {
  const headers = { Accept: 'application/json' };
  if (email && token) {
    headers['Authorization'] = `Basic ${btoa(`${email}:${token}`)}`;
  }
  return headers;
}

/**
 * Fetches all pages of a paginated Bitbucket endpoint.
 * Returns { values: [...all items] } or { error: string }.
 */
async function fetchPaginatedAll(endpoint) {
  const creds = await getCredentials();
  if (!creds.email || !creds.token) return { error: 'Email ou token non configuré', values: [] };

  const values = [];
  let url = `https://api.bitbucket.org/2.0/${endpoint}`;

  try {
    while (url) {
      const response = await fetch(url, { headers: authHeaders(creds) });
      if (!response.ok) {
        return { error: `HTTP ${response.status}`, values };
      }
      const data = await response.json();
      values.push(...(data.values ?? []));
      url = data.next ?? null;
    }
    return { values };
  } catch (err) {
    return { error: err.message, values };
  }
}

// ─── Token validation ─────────────────────────────────────────────────────────

async function validateToken() {
  const creds = await getCredentials();
  if (!creds.email || !creds.token) {
    return { valid: false, error: 'Email et token requis' };
  }

  try {
    const response = await fetch('https://api.bitbucket.org/2.0/user', {
      headers: authHeaders(creds),
    });

    if (response.status === 401) return { valid: false, error: 'Token invalide ou expiré (401)' };
    if (response.status === 403) return { valid: false, error: 'Accès refusé — vérifie les scopes du token (403)' };
    if (!response.ok)            return { valid: false, error: `Erreur API : HTTP ${response.status}` };

    const data = await response.json();
    return {
      valid: true,
      displayName: data.display_name ?? data.account_id,
      accountId:   data.account_id,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ─── PR destination branch ────────────────────────────────────────────────────

async function fetchDestBranch({ workspace, repo, prId }) {
  const creds = await getCredentials();
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prId}`;

  try {
    const response = await fetch(url, { headers: authHeaders(creds), credentials: 'include' });
    if (!response.ok) {
      console.warn(`[MergeGuard] API responded ${response.status} for PR ${prId}`);
      return { destBranch: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { destBranch: data?.destination?.branch?.name ?? null };
  } catch (err) {
    console.error('[MergeGuard] API fetch failed:', err);
    return { destBranch: null, error: err.message };
  }
}

// ─── Rule checking ────────────────────────────────────────────────────────────

async function checkAllowed(repo, destBranch) {
  const { repoRules } = await browser.storage.sync.get('repoRules');
  const allowed = (repoRules ?? {})[repo] ?? [];

  if (allowed.length === 0) return { allowed: true, noRules: true };

  return {
    allowed: allowed.includes(destBranch),
    allowedBranches: allowed,
  };
}
