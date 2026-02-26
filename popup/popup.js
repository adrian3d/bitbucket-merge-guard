'use strict';

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  const badge    = document.getElementById('badge');
  const badgeText = document.getElementById('badgeText');
  const meta     = document.getElementById('meta');

  const prMatch = url.match(/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/);

  if (!prMatch) {
    badge.className  = 'badge badge-inactive';
    badgeText.textContent = 'Inactif — pas sur une PR Bitbucket';
  } else {
    const workspace = prMatch[1];
    const repo      = prMatch[2];
    const prId      = prMatch[3];
    const fullRepo  = `${workspace}/${repo}`;

    const { repoRules } = await browser.storage.sync.get('repoRules');
    const rules = repoRules ?? {};
    const allowed = rules[fullRepo];

    if (!allowed || allowed.length === 0) {
      badge.className  = 'badge badge-warning';
      badgeText.textContent = 'Actif — aucune règle configurée pour ce repo';
    } else {
      badge.className  = 'badge badge-active';
      badgeText.textContent = 'Actif — protection en place';
    }

    meta.style.display = 'block';
    meta.textContent   = '';

    const repoCode = document.createElement('code');
    repoCode.textContent = fullRepo;
    meta.append('Repo\u00a0: ', repoCode, ` \u00a0\u00b7\u00a0 PR\u00a0#${prId}`);
    meta.appendChild(document.createElement('br'));

    if (allowed?.length) {
      meta.append('Branches autorisées\u00a0: ');
      allowed.forEach((b, i) => {
        if (i > 0) meta.append(' ');
        const code = document.createElement('code');
        code.textContent = b;
        meta.appendChild(code);
      });
    } else {
      const warn = document.createElement('span');
      warn.style.color  = '#974F0C';
      warn.textContent  = 'Configure les branches autorisées dans les options.';
      meta.appendChild(warn);
    }
  }

  document.getElementById('openOptions').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
}

init();
