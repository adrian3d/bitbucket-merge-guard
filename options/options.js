'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────

const bbEmailInput     = document.getElementById('bbEmail');
const apiTokenInput    = document.getElementById('bbApiToken');
const saveAuthBtn      = document.getElementById('saveAuth');
const testAuthBtn      = document.getElementById('testAuth');
const testSpinner      = document.getElementById('testSpinner');
const tokenStatus      = document.getElementById('tokenStatus');
const tokenStatusIcon  = document.getElementById('tokenStatusIcon');
const tokenStatusText  = document.getElementById('tokenStatusText');
const authToast        = document.getElementById('authToast');

const repoListEl       = document.getElementById('repoList');
const rulesToast       = document.getElementById('rulesToast');

// Dynamic picker
const loadWsBtn        = document.getElementById('loadWsBtn');
const wsSpinner        = document.getElementById('wsSpinner');
const wsSelect         = document.getElementById('wsSelect');
const stepRepo         = document.getElementById('stepRepo');
const repoSearch       = document.getElementById('repoSearch');
const repoSelect       = document.getElementById('repoSelect');
const repoSpinner      = document.getElementById('repoSpinner');
const stepBranches     = document.getElementById('stepBranches');
const branchSearch     = document.getElementById('branchSearch');
const branchCount      = document.getElementById('branchCount');
const branchPicker     = document.getElementById('branchPicker');
const branchSpinner    = document.getElementById('branchSpinner');
const addRepoDynamic   = document.getElementById('addRepoDynamic');

// Full lists kept in memory for client-side filtering
let allRepos    = []; // { slug, name }
let allBranches = []; // { name }

// Manual fallback
const newRepoInput     = document.getElementById('newRepo');
const newBranchInput   = document.getElementById('newBranches');
const addRepoManual    = document.getElementById('addRepoManual');

let repoRules = {};

// ─── Init ──────────────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await browser.storage.sync.get(['bbEmail', 'bbApiToken', 'repoRules']);
  if (data.bbEmail)    bbEmailInput.value   = data.bbEmail;
  if (data.bbApiToken) apiTokenInput.value  = data.bbApiToken;
  repoRules = data.repoRules ?? {};
  renderRepoList();
}

// ─── Auth: Save ───────────────────────────────────────────────────────────────

saveAuthBtn.addEventListener('click', async () => {
  await browser.storage.sync.set({
    bbEmail:    bbEmailInput.value.trim()   || null,
    bbApiToken: apiTokenInput.value.trim()  || null,
  });
  showToast(authToast, 'Identifiants sauvegardés ✓', 'success');
  tokenStatus.className = 'token-status';
});

// ─── Auth: Test ───────────────────────────────────────────────────────────────

testAuthBtn.addEventListener('click', async () => {
  // Save current values first so the background script uses the latest credentials
  await browser.storage.sync.set({
    bbEmail:    bbEmailInput.value.trim()  || null,
    bbApiToken: apiTokenInput.value.trim() || null,
  });

  setLoading(testAuthBtn, testSpinner, true);
  tokenStatus.className = 'token-status';

  const result = await browser.runtime.sendMessage({ action: 'validateToken' });

  setLoading(testAuthBtn, testSpinner, false);

  if (result.valid) {
    tokenStatus.className    = 'token-status ok show';
    tokenStatusIcon.textContent = '✅';
    tokenStatusText.textContent = `Connecté en tant que ${result.displayName}`;
  } else {
    tokenStatus.className    = 'token-status err show';
    tokenStatusIcon.textContent = '❌';
    tokenStatusText.textContent = result.error;
  }
});

// ─── Dynamic picker: Workspaces ───────────────────────────────────────────────

loadWsBtn.addEventListener('click', async () => {
  setLoading(loadWsBtn, wsSpinner, true);
  wsSelect.disabled = true;

  const result = await browser.runtime.sendMessage({ action: 'fetchWorkspaces' });

  setLoading(loadWsBtn, wsSpinner, false);

  if (result.error && !result.values.length) {
    showToast(rulesToast, `Erreur workspaces : ${result.error}`, 'error');
    wsSelect.disabled = false;
    return;
  }

  wsSelect.textContent = '';
  wsSelect.appendChild(new Option('— Sélectionner un workspace —', ''));
  result.values.forEach(ws => wsSelect.appendChild(new Option(`${ws.name} (${ws.slug})`, ws.slug)));

  wsSelect.disabled = false;
  if (result.error) {
    showToast(rulesToast, `Chargement partiel : ${result.error}`, 'error');
  }
});

wsSelect.addEventListener('change', async () => {
  const workspace = wsSelect.value;

  // Reset downstream steps
  stepRepo.hidden       = true;
  stepBranches.hidden   = true;
  addRepoDynamic.hidden = true;
  allRepos = [];
  repoSearch.value = '';
  repoSearch.disabled = true;
  repoSelect.textContent = '';
  repoSelect.appendChild(new Option('— Sélectionner un repository —', ''));

  if (!workspace) return;

  stepRepo.hidden = false;
  repoSpinner.classList.add('show');
  repoSelect.disabled = true;

  const result = await browser.runtime.sendMessage({ action: 'fetchRepos', workspace });

  repoSpinner.classList.remove('show');
  repoSelect.disabled = false;

  if (result.error && !result.values.length) {
    showToast(rulesToast, `Erreur repos : ${result.error}`, 'error');
    return;
  }

  allRepos = result.values.map(r => ({ slug: r.slug, name: r.name }));
  renderRepoOptions(allRepos);
  repoSearch.disabled = false;
});

// ─── Dynamic picker: Repositories ────────────────────────────────────────────

repoSelect.addEventListener('change', async () => {
  const workspace = wsSelect.value;
  const repo      = repoSelect.value;

  stepBranches.hidden   = true;
  addRepoDynamic.hidden = true;
  allBranches = [];
  branchSearch.value = '';
  branchSearch.disabled = true;
  branchCount.textContent = '';

  if (!workspace || !repo) return;

  stepBranches.hidden = false;
  branchSpinner.classList.add('show');
  branchPicker.textContent = '';
  branchPicker.appendChild(branchSpinner);

  const result = await browser.runtime.sendMessage({ action: 'fetchBranches', workspace, repo });

  branchSpinner.classList.remove('show');

  if (result.error && !result.values.length) {
    const errMsg = document.createElement('span');
    errMsg.className   = 'branch-picker-empty';
    errMsg.textContent = `Erreur : ${result.error}`;
    branchPicker.replaceChildren(errMsg);
    return;
  }

  if (!result.values.length) {
    const empty = document.createElement('span');
    empty.className   = 'branch-picker-empty';
    empty.textContent = 'Aucune branche trouvée.';
    branchPicker.replaceChildren(empty);
    return;
  }

  allBranches = result.values.map(b => b.name);

  const fullRepo       = `${workspace}/${repo}`;
  const alreadyAllowed = repoRules[fullRepo] ?? [];
  renderBranchOptions(allBranches, alreadyAllowed);

  branchSearch.disabled = false;
  addRepoDynamic.hidden = false;
});

// ─── Search filters ───────────────────────────────────────────────────────────

repoSearch.addEventListener('input', () => {
  const q = repoSearch.value.trim().toLowerCase();
  const filtered = q
    ? allRepos.filter(r => r.slug.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    : allRepos;

  const current = repoSelect.value; // preserve selection if still in filtered list
  renderRepoOptions(filtered);
  if (current && filtered.some(r => r.slug === current)) repoSelect.value = current;
});

branchSearch.addEventListener('input', debounce(() => {
  const q = branchSearch.value.trim().toLowerCase();
  let visible = 0;
  const labels = branchPicker.querySelectorAll('label');
  labels.forEach(label => {
    const name = label.querySelector('span')?.textContent.toLowerCase() ?? '';
    const hide = q.length > 0 && !name.includes(q);
    label.style.display = hide ? 'none' : '';  // inline style wins over .branch-picker label { display:flex }
    if (!hide) visible++;
  });
  branchCount.textContent = q.length > 0 ? `${visible}/${labels.length}` : '';
}, 200));

// ─── Dynamic picker: Confirm ──────────────────────────────────────────────────

addRepoDynamic.addEventListener('click', () => {
  const workspace = wsSelect.value;
  const repo      = repoSelect.value;
  if (!workspace || !repo) return;

  const fullRepo  = `${workspace}/${repo}`;
  const checked   = [...branchPicker.querySelectorAll('input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  if (checked.length === 0) {
    showToast(rulesToast, 'Sélectionne au moins une branche.', 'error');
    return;
  }

  repoRules[fullRepo] = checked;
  saveRules('Repository ajouté ✓');
});

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderRepoOptions(repos) {
  repoSelect.textContent = '';
  repoSelect.appendChild(new Option('— Sélectionner un repository —', ''));
  repos.forEach(r => repoSelect.appendChild(new Option(`${r.name} (${r.slug})`, r.slug)));
}

function renderBranchOptions(branches, alreadyAllowed = []) {
  branchPicker.textContent = '';
  branches.forEach(name => {
    const label    = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.value   = name;
    checkbox.checked = alreadyAllowed.includes(name);
    const span = document.createElement('span');
    span.textContent = name;
    label.append(checkbox, span);
    branchPicker.appendChild(label);
  });
}

// ─── Manual fallback ──────────────────────────────────────────────────────────

addRepoManual.addEventListener('click', () => {
  const repo     = newRepoInput.value.trim().toLowerCase();
  const branches = newBranchInput.value.split(',').map(b => b.trim()).filter(Boolean);

  if (!repo.includes('/')) { highlight(newRepoInput); return; }
  if (!branches.length)    { highlight(newBranchInput); return; }

  if (!repoRules[repo]) repoRules[repo] = [];
  branches.forEach(b => { if (!repoRules[repo].includes(b)) repoRules[repo].push(b); });

  newRepoInput.value   = '';
  newBranchInput.value = '';
  saveRules();
});

newBranchInput.addEventListener('keydown', e => { if (e.key === 'Enter') addRepoManual.click(); });

// ─── Repo list render ─────────────────────────────────────────────────────────

async function saveRules(successMsg = 'Règles sauvegardées ✓') {
  await browser.storage.sync.set({ repoRules });
  renderRepoList();
  showToast(rulesToast, successMsg, 'success');
}

function renderRepoList() {
  repoListEl.textContent = '';
  const entries = Object.entries(repoRules);

  if (!entries.length) {
    const p = document.createElement('p');
    p.className   = 'empty-state';
    p.textContent = 'Aucun repository configuré.';
    repoListEl.appendChild(p);
    return;
  }

  for (const [repo, branches] of entries) {
    repoListEl.appendChild(createRepoItem(repo, branches));
  }
}

function createRepoItem(repo, branches) {
  const item = document.createElement('div');
  item.className = 'repo-item';

  const header = document.createElement('div');
  header.className = 'repo-item-header';

  const name = document.createElement('span');
  name.className  = 'repo-name';
  name.textContent = repo;

  const deleteBtn = document.createElement('button');
  deleteBtn.className   = 'btn btn-danger';
  deleteBtn.textContent = 'Supprimer';
  deleteBtn.style.cssText = 'font-size:12px;padding:5px 10px';
  deleteBtn.addEventListener('click', () => { delete repoRules[repo]; saveRules(); });

  header.append(name, deleteBtn);

  const tags = document.createElement('div');
  tags.className = 'tags';
  renderTags(tags, repo, branches);

  // Inline: add single branch
  const addRow = document.createElement('div');
  addRow.className = 'inline-row';

  const branchInput = document.createElement('input');
  branchInput.type        = 'text';
  branchInput.placeholder = 'Ajouter une branche…';

  const addBtn = document.createElement('button');
  addBtn.className  = 'btn btn-subtle';
  addBtn.textContent = 'Ajouter';

  addBtn.addEventListener('click', () => {
    const b = branchInput.value.trim();
    if (!b || repoRules[repo]?.includes(b)) return;
    (repoRules[repo] ??= []).push(b);
    branchInput.value = '';
    saveRules();
  });
  branchInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });

  addRow.append(branchInput, addBtn);
  item.append(header, tags, addRow);
  return item;
}

function renderTags(container, repo, branches) {
  container.textContent = '';
  (branches ?? []).forEach(branch => {
    const tag = document.createElement('span');
    tag.className = 'tag';

    const removeBtn = document.createElement('button');
    removeBtn.className   = 'tag-remove';
    removeBtn.textContent = '\u2715';
    removeBtn.title       = `Supprimer ${branch}`;
    removeBtn.addEventListener('click', () => {
      repoRules[repo] = repoRules[repo].filter(b => b !== branch);
      if (!repoRules[repo].length) delete repoRules[repo];
      saveRules();
    });

    tag.append(document.createTextNode(branch), removeBtn);
    container.appendChild(tag);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setLoading(btn, spinner, loading) {
  btn.disabled = loading;
  spinner.classList.toggle('show', loading);
}

function showToast(el, message, type) {
  el.textContent = message;
  el.className   = `toast show toast-${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

function highlight(input) {
  input.style.borderColor = '#DE350B';
  input.focus();
  setTimeout(() => { input.style.borderColor = ''; }, 2000);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

loadSettings();
