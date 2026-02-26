'use strict';

(function () {
  // Track guarded buttons to avoid double-registration of click listener
  const guardedButtons = new WeakSet();

  // Cache: prId → { destBranch, allowed, allowedBranches, noInfo, timestamp }
  const statusCache = new Map();
  const CACHE_TTL_MS = 30_000;

  // Change-detection state (SPA navigation + target branch edits)
  let lastURL = '';
  let lastDestBranch = null;

  // ─── URL Parsing ──────────────────────────────────────────────────────────

  function extractPRInfoFromURL() {
    const match = window.location.href.match(
      /bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/
    );
    if (!match) return null;
    return {
      workspace: match[1],
      repo: match[2],
      prId: match[3],
      fullRepo: `${match[1]}/${match[2]}`,
    };
  }

  // ─── Destination Branch Detection ────────────────────────────────────────

  function readDestBranchFromDOM() {
    // Strategy 1: data-qa attributes (most stable across BB versions)
    const qaSelectors = [
      '[data-qa="pr-destination-branch"]',
      '[data-qa="pr-header-destination-branch"]',
      '[data-qa="destination-branch-name"]',
    ];
    for (const sel of qaSelectors) {
      const text = document.querySelector(sel)?.textContent?.trim();
      if (text) return text;
    }

    // Strategy 2: Branch anchors inside PR header (source → destination)
    const prHeader =
      document.querySelector('[data-qa="pr-header"]') ||
      document.querySelector('[class*="PullRequestHeader"]') ||
      document.querySelector('[id*="pull-request-header"]');

    if (prHeader) {
      const anchors = [...prHeader.querySelectorAll('a[href*="/branch/"]')];
      if (anchors.length >= 2) {
        const match = anchors[1].href.match(/\/branch\/([^?#]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
    }

    // Strategy 3: Global branch anchors fallback
    const anchors = [...document.querySelectorAll('a[href*="/branch/"]')].filter(
      (a) => !a.href.includes('commits') &&
              a.closest('[class*="branch"], [class*="Branch"], [data-qa*="branch"]')
    );
    if (anchors.length >= 2) {
      const match = anchors[1].href.match(/\/branch\/([^?#]+)/);
      if (match) return decodeURIComponent(match[1]);
    }

    return null;
  }

  async function getDestBranch(prInfo) {
    const domBranch = readDestBranchFromDOM();
    if (domBranch) return domBranch;

    try {
      const response = await browser.runtime.sendMessage({ action: 'getDestBranch', prInfo });
      return response?.destBranch ?? null;
    } catch (err) {
      console.warn('[MergeGuard] Could not reach background script:', err);
      return null;
    }
  }

  // ─── Branch Status (with cache) ───────────────────────────────────────────

  /**
   * Resolves the full branch status for the current PR.
   * Results are cached for CACHE_TTL_MS to avoid hammering the API on re-renders.
   * Always fails open: { allowed: true, noInfo: true } if anything goes wrong.
   */
  async function resolveBranchStatus(prInfo) {
    const cached = statusCache.get(prInfo.prId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached;

    const destBranch = await getDestBranch(prInfo);
    if (!destBranch) {
      return { allowed: true, noInfo: true };
    }

    let checkResult;
    try {
      checkResult = await browser.runtime.sendMessage({
        action: 'checkAllowed',
        repo: prInfo.fullRepo,
        destBranch,
      });
    } catch (err) {
      console.warn('[MergeGuard] checkAllowed failed, proceeding:', err);
      return { destBranch, allowed: true, noInfo: true };
    }

    const result = { destBranch, ...checkResult, timestamp: Date.now() };
    statusCache.set(prInfo.prId, result);
    return result;
  }

  // ─── Visual State ─────────────────────────────────────────────────────────

  const BANNER_ID = 'bmg-warning-banner';

  /**
   * Colors the merge button red and inserts an explanatory banner when the
   * destination branch is not in the allowed list.
   * Restores the button and removes the banner when it is allowed.
   */
  function applyVisualState(button, status) {
    document.getElementById(BANNER_ID)?.remove();

    if (status.allowed || status.noInfo) {
      button.style.removeProperty('background-color');
      button.style.removeProperty('border-color');
      button.removeAttribute('title');
      return;
    }

    // Color the button red
    button.style.setProperty('background-color', '#DE350B', 'important');
    button.style.setProperty('border-color', '#BF2600', 'important');

    const allowedText = status.allowedBranches?.length
      ? `Branches autorisées : ${status.allowedBranches.join(', ')}`
      : 'Aucune branche autorisée configurée';

    button.title = `⚠️ Destination inattendue : "${status.destBranch}". ${allowedText}`;

    // Insert warning banner next to the button
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = [
      'display:flex', 'align-items:baseline', 'gap:6px',
      'padding:8px 12px', 'border-radius:4px',
      'background:#FFEBE6', 'color:#BF2600',
      'font-size:13px', 'margin-top:8px',
      'border:1px solid #FFBDAD', 'line-height:1.5',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const strong = document.createElement('strong');
    strong.style.cssText = 'margin:0 3px';
    strong.textContent   = status.destBranch;
    const muted = document.createElement('span');
    muted.style.opacity = '.75';
    muted.textContent   = `· ${allowedText}`;
    banner.append('⚠️ Destination inattendue\u00a0: ', strong, muted);

    const insertAnchor =
      button.closest('[class*="merge"], [data-qa*="merge"]') ??
      button.parentElement;
    insertAnchor?.insertAdjacentElement('afterend', banner);
    console.log(`[MergeGuard] ${status.destBranch} is not allowed on ${window.location.pathname}`);
  }

  // ─── Confirmation Modal ───────────────────────────────────────────────────

  function showConfirmModal({ destBranch, allowedBranches }, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.id = 'bmg-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(9,30,66,.54)', 'display:flex',
      'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border-radius:8px', 'padding:28px 32px',
      'max-width:480px', 'width:90%', 'box-shadow:0 8px 40px rgba(9,30,66,.25)',
    ].join(';');

    // ── Header: warning icon + title ──
    const header   = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px';

    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'width:40px;height:40px;border-radius:50%;background:#FF8B00;' +
      'display:flex;align-items:center;justify-content:center;flex-shrink:0';
    iconWrap.appendChild(makeSVGIcon(
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z'
    ));

    const h2 = document.createElement('h2');
    h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;color:#172B4D';
    h2.textContent   = 'Branche de destination inattendue';
    header.append(iconWrap, h2);

    // ── Destination branch sentence ──
    const destStrong = document.createElement('strong');
    destStrong.style.color = '#172B4D';
    destStrong.textContent = destBranch;

    const p1 = document.createElement('p');
    p1.style.cssText = 'margin:0 0 8px;color:#42526E;line-height:1.6;font-size:14px';
    p1.append('Tu es sur le point de merger cette PR vers ', destStrong, '.');

    // ── Allowed branches ──
    const p2 = document.createElement('p');
    p2.style.cssText = 'margin:0 0 20px;color:#42526E;font-size:14px;line-height:1.6';
    if (allowedBranches?.length) {
      p2.append('Branches autorisées pour ce repo\u00a0: ');
      allowedBranches.forEach((b, i) => {
        if (i > 0) p2.append(' ');
        const code = document.createElement('code');
        code.style.cssText = 'background:#F4F5F7;padding:2px 6px;border-radius:3px;font-size:13px';
        code.textContent   = b;
        p2.appendChild(code);
      });
    } else {
      p2.textContent = "Aucune branche autorisée n'est configurée pour ce repository.";
    }

    // ── Buttons ──
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';

    const cancelBtn  = makeButton('Annuler', { border: '1px solid #DFE1E6', background: '#fff', color: '#42526E' });
    const confirmBtn = makeButton('Merger quand même', { border: 'none', background: '#DE350B', color: '#fff', fontWeight: '600' });

    cancelBtn.addEventListener('click',  () => { cleanup(); onCancel(); });
    confirmBtn.addEventListener('click', () => { cleanup(); onConfirm(); });

    btnRow.append(cancelBtn, confirmBtn);
    card.append(header, p1, p2, btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function onKey(e) { if (e.key === 'Escape') { cleanup(); onCancel(); } }
    function onOverlayClick(e) { if (e.target === overlay) { cleanup(); onCancel(); } }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', onOverlayClick);

    function cleanup() {
      document.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function makeSVGIcon(pathD) {
    const NS  = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'white');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  function makeButton(text, styles) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText =
      'padding:8px 16px;border-radius:4px;cursor:pointer;font-size:14px;' +
      Object.entries(styles).map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`).join(';');
    return btn;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Merge Button Detection ───────────────────────────────────────────────

  function findMergeButton() {
    for (const sel of [
      '[data-qa="merge-button"]',
      '[data-qa="pr-merge-button"]',
      '[data-qa="pr-header-merge-button"]',
      'button[data-testid="merge-button"]',
    ]) {
      const el = document.querySelector(sel);
      if (el) {
        return el;
      }
    }
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (el.textContent.trim() === 'Merge') {
        return el;
      }
    }

    return null;
  }

  // ─── Visual State (async helper) ──────────────────────────────────────────

  function applyVisualStateAsync(button) {
    const prInfo = extractPRInfoFromURL();
    if (prInfo) {
      resolveBranchStatus(prInfo).then(status => applyVisualState(button, status));
    }
  }

  // ─── Merge Button Guard ───────────────────────────────────────────────────

  /**
   * Attaches the click interceptor once per button element.
   * Visual state is applied separately via applyVisualStateAsync.
   */
  function guardButton(button) {
    if (guardedButtons.has(button)) return;
    guardedButtons.add(button);

    let allowNextClick = false;

    button.addEventListener('click', async (event) => {
      if (allowNextClick) {
        allowNextClick = false;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const info = extractPRInfoFromURL();
      if (!info) {
        allowNextClick = true;
        button.click();
        return;
      }

      // Re-use cached result if available (usually already populated by visual warning)
      const status = await resolveBranchStatus(info);

      if (status.allowed || status.noInfo) {
        allowNextClick = true;
        button.click();
        return;
      }

      showConfirmModal(
        status,
        () => { allowNextClick = true; if (document.body.contains(button)) button.click(); },
        () => {}
      );
    }, true); // capture phase

    console.log(`[MergeGuard] Merge button guarded on ${window.location.pathname}`);
  }

  // ─── DOM Observer ─────────────────────────────────────────────────────────

  function scanAndGuard() {
    const url = window.location.href;
    const destBranch = readDestBranchFromDOM();

    const urlChanged    = url !== lastURL;
    const branchChanged = !!destBranch && destBranch !== lastDestBranch;

    if (urlChanged) {
      // SPA navigation: bust the cache for the previous PR
      const match = lastURL.match(/pull-requests\/(\d+)/);
      if (match) statusCache.delete(match[1]);
      lastURL = url;
      lastDestBranch = null;
    }

    if (branchChanged) {
      // Target branch was edited on the current PR: bust the cache
      const prInfo = extractPRInfoFromURL();
      if (prInfo) statusCache.delete(prInfo.prId);
      lastDestBranch = destBranch;
    }

    const button = findMergeButton();
    if (!button) return;

    if (!guardedButtons.has(button)) {
      // New button element: attach click interceptor once, then render state
      guardButton(button);
      applyVisualStateAsync(button);
    } else if (urlChanged || branchChanged) {
      // Same button element, but PR or branch changed: refresh visual state
      applyVisualStateAsync(button);
    }
  }

  const observer = new MutationObserver(scanAndGuard);
  observer.observe(document.body, { childList: true, subtree: true });
  scanAndGuard();
})();
