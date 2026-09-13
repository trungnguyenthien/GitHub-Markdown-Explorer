/* ==========================================================================
   GitHub Markdown Explorer - Mobile-First Core Application Logic
   ========================================================================== */

// --- HELPER: Base64 UTF-8 Decoder (Vietnamese & Unicode support) ---
function base64ToUtf8(base64Str) {
  if (!base64Str) return '';
  try {
    const cleanB64 = base64Str.replace(/\s/g, '');
    const binaryStr = atob(cleanB64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    console.error('Base64 decode error:', e);
    try {
      return decodeURIComponent(escape(atob(base64Str.replace(/\s/g, ''))));
    } catch (fallbackErr) {
      console.error('Fallback decode error:', fallbackErr);
      return '';
    }
  }
}

// --- HELPER: Self-Contained Vanilla IndexedDB Helper ---
const miniIdb = {
  dbPromise: null,
  getDb() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('gh_md_explorer_db', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('cache');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  },
  async get(key) {
    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  },
  async set(key, val) {
    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {}
  },
  async del(key) {
    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {}
  },
  async getAll() {
    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }
};

function getIdb() {
  return miniIdb;
}

// --- GLOBAL APPLICATION STATE ---
const appState = {
  token: localStorage.getItem('gh_pat_token') || null,
  repos: [],
  currentRepo: null, // { owner, name, defaultBranch }
  currentPath: [], // Array of folder names
  currentTreeEntries: [], // All entries from recursive tree fetch
  currentFile: null, // { owner, name, path }
  currentFileContent: null, // Raw markdown string
  favoriteRepos: JSON.parse(localStorage.getItem('gh_favorite_repos') || '[]'),
  favoriteFiles: JSON.parse(localStorage.getItem('gh_favorite_files') || '[]'),
  readingHistory: JSON.parse(localStorage.getItem('gh_reading_history') || '[]'),
  mobileView: 'favPages', // 'favPages' | 'favRepos' | 'allRepos' | 'history' | 'reader' | 'tree' | 'viewer'
  previousView: 'favPages',
  isOffline: !navigator.onLine,
  fontScale: parseInt(localStorage.getItem('gh_font_scale') || '100', 10),
  isGuideOpen: false,
  activeGuideTab: 'pat',
  isRawView: false,
  syncStatus: {},
  hasUnsavedChanges: false,
  lastGistBackupTime: localStorage.getItem('gh_last_gist_backup_time') || null,
  autoGistBackupTimer: null
};

function markStateDirty() {
  appState.hasUnsavedChanges = true;
  updateGistAutoSyncStatus();
}

function updateGistAutoSyncStatus(statusMsg = null) {
  const el = document.getElementById('gistAutoSyncStatus');
  if (!el) return;

  if (!appState.token) {
    el.innerHTML = '<span style="color: var(--gh-text-muted);">Auto Sync: Disabled (PAT required)</span>';
    return;
  }

  let timeStr = 'Never';
  if (appState.lastGistBackupTime) {
    try {
      const date = new Date(appState.lastGistBackupTime);
      timeStr = date.toLocaleTimeString();
    } catch (e) {}
  }

  let statusBadge = '<span style="color: #2da44e; font-weight: 600;">Active (Every 1 min)</span>';
  if (statusMsg === 'Syncing...') {
    statusBadge = '<span style="color: #0969da; font-weight: 600;">Syncing...</span>';
  } else if (statusMsg === 'Failed') {
    statusBadge = '<span style="color: #cf222e; font-weight: 600;">Failed (Check PAT gist scope)</span>';
  } else if (statusMsg === 'Offline') {
    statusBadge = '<span style="color: #9a6700; font-weight: 600;">Paused (Offline)</span>';
  }

  let dirtyBadge = appState.hasUnsavedChanges
    ? ' <span style="color: #9a6700; font-size: 11px; font-weight: 600;">(Unsaved Changes)</span>'
    : ' <span style="color: #2da44e; font-size: 11px; font-weight: 600;">(Synced)</span>';

  el.innerHTML = `Auto Cloud Sync (Gist): ${statusBadge} | Last synced: <strong>${timeStr}</strong> ${dirtyBadge}`;
}

function initAutoGistBackup() {
  if (appState.autoGistBackupTimer) return;
  // Trigger initial backup check if token present
  if (appState.token && !appState.isOffline) {
    backupToGist(true);
  }
  // Schedule auto sync every 60 seconds (1 minute)
  appState.autoGistBackupTimer = setInterval(() => {
    if (appState.token && !appState.isOffline) {
      backupToGist(true);
    }
  }, 60000);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('online', handleNetworkChange);
  window.addEventListener('offline', handleNetworkChange);
  handleNetworkChange();
  requestPersistentStorage();

  // Handle Browser Back Button & Swipe-Back Gestures
  window.addEventListener('popstate', (event) => {
    if (appState.mobileView === 'viewer' || appState.mobileView === 'tree' || appState.currentPath.length > 0) {
      handleHeaderBack(true);
    } else if (event.state && event.state.view) {
      switchMobileView(event.state.view, true);
    }
  });

  // Register PWA Service Worker for 100% full offline mode
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('[PWA] Service Worker registered:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });
  }

  applyFontScale(appState.fontScale);

  if (window.mermaid) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default'
      });
    } catch (e) {
      console.warn('Mermaid init error:', e);
    }
  }

  if (appState.token) {
    showAppShell();
    loadRepos();
    initAutoGistBackup();
  } else {
    showPatCard();
  }
});

// --- UI NOTIFICATION FLASH ALERTS ---
function showFlash(message, type = 'info', duration = 3000) {
  const container = document.getElementById('flashContainer');
  const flash = document.createElement('div');
  flash.className = `gh-flash gh-flash-${type}`;
  flash.textContent = message;
  container.appendChild(flash);

  setTimeout(() => {
    flash.style.opacity = '0';
    flash.style.transition = 'opacity 0.3s ease';
    setTimeout(() => flash.remove(), 300);
  }, duration);
}

// --- NETWORK STATE HANDLING ---
function handleNetworkChange() {
  appState.isOffline = !navigator.onLine;
  const badge = document.getElementById('networkBadge');
  const btnSyncAll = document.getElementById('btnSyncAll');

  if (appState.isOffline) {
    badge.className = 'gh-badge gh-badge-secondary';
    badge.innerHTML = '<span class="badge-dot"></span> <span class="badge-text">Offline</span>';
    showFlash('You are offline (Offline Mode). Displaying cached version.', 'info');
    if (btnSyncAll) btnSyncAll.disabled = true;
  } else {
    badge.className = 'gh-badge gh-badge-success';
    badge.innerHTML = '<span class="badge-dot"></span> <span class="badge-text">Online</span>';
    if (btnSyncAll) btnSyncAll.disabled = false;
  }
}

// --- MOBILE VIEW SWITCHING & HEADER BACK BUTTON ---
function switchMobileView(targetView, skipPushState = false) {
  // Alias mapping for backward compatibility
  if (targetView === 'favorites') targetView = 'favPages';
  if (targetView === 'repos') targetView = 'allRepos';
  if (targetView === 'reader') targetView = 'viewer';

  if (appState.mobileView !== targetView) {
    appState.previousView = appState.mobileView;
  }
  appState.mobileView = targetView;

  if (!skipPushState) {
    try {
      history.pushState({ view: targetView, pathLength: appState.currentPath.length }, '', '#/' + targetView);
    } catch (e) {}
  }

  const viewFavPages = document.getElementById('viewFavPages');
  const viewFavRepos = document.getElementById('viewFavRepos');
  const viewAllRepos = document.getElementById('viewAllRepos');
  const viewHistory = document.getElementById('viewHistory');
  const viewTree = document.getElementById('viewTree');
  const viewViewer = document.getElementById('viewViewer');

  const navFavPages = document.getElementById('navBtnFavPages');
  const navFavRepos = document.getElementById('navBtnFavRepos');
  const navAllRepos = document.getElementById('navBtnAllRepos');
  const navHistory = document.getElementById('navBtnHistory');
  const navReader = document.getElementById('navBtnReader');

  // Hide all view panels
  if (viewFavPages) viewFavPages.classList.add('hidden');
  if (viewFavRepos) viewFavRepos.classList.add('hidden');
  if (viewAllRepos) viewAllRepos.classList.add('hidden');
  if (viewHistory) viewHistory.classList.add('hidden');
  if (viewTree) viewTree.classList.add('hidden');
  if (viewViewer) viewViewer.classList.add('hidden');

  // Remove active state from all bottom nav items
  if (navFavPages) navFavPages.classList.remove('active');
  if (navFavRepos) navFavRepos.classList.remove('active');
  if (navAllRepos) navAllRepos.classList.remove('active');
  if (navHistory) navHistory.classList.remove('active');
  if (navReader) navReader.classList.remove('active');

  // Activate target panel & bottom nav tab
  if (targetView === 'favPages') {
    if (viewFavPages) viewFavPages.classList.remove('hidden');
    if (navFavPages) navFavPages.classList.add('active');
    renderFavoritesList();
  } else if (targetView === 'favRepos') {
    if (viewFavRepos) viewFavRepos.classList.remove('hidden');
    if (navFavRepos) navFavRepos.classList.add('active');
    renderFavoritesList();
  } else if (targetView === 'allRepos') {
    if (viewAllRepos) viewAllRepos.classList.remove('hidden');
    if (navAllRepos) navAllRepos.classList.add('active');
    renderRepoList();
  } else if (targetView === 'history') {
    if (viewHistory) viewHistory.classList.remove('hidden');
    if (navHistory) navHistory.classList.add('active');
    renderHistoryList();
  } else if (targetView === 'viewer') {
    if (viewViewer) viewViewer.classList.remove('hidden');
    if (navReader) navReader.classList.add('active');
  } else if (targetView === 'tree') {
    if (viewTree) viewTree.classList.remove('hidden');
  }

  updateHeaderBackButton();
  updateRepoFavoriteStar();
  saveCurrentLocationState();
}

function updateHeaderBackButton() {
  const btnBack = document.getElementById('btnHeaderBack');
  const headerBrand = document.getElementById('headerBrand');

  if (appState.mobileView === 'viewer' || appState.mobileView === 'tree' || appState.currentPath.length > 0) {
    btnBack.classList.remove('hidden');
    headerBrand.classList.add('hidden');
  } else {
    btnBack.classList.add('hidden');
    headerBrand.classList.remove('hidden');
  }
}

function handleHeaderBack(isPopState = false) {
  if (!isPopState && window.history.length > 1) {
    history.back();
    return;
  }

  if (appState.mobileView === 'viewer') {
    const target = (appState.previousView && appState.previousView !== 'viewer') ? appState.previousView : (appState.currentRepo ? 'tree' : 'favPages');
    switchMobileView(target, true);
  } else if (appState.mobileView === 'tree') {
    if (appState.currentPath.length > 0) {
      navigateFolder('..', true);
    } else {
      const target = (appState.previousView === 'favRepos') ? 'favRepos' : 'allRepos';
      switchMobileView(target, true);
    }
  } else {
    switchMobileView('favPages', true);
  }
}

function saveCurrentLocationState() {
  try {
    const state = {
      view: appState.mobileView,
      currentRepo: appState.currentRepo,
      currentPath: appState.currentPath,
      currentFile: appState.currentFile
    };
    localStorage.setItem('gh_last_location_state', JSON.stringify(state));
  } catch (e) {}
}

async function restoreAppLocation() {
  let saved = null;
  try {
    const str = localStorage.getItem('gh_last_location_state');
    if (str) saved = JSON.parse(str);
  } catch (e) {}

  let hashView = window.location.hash ? window.location.hash.replace('#/', '') : null;
  if (hashView === 'favorites') hashView = 'favPages';
  if (hashView === 'repos') hashView = 'allRepos';
  if (hashView === 'reader') hashView = 'viewer';

  const targetView = (hashView && ['favPages', 'favRepos', 'allRepos', 'history', 'tree', 'viewer'].includes(hashView))
    ? hashView
    : (saved ? saved.view : 'favPages');

  if (saved) {
    if (saved.currentRepo) appState.currentRepo = saved.currentRepo;
    if (saved.currentPath) appState.currentPath = saved.currentPath;
    if (saved.currentFile) appState.currentFile = saved.currentFile;
  }

  if (targetView === 'viewer' && appState.currentFile) {
    switchMobileView('viewer', true);
    openMarkdownFile(appState.currentFile.owner, appState.currentFile.name, appState.currentFile.path);
  } else if (targetView === 'tree' && appState.currentRepo) {
    switchMobileView('tree', true);
    openRepo(appState.currentRepo.owner, appState.currentRepo.name, true);
  } else {
    switchMobileView(targetView || 'favPages', true);
  }
}

// --- LOGIC 1: PAT Entry & Connect ---
async function connectWithToken() {
  const input = document.getElementById('patInput');
  const errorDiv = document.getElementById('patError');
  const token = input.value.trim();

  if (!token) {
    errorDiv.textContent = 'Personal Access Token is required.';
    errorDiv.classList.remove('hidden');
    return;
  }

  errorDiv.classList.add('hidden');
  const btnConnect = document.getElementById('btnConnect');
  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting...';

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.status === 200) {
      const userData = await res.json();
      appState.token = token;
      localStorage.setItem('gh_pat_token', token);
      
      showFlash(`Welcome ${userData.login}! Connected successfully.`, 'success');
      showAppShell();
      loadRepos();
      initAutoGistBackup();
    } else if (res.status === 401) {
      errorDiv.textContent = 'Invalid or expired Personal Access Token.';
      errorDiv.classList.remove('hidden');
    } else {
      errorDiv.textContent = `Authentication error (HTTP ${res.status}).`;
      errorDiv.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Connect error:', err);
    errorDiv.textContent = 'Network error. Please check your connection.';
    errorDiv.classList.remove('hidden');
  } finally {
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect';
  }
}

function showPatCard() {
  document.getElementById('patEntryCard').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('mobileBottomNav').classList.add('hidden');
  document.getElementById('btnSettings').classList.add('hidden');
}

function showAppShell() {
  document.getElementById('patEntryCard').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('mobileBottomNav').classList.remove('hidden');
  document.getElementById('btnSettings').classList.remove('hidden');
  document.getElementById('btnSettings').onclick = disconnectToken;

  restoreAppLocation();
}

// --- LOGIC 11: Disconnect PAT ---
function disconnectToken() {
  if (confirm('Are you sure you want to disconnect PAT? Favorites and Cache will be preserved.')) {
    appState.token = null;
    localStorage.removeItem('gh_pat_token');
    localStorage.removeItem('gh_last_location_state');
    appState.repos = [];
    appState.currentRepo = null;
    appState.currentFile = null;
    appState.currentFileContent = null;
    showPatCard();
    showFlash('Token disconnected.', 'info');
  }
}

// --- LOGIC 2: Load Repositories ---
async function loadRepos() {
  const container = document.getElementById('repoListContainer');
  container.innerHTML = '<div class="blankslate"><p>Loading repository list...</p></div>';

  try {
    const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      appState.repos = data.map(r => ({
        owner: r.owner.login,
        name: r.name,
        description: r.description || '',
        updatedAt: r.updated_at,
        isPrivate: r.private
      }));

      renderRepoList();
      renderFavoritesList();
    } else {
      container.innerHTML = `<div class="blankslate"><p class="text-danger">Unable to load repositories (HTTP ${res.status}).</p></div>`;
    }
  } catch (err) {
    console.error('Load repos error:', err);
    container.innerHTML = '<div class="blankslate"><p class="text-danger">Connection error while loading repository list.</p></div>';
  }
}

function renderRepoList(filteredList = null) {
  const container = document.getElementById('repoListContainer');
  let list = filteredList || appState.repos;

  if (list.length === 0) {
    container.innerHTML = '<div class="blankslate"><p>No repositories found.</p></div>';
    return;
  }

  // Sort: Favorited repos on top
  list = [...list].sort((a, b) => {
    const aFav = isRepoFavorited(a.owner, a.name) ? 1 : 0;
    const bFav = isRepoFavorited(b.owner, b.name) ? 1 : 0;
    return bFav - aFav;
  });

  container.innerHTML = list.map(repo => {
    const isFav = isRepoFavorited(repo.owner, repo.name);
    const activeClass = appState.currentRepo && appState.currentRepo.owner === repo.owner && appState.currentRepo.name === repo.name ? 'active' : '';
    
    return `
      <div class="gh-action-item ${activeClass}" onclick="openRepo('${repo.owner}', '${repo.name}')">
        <div class="repo-item-main">
          <svg class="octicon octicon-repo text-muted" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25Z"></path>
          </svg>
          <div>
            <div class="repo-name">${repo.name}</div>
            ${repo.description ? `<div class="repo-desc">${repo.description}</div>` : ''}
          </div>
        </div>
        <button class="btn-star-icon ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation(); toggleFavoriteRepo('${repo.owner}', '${repo.name}')" title="Favorite">
          <svg class="octicon octicon-star" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

// --- LOGIC 3: Favorite Repo Toggles ---
function isRepoFavorited(owner, name) {
  return appState.favoriteRepos.some(r => r.owner === owner && r.name === name);
}

function toggleFavoriteRepo(owner, name) {
  const index = appState.favoriteRepos.findIndex(r => r.owner === owner && r.name === name);
  if (index > -1) {
    appState.favoriteRepos.splice(index, 1);
    showFlash(`Removed ${owner}/${name} from Favorites.`, 'info');
  } else {
    appState.favoriteRepos.push({ owner, name });
    showFlash(`Added ${owner}/${name} to Favorites!`, 'success');
  }

  localStorage.setItem('gh_favorite_repos', JSON.stringify(appState.favoriteRepos));
  markStateDirty();
  renderRepoList();
  renderFavoritesList();
  updateRepoFavoriteStar();
}

function toggleCurrentRepoFavorite() {
  if (!appState.currentRepo) return;
  const { owner, name } = appState.currentRepo;
  toggleFavoriteRepo(owner, name);
}

function updateRepoFavoriteStar() {
  const btn = document.getElementById('btnFavCurrentRepo');
  if (!btn) return;

  if (!appState.currentRepo) {
    btn.classList.add('hidden');
    return;
  }

  btn.classList.remove('hidden');
  const isFav = isRepoFavorited(appState.currentRepo.owner, appState.currentRepo.name);
  if (isFav) btn.classList.add('favorited');
  else btn.classList.remove('favorited');
}

// --- LOGIC 4: Open Repo & Fetch Tree ---
async function openRepo(owner, name, keepPath = false) {
  appState.currentRepo = { owner, name };
  if (!keepPath) {
    appState.currentPath = [];
  }
  renderRepoList();
  updateRepoFavoriteStar();
  
  switchMobileView('tree');

  const treeContainer = document.getElementById('fileTreeContainer');
  treeContainer.innerHTML = '<div class="blankslate"><p>Loading repository file tree...</p></div>';
  updateBreadcrumb();

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!repoRes.ok) throw new Error(`HTTP ${repoRes.status}`);
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch || 'main';
    appState.currentRepo.defaultBranch = defaultBranch;

    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/${defaultBranch}?recursive=1`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!treeRes.ok) throw new Error(`Tree HTTP ${treeRes.status}`);
    const treeData = await treeRes.json();

    appState.currentTreeEntries = treeData.tree || [];
    renderFileTree();
  } catch (err) {
    console.error('Open repo error:', err);
    treeContainer.innerHTML = '<div class="blankslate"><p class="text-danger">Unable to load file tree.</p></div>';
  }
}

// --- LOGIC 5: Navigate Folders & Render File Tree ---
function renderFileTree() {
  const container = document.getElementById('fileTreeContainer');
  const currentPathStr = appState.currentPath.join('/');
  
  const entries = appState.currentTreeEntries.filter(entry => {
    if (!currentPathStr) {
      return !entry.path.includes('/');
    } else {
      if (!entry.path.startsWith(currentPathStr + '/')) return false;
      const subPath = entry.path.slice(currentPathStr.length + 1);
      return !subPath.includes('/');
    }
  });

  if (entries.length === 0) {
    container.innerHTML = '<div class="blankslate"><p>This directory is empty.</p></div>';
    return;
  }

  entries.sort((a, b) => {
    if (a.type === b.type) return a.path.localeCompare(b.path);
    return a.type === 'tree' ? -1 : 1;
  });

  container.innerHTML = entries.map(entry => {
    const isFolder = entry.type === 'tree';
    const isMd = entry.path.endsWith('.md');
    const name = entry.path.split('/').pop();
    const isFav = isMd && appState.currentRepo ? isFileFavorited(appState.currentRepo.owner, appState.currentRepo.name, entry.path) : false;

    if (isFolder) {
      return `
        <div class="tree-row" onclick="navigateFolder('${name}')">
          <div class="tree-row-left">
            <svg class="octicon octicon-file-directory" viewBox="0 0 16 16" width="18" height="18" fill="#54a3ff">
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
            </svg>
            <span class="tree-name">${name}</span>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="tree-row ${isMd ? 'is-md' : ''}" onclick="${isMd ? `openMarkdownFile('${appState.currentRepo.owner}', '${appState.currentRepo.name}', '${entry.path}')` : ''}">
          <div class="tree-row-left">
            <svg class="octicon ${isMd ? 'octicon-file-code' : 'octicon-file'}" viewBox="0 0 16 16" width="18" height="18" fill="${isMd ? '#0969da' : '#656d76'}">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
            </svg>
            <span class="tree-name">${name}</span>
          </div>
          ${isMd ? `
            <button class="btn-star-icon ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation(); toggleFavoriteFile('${appState.currentRepo.owner}', '${appState.currentRepo.name}', '${entry.path}')" title="Favorite">
              <svg class="octicon octicon-star" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
              </svg>
            </button>
          ` : ''}
        </div>
      `;
    }
  }).join('');
}

function navigateFolder(folderName, skipPushState = false) {
  if (folderName === '..') {
    appState.currentPath.pop();
  } else {
    appState.currentPath.push(folderName);
  }
  if (!skipPushState) {
    try {
      history.pushState({ view: 'tree', pathLength: appState.currentPath.length }, '', '#/tree');
    } catch (e) {}
  }
  updateBreadcrumb();
  renderFileTree();
  updateHeaderBackButton();
  saveCurrentLocationState();
}

function updateBreadcrumb() {
  const container = document.getElementById('breadcrumb');
  if (!appState.currentRepo) {
    container.innerHTML = '<span class="text-muted">No repository selected</span>';
    return;
  }

  let html = `<span class="crumb-link" onclick="appState.currentPath=[]; updateBreadcrumb(); renderFileTree(); updateHeaderBackButton();">${appState.currentRepo.name}</span>`;
  
  let accumulatedPath = [];
  appState.currentPath.forEach((segment) => {
    accumulatedPath.push(segment);
    const pathSnap = [...accumulatedPath];
    html += ` / <span class="crumb-link" onclick="appState.currentPath=${JSON.stringify(pathSnap)}; updateBreadcrumb(); renderFileTree(); updateHeaderBackButton();">${segment}</span>`;
  });

  container.innerHTML = html;
}

// --- LOGIC 6: Open Markdown File ---
async function openMarkdownFile(owner, name, path) {
  appState.currentFile = { owner, name, path };
  saveCurrentLocationState();
  const fileKey = `${owner}/${name}/${path}`;

  addToHistory(owner, name, path);
  switchMobileView('viewer');

  document.getElementById('viewerFileName').textContent = path.split('/').pop();
  document.getElementById('linkOpenGithub').href = `https://github.com/${owner}/${name}/blob/${appState.currentRepo ? appState.currentRepo.defaultBranch || 'main' : 'main'}/${path}`;

  updateViewerFavoriteStar();
  const viewerPanel = document.getElementById('markdownViewerPanel');
  viewerPanel.innerHTML = '<p class="text-muted">Loading document...</p>';

  // Step 1: Check Cache
  let cached = null;
  try {
    cached = await getIdb().get(fileKey);
  } catch (err) { console.warn('Cache read error:', err); }

  if (cached && cached.content) {
    renderMarkdown(cached.content);
    updateFileSyncBadge('cached', cached.lastSyncedAt);
  }

  // Step 2: If Offline
  if (appState.isOffline) {
    if (!cached) {
      viewerPanel.innerHTML = '<div class="blankslate"><p class="text-danger">No network connection and no offline cached version available for this file.</p></div>';
    } else {
      showFlash('Viewing offline cached version.', 'info');
    }
    return;
  }

  // Step 3: Fetch GitHub API
  updateFileSyncBadge('syncing');

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${path}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      let rawContent = '';

      if (data.content) {
        rawContent = base64ToUtf8(data.content);
      }
      
      if (!rawContent && (data.download_url || data.sha)) {
        try {
          const rawRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${path}`, {
            headers: {
              'Authorization': `Bearer ${appState.token}`,
              'Accept': 'application/vnd.github.v3.raw'
            }
          });
          if (rawRes.ok) rawContent = await rawRes.text();
        } catch (rawErr) { console.warn('Raw fallback err:', rawErr); }
      }

      appState.currentFileContent = rawContent;

      if (!cached || cached.sha !== data.sha) {
        renderMarkdown(rawContent);
        if (isFileFavorited(owner, name, path)) {
          cacheFavoriteFile(owner, name, path, rawContent, data.sha);
        }
      }

      updateFileSyncBadge('synced', Date.now());
    } else {
      if (!cached) {
        const errorText = await res.text().catch(() => '');
        viewerPanel.innerHTML = `<div class="blankslate"><p class="text-danger">Unable to load file from GitHub (HTTP ${res.status}). ${errorText ? `<br><small>${errorText}</small>` : ''}</p></div>`;
      }
    }
  } catch (err) {
    console.error('Fetch markdown error:', err);
    if (!cached) {
      viewerPanel.innerHTML = `<div class="blankslate"><p class="text-danger">Connection error loading file: ${err.message || err}</p></div>`;
    }
  }
}

function updateFileSyncBadge(status) {
  const badge = document.getElementById('fileSyncBadge');
  if (status === 'synced') {
    badge.className = 'gh-badge gh-badge-success';
    badge.innerHTML = '🟢 Synced';
  } else if (status === 'syncing') {
    badge.className = 'gh-badge gh-badge-secondary';
    badge.innerHTML = '🟡 Syncing...';
  } else if (status === 'cached') {
    badge.className = 'gh-badge gh-badge-secondary';
    badge.innerHTML = '⚪ Cache';
  }
}

// --- LOGIC 7 & 8: Render Markdown, PlantUML & Mermaid ---
function renderMarkdown(rawContent) {
  appState.currentFileContent = rawContent;

  const renderer = new marked.Renderer();

  renderer.code = function(codeOrObj, languageStr) {
    let code = '';
    let lang = '';

    if (typeof codeOrObj === 'object' && codeOrObj !== null) {
      code = codeOrObj.text || '';
      lang = codeOrObj.lang || '';
    } else {
      code = codeOrObj || '';
      lang = languageStr || '';
    }

    lang = (lang || '').toLowerCase().trim();

    if (lang === 'mermaid') {
      const cleanMermaid = code
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      return `<div class="mermaid">${cleanMermaid}</div>`;
    } else if (lang === 'plantuml' || lang === 'puml') {
      const encoded = encodePlantUML(code);
      const url = `https://www.plantuml.com/plantuml/svg/${encoded}`;
      return `
        <div class="plantuml-diagram">
          <img src="${url}" alt="PlantUML Diagram" onerror="this.onerror=null; this.replaceWith('PlantUML diagram failed to render.');">
        </div>
      `;
    }

    return `<pre><code class="hljs language-${lang}">${code}</code></pre>`;
  };

  marked.setOptions({ renderer });
  const rawHtml = marked.parse(rawContent);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['div', 'img'],
    ADD_ATTR: ['src', 'alt', 'class']
  });

  const viewerPanel = document.getElementById('markdownViewerPanel');
  const rawPanel = document.getElementById('rawMarkdownPanel');

  viewerPanel.innerHTML = cleanHtml;
  rawPanel.textContent = rawContent;

  if (window.mermaid) {
    try {
      const mNodes = viewerPanel.querySelectorAll('.mermaid');
      if (mNodes.length > 0) {
        mermaid.run({
          nodes: Array.from(mNodes)
        }).catch(mErr => console.warn('Mermaid async run err:', mErr));
      }
    } catch (mErr) { console.warn('Mermaid warning:', mErr); }
  }

  viewerPanel.querySelectorAll('pre code').forEach((block) => {
    if (window.hljs && typeof window.hljs.highlightElement === 'function') {
      try { window.hljs.highlightElement(block); } catch (e) {}
    }
  });

  applyFontScale(appState.fontScale);
}

function encodePlantUML(sourceText) {
  if (!sourceText) return '';
  try {
    const utf8Bytes = new TextEncoder().encode(sourceText);
    const compressed = pako.deflateRaw(utf8Bytes);
    return encode64(compressed);
  } catch (err) {
    console.error('PlantUML encode error:', err);
    return '';
  }
}

function encode64(data) {
  let r = "";
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 < data.length) {
      r += append3bytes(data[i], data[i + 1], data[i + 2]);
    } else if (i + 1 < data.length) {
      r += append3bytes(data[i], data[i + 1], 0);
    } else {
      r += append3bytes(data[i], 0, 0);
    }
  }
  return r;
}

function append3bytes(b1, b2, b3) {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xF) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3F;
  return encode6bit(c1 & 0x3F) + encode6bit(c2 & 0x3F) + encode6bit(c3 & 0x3F) + encode6bit(c4 & 0x3F);
}

function encode6bit(b) {
  if (b < 10) return String.fromCharCode(48 + b);
  b -= 10;
  if (b < 26) return String.fromCharCode(65 + b);
  b -= 26;
  if (b < 26) return String.fromCharCode(97 + b);
  b -= 26;
  if (b === 0) return '-';
  if (b === 1) return '_';
  return '?';
}

function toggleRawView() {
  appState.isRawView = !appState.isRawView;
  const viewerPanel = document.getElementById('markdownViewerPanel');
  const rawPanel = document.getElementById('rawMarkdownPanel');
  const btnToggle = document.getElementById('btnToggleRaw');

  if (appState.isRawView) {
    viewerPanel.classList.add('hidden');
    rawPanel.classList.remove('hidden');
    btnToggle.textContent = 'Preview';
  } else {
    viewerPanel.classList.remove('hidden');
    rawPanel.classList.add('hidden');
    btnToggle.textContent = 'Raw';
  }
}

// --- LOGIC 9 & 12: Favorite Files & Auto-cache ---
function isFileFavorited(owner, name, path) {
  return appState.favoriteFiles.some(f => f.owner === owner && f.name === name && f.path === path);
}

function toggleCurrentFileFavorite() {
  if (!appState.currentFile) return;
  const { owner, name, path } = appState.currentFile;
  toggleFavoriteFile(owner, name, path);
}

async function toggleFavoriteFile(owner, name, path) {
  const index = appState.favoriteFiles.findIndex(f => f.owner === owner && f.name === name && f.path === path);
  const fileKey = `${owner}/${name}/${path}`;

  if (index > -1) {
    appState.favoriteFiles.splice(index, 1);
    try { await getIdb().del(fileKey); } catch (err) {}
    showFlash('Removed file from Favorites.', 'info');
  } else {
    appState.favoriteFiles.push({ owner, name, path });
    showFlash('Added file to Favorites & Cached offline!', 'success');
    
    if (appState.currentFileContent && appState.currentFile && appState.currentFile.path === path) {
      cacheFavoriteFile(owner, name, path, appState.currentFileContent);
    } else {
      cacheFavoriteFile(owner, name, path);
    }
  }

  localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  markStateDirty();
  updateViewerFavoriteStar();
  renderFavoritesList();
  if (appState.mobileView === 'tree') renderFileTree();
  if (appState.mobileView === 'history') renderHistoryList();
}

async function cacheFavoriteFile(owner, name, path, content = null, sha = '') {
  const fileKey = `${owner}/${name}/${path}`;
  
  if (content) {
    const data = { fileKey, owner, name, path, content, sha, lastSyncedAt: Date.now() };
    await getIdb().set(fileKey, data);
    markStateDirty();
    return;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${path}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const fileData = await res.json();
      const raw = base64ToUtf8(fileData.content);
      const data = { fileKey, owner, name, path, content: raw, sha: fileData.sha, lastSyncedAt: Date.now() };
      await getIdb().set(fileKey, data);
    }
  } catch (err) { console.error('Cache favorite err:', err); }
}

function updateViewerFavoriteStar() {
  if (!appState.currentFile) return;
  const { owner, name, path } = appState.currentFile;
  const isFav = isFileFavorited(owner, name, path);
  const btn = document.getElementById('btnFavCurrentFile');
  if (btn) {
    if (isFav) btn.classList.add('favorited');
    else btn.classList.remove('favorited');
  }
}

async function renderFavoritesList() {
  const favFilesContainer = document.getElementById('favFilesContainer');
  const favReposContainer = document.getElementById('favReposContainer');

  if (!favFilesContainer || !favReposContainer) return;

  if (appState.favoriteFiles.length === 0) {
    favFilesContainer.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>No favorite pages yet.</p></div>';
  } else {
    const fileItemsHtml = await Promise.all(appState.favoriteFiles.map(async file => {
      const cleanRepoName = (file.name || '').includes('/') ? file.name.split('/').pop() : file.name;
      const fileKey = `${file.owner}/${cleanRepoName}/${file.path}`;
      let syncText = '';
      try {
        const cached = await getIdb().get(fileKey);
        if (cached && cached.lastSyncedAt) {
          syncText = ` • <span class="text-muted">Synced ${formatTimeAgo(cached.lastSyncedAt)}</span>`;
        }
      } catch (e) {}

      const isFav = isFileFavorited(file.owner, file.name, file.path);
      return `
        <div class="gh-action-item" onclick="openMarkdownFile('${file.owner}', '${file.name}', '${file.path}')">
          <div class="repo-item-main">
            <svg class="octicon octicon-file-code text-muted" viewBox="0 0 16 16" width="18" height="18" fill="#0969da">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
            </svg>
            <div>
              <div class="repo-name">${file.path.split('/').pop()}</div>
              <div class="repo-desc">${cleanRepoName}${syncText}</div>
            </div>
          </div>
          <button class="btn-star-icon favorited" onclick="event.stopPropagation(); toggleFavoriteFile('${file.owner}', '${file.name}', '${file.path}')" title="Favorite">
            <svg class="octicon octicon-star" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
              <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
            </svg>
          </button>
        </div>
      `;
    }));
    favFilesContainer.innerHTML = fileItemsHtml.join('');
  }

  if (appState.favoriteRepos.length === 0) {
    favReposContainer.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>No favorite repositories yet.</p></div>';
  } else {
    favReposContainer.innerHTML = appState.favoriteRepos.map(repo => {
      const cleanRepoName = (repo.name || '').includes('/') ? repo.name.split('/').pop() : repo.name;
      return `
        <div class="gh-action-item" onclick="openRepo('${repo.owner}', '${repo.name}')">
          <div class="repo-item-main">
            <svg class="octicon octicon-repo text-muted" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
              <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25Z"></path>
            </svg>
            <div class="repo-name">${cleanRepoName}</div>
          </div>
          <button class="btn-star-icon favorited" onclick="event.stopPropagation(); toggleFavoriteRepo('${repo.owner}', '${repo.name}')" title="Favorite">
            <svg class="octicon octicon-star" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
              <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  }
}

// --- LOGIC 13: Sync Favorites ---
function setSyncSpinning(isSpinning) {
  const btnSyncAll = document.getElementById('btnSyncAll');
  const btnSyncCurrent = document.getElementById('btnSyncCurrentFile');

  [btnSyncAll, btnSyncCurrent].forEach(btn => {
    if (!btn) return;
    const icon = btn.querySelector('.octicon-sync');
    if (isSpinning) {
      if (icon) icon.classList.add('is-spinning');
      btn.disabled = true;
    } else {
      if (icon) icon.classList.remove('is-spinning');
      btn.disabled = false;
    }
  });
}

async function syncCurrentFile() {
  if (!appState.currentFile) return;
  const { owner, name, path } = appState.currentFile;
  await syncFavoriteFile(owner, name, path);
}

async function syncFavoriteFile(owner, name, path) {
  if (appState.isOffline) {
    showFlash('Cannot sync while offline.', 'info');
    return;
  }

  setSyncSpinning(true);
  updateFileSyncBadge('syncing');

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${path}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const rawContent = base64ToUtf8(data.content);
      
      await cacheFavoriteFile(owner, name, path, rawContent, data.sha);
      
      if (appState.currentFile && appState.currentFile.path === path) {
        renderMarkdown(rawContent);
      }
      
      updateFileSyncBadge('synced', Date.now());
      renderFavoritesList();
    } else {
      updateFileSyncBadge('cached');
    }
  } catch (err) {
    console.error('Sync file error:', err);
    updateFileSyncBadge('cached');
  } finally {
    setSyncSpinning(false);
  }
}

async function syncAllFavorites() {
  if (appState.isOffline) {
    showFlash('Cannot sync while offline.', 'info');
    return;
  }

  if (appState.favoriteFiles.length === 0) {
    return;
  }

  setSyncSpinning(true);

  try {
    const promises = appState.favoriteFiles.map(f => syncFavoriteFile(f.owner, f.name, f.path));
    await Promise.allSettled(promises);
    renderFavoritesList();
  } finally {
    setSyncSpinning(false);
  }
}

// --- LOGIC: Reading History ---
function addToHistory(owner, name, path) {
  appState.readingHistory = appState.readingHistory.filter(
    h => !(h.owner === owner && h.name === name && h.path === path)
  );
  appState.readingHistory.unshift({
    owner,
    name,
    path,
    readAt: Date.now()
  });
  if (appState.readingHistory.length > 100) {
    appState.readingHistory = appState.readingHistory.slice(0, 100);
  }
  localStorage.setItem('gh_reading_history', JSON.stringify(appState.readingHistory));
  markStateDirty();
  renderHistoryList();
}

function renderHistoryList() {
  const container = document.getElementById('historyFilesContainer');
  if (!container) return;

  if (appState.readingHistory.length === 0) {
    container.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>No reading history yet.</p></div>';
    return;
  }

  container.innerHTML = appState.readingHistory.map(file => {
    const timeAgo = formatTimeAgo(file.readAt);
    const isFav = isFileFavorited(file.owner, file.name, file.path);
    const cleanRepoName = (file.name || '').includes('/') ? file.name.split('/').pop() : file.name;

    return `
      <div class="gh-action-item" onclick="openMarkdownFile('${file.owner}', '${file.name}', '${file.path}')">
        <div class="repo-item-main">
          <svg class="octicon octicon-history text-muted" viewBox="0 0 16 16" width="18" height="18" fill="#0969da">
            <path d="m.427 1.927 1.215 1.215a8.002 8.002 0 1 1-1.6 5.685.75.75 0 1 1 1.493-.154 6.5 6.5 0 1 0 1.3-4.623l1.393 1.393a.75.75 0 0 1-.53 1.284H.75A.75.75 0 0 1 0 5.927V3.18a.75.75 0 0 1 1.28-.53l-.853-.723ZM8 4.5a.75.75 0 0 1 .75.75v3.19l2.22 2.22a.75.75 0 0 1-1.06 1.06l-2.5-2.5A.75.75 0 0 1 7.25 8.5V5.25A.75.75 0 0 1 8 4.5Z"></path>
          </svg>
          <div>
            <div class="repo-name">${file.path.split('/').pop()}</div>
            <div class="repo-desc">${cleanRepoName} • <span class="text-muted">${timeAgo}</span></div>
          </div>
        </div>
        <button class="btn-star-icon ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation(); toggleFavoriteFile('${file.owner}', '${file.name}', '${file.path}')" title="Favorite">
          <svg class="octicon octicon-star" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

function clearHistory() {
  if (confirm('Are you sure you want to clear reading history?')) {
    appState.readingHistory = [];
    localStorage.removeItem('gh_reading_history');
    renderHistoryList();
    showFlash('Reading history cleared.', 'info');
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

// --- LOGIC 10: Filtering ---
function filterList(query) {
  const q = query.toLowerCase().trim();

  if (appState.mobileView === 'allRepos' || appState.mobileView === 'repos') {
    const filtered = appState.repos.filter(r => 
      r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
    renderRepoList(filtered);
  } else if (appState.mobileView === 'favPages') {
    const container = document.getElementById('favFilesContainer');
    if (container) {
      const items = container.querySelectorAll('.gh-action-item');
      items.forEach(item => {
        if (item.textContent.toLowerCase().includes(q)) item.classList.remove('hidden');
        else item.classList.add('hidden');
      });
    }
  } else if (appState.mobileView === 'favRepos') {
    const container = document.getElementById('favReposContainer');
    if (container) {
      const items = container.querySelectorAll('.gh-action-item');
      items.forEach(item => {
        if (item.textContent.toLowerCase().includes(q)) item.classList.remove('hidden');
        else item.classList.add('hidden');
      });
    }
  } else if (appState.mobileView === 'history') {
    const container = document.getElementById('historyFilesContainer');
    if (container) {
      const items = container.querySelectorAll('.gh-action-item');
      items.forEach(item => {
        if (item.textContent.toLowerCase().includes(q)) item.classList.remove('hidden');
        else item.classList.add('hidden');
      });
    }
  }
}

// --- LOGIC 15: Document Font Zoom Scaling ---
function changeFontScale(deltaOrValue) {
  if (deltaOrValue === 100) {
    appState.fontScale = 100;
  } else {
    appState.fontScale = Math.min(200, Math.max(75, appState.fontScale + deltaOrValue));
  }

  applyFontScale(appState.fontScale);
  localStorage.setItem('gh_font_scale', appState.fontScale.toString());
}

function applyFontScale(scale) {
  document.documentElement.style.setProperty('--md-content-scale', (scale / 100).toString());
  const badge = document.getElementById('zoomScaleBadge');
  if (badge) badge.textContent = `${scale}%`;
}

// --- LOGIC 16: User Guide & PAT Help Modal ---
function toggleGuideModal(isOpen, initialTab = 'pat') {
  appState.isGuideOpen = isOpen;
  const modal = document.getElementById('helpGuideModal');
  
  if (isOpen) {
    modal.classList.remove('hidden');
    switchGuideTab(initialTab);
  } else {
    modal.classList.add('hidden');
  }
}

function switchGuideTab(tabName) {
  appState.activeGuideTab = tabName;

  const tabPat = document.getElementById('tabGuidePat');
  const tabFeatures = document.getElementById('tabGuideFeatures');
  const tabBackup = document.getElementById('tabGuideBackup');

  const contentPat = document.getElementById('guidePatContent');
  const contentFeatures = document.getElementById('guideFeaturesContent');
  const contentBackup = document.getElementById('guideBackupContent');

  [tabPat, tabFeatures, tabBackup].forEach(t => t && t.classList.remove('active'));
  [contentPat, contentFeatures, contentBackup].forEach(c => c && c.classList.add('hidden'));

  if (tabName === 'pat') {
    if (tabPat) tabPat.classList.add('active');
    if (contentPat) contentPat.classList.remove('hidden');
  } else if (tabName === 'features') {
    if (tabFeatures) tabFeatures.classList.add('active');
    if (contentFeatures) contentFeatures.classList.remove('hidden');
  } else if (tabName === 'backup') {
    if (tabBackup) tabBackup.classList.add('active');
    if (contentBackup) contentBackup.classList.remove('hidden');
    updateStorageStatusUI();
    updateGistAutoSyncStatus();
  }
}

// --- LOGIC 17: Storage Protection & Data Backup/Restore ---
async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    updateStorageStatusUI(isPersisted);
    if (isPersisted) {
      console.log('[Storage] Persistent storage granted.');
    }
    return isPersisted;
  }
  return false;
}

async function updateStorageStatusUI(isPersisted = null) {
  const statusEl = document.getElementById('storageProtectionStatus');
  if (!statusEl) return;

  if (isPersisted === null && navigator.storage && navigator.storage.persisted) {
    isPersisted = await navigator.storage.persisted();
  }

  if (isPersisted) {
    statusEl.innerHTML = '🟢 <strong style="color:#1a7f37;">Protected (Persistent)</strong> - Browser will never auto-delete your cache.';
  } else {
    statusEl.innerHTML = '🟡 <strong style="color:#9a6700;">Best-Effort Storage</strong> - May be evicted if disk is full. Click below to request lifetime persistence.';
  }
}

async function exportAppData() {
  try {
    const cachedFiles = await miniIdb.getAll();
    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      token: appState.token,
      favoriteRepos: appState.favoriteRepos,
      favoriteFiles: appState.favoriteFiles,
      readingHistory: appState.readingHistory,
      fontScale: appState.fontScale,
      cachedFiles: cachedFiles
    };

    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gh_explorer_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showFlash('Backup JSON file exported successfully!', 'success');
  } catch (err) {
    console.error('Export error:', err);
    showFlash('Failed to export backup data.', 'info');
  }
}

async function importAppData(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data || (!data.favoriteRepos && !data.favoriteFiles && !data.token && !data.cachedFiles)) {
      throw new Error('Invalid backup file format.');
    }

    if (data.token) {
      appState.token = data.token;
      localStorage.setItem('gh_pat_token', data.token);
    }

    // 1. Smart Merge Favorite Repositories (Deduplicate)
    if (Array.isArray(data.favoriteRepos)) {
      const mergedReposMap = new Map();
      appState.favoriteRepos.concat(data.favoriteRepos).forEach(r => {
        if (r && r.owner && r.name) {
          const key = `${r.owner}/${r.name}`;
          mergedReposMap.set(key, r);
        }
      });
      appState.favoriteRepos = Array.from(mergedReposMap.values());
      localStorage.setItem('gh_favorite_repos', JSON.stringify(appState.favoriteRepos));
    }

    // 2. Smart Merge Favorite Files (Deduplicate)
    if (Array.isArray(data.favoriteFiles)) {
      const mergedFilesMap = new Map();
      appState.favoriteFiles.concat(data.favoriteFiles).forEach(f => {
        if (f && f.owner && f.name && f.path) {
          const key = `${f.owner}/${f.name}/${f.path}`;
          mergedFilesMap.set(key, f);
        }
      });
      appState.favoriteFiles = Array.from(mergedFilesMap.values());
      localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
    }

    // 3. Smart Merge Reading History (Deduplicate & keep newest timestamp)
    if (Array.isArray(data.readingHistory)) {
      const mergedHistMap = new Map();
      appState.readingHistory.concat(data.readingHistory).forEach(h => {
        if (h && h.owner && h.name && h.path) {
          const key = `${h.owner}/${h.name}/${h.path}`;
          const existing = mergedHistMap.get(key);
          if (!existing || (h.readAt || 0) > (existing.readAt || 0)) {
            mergedHistMap.set(key, h);
          }
        }
      });
      appState.readingHistory = Array.from(mergedHistMap.values())
        .sort((a, b) => (b.readAt || 0) - (a.readAt || 0))
        .slice(0, 100);
      localStorage.setItem('gh_reading_history', JSON.stringify(appState.readingHistory));
    }

    if (data.fontScale) {
      appState.fontScale = data.fontScale;
      localStorage.setItem('gh_font_scale', data.fontScale.toString());
      applyFontScale(data.fontScale);
    }

    // 4. Smart Merge Cached Files in IndexedDB (keep newest content version)
    if (Array.isArray(data.cachedFiles)) {
      for (const item of data.cachedFiles) {
        if (item && item.fileKey) {
          const existing = await getIdb().get(item.fileKey);
          if (!existing || (item.lastSyncedAt || 0) >= (existing.lastSyncedAt || 0)) {
            await getIdb().set(item.fileKey, item);
          }
        }
      }
    }

    renderRepoList();
    renderFavoritesList();
    renderHistoryList();
    showFlash('Backup merged & data restored successfully!', 'success');
  } catch (err) {
    console.error('Import error:', err);
    showFlash(`Import failed: ${err.message || 'Invalid file'}`, 'info');
  }
}

function handleImportBackupFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    importAppData(e.target.result);
    event.target.value = '';
  };
  reader.readAsText(file);
}

async function backupToGist(isSilent = false) {
  if (!appState.token) {
    if (!isSilent) showFlash('Personal Access Token required for Gist cloud sync.', 'info');
    updateGistAutoSyncStatus();
    return;
  }

  if (appState.isOffline) {
    if (!isSilent) showFlash('Cannot sync Gist while offline.', 'info');
    updateGistAutoSyncStatus('Offline');
    return;
  }

  if (isSilent && !appState.hasUnsavedChanges) {
    return;
  }

  if (!isSilent) {
    showFlash('Syncing backup to GitHub Private Gist...', 'info');
  }
  updateGistAutoSyncStatus('Syncing...');

  try {
    const cachedFiles = await miniIdb.getAll();
    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      favoriteRepos: appState.favoriteRepos,
      favoriteFiles: appState.favoriteFiles,
      readingHistory: appState.readingHistory,
      fontScale: appState.fontScale,
      cachedFiles: cachedFiles
    };

    const gistsRes = await fetch('https://api.github.com/gists', {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!gistsRes.ok) throw new Error(`HTTP ${gistsRes.status}`);
    const gists = await gistsRes.json();
    const existingGist = gists.find(g => g.description === 'GH Markdown Explorer Backup Data');

    const gistPayload = {
      description: 'GH Markdown Explorer Backup Data',
      public: false,
      files: {
        'gh_explorer_backup.json': {
          content: JSON.stringify(backupData, null, 2)
        }
      }
    };

    let saveRes;
    if (existingGist) {
      saveRes = await fetch(`https://api.github.com/gists/${existingGist.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${appState.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(gistPayload)
      });
    } else {
      saveRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${appState.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(gistPayload)
      });
    }

    if (saveRes.ok) {
      appState.hasUnsavedChanges = false;
      appState.lastGistBackupTime = new Date().toISOString();
      localStorage.setItem('gh_last_gist_backup_time', appState.lastGistBackupTime);
      updateGistAutoSyncStatus();
      if (!isSilent) {
        showFlash('Backed up to GitHub Private Gist successfully!', 'success');
      }
    } else {
      const errTxt = await saveRes.text();
      throw new Error(`HTTP ${saveRes.status} ${errTxt}`);
    }
  } catch (err) {
    console.error('Gist backup error:', err);
    updateGistAutoSyncStatus('Failed');
    if (!isSilent) {
      showFlash(`Cloud backup failed: Ensure PAT has 'gist' scope.`, 'info');
    }
  }
}

async function restoreFromGist() {
  if (!appState.token) {
    showFlash('Personal Access Token required.', 'info');
    return;
  }
  showFlash('Fetching cloud backup from GitHub Gist...', 'info');

  try {
    const gistsRes = await fetch('https://api.github.com/gists', {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!gistsRes.ok) throw new Error(`HTTP ${gistsRes.status}`);
    const gists = await gistsRes.json();
    const backupGist = gists.find(g => g.description === 'GH Markdown Explorer Backup Data');

    if (!backupGist || !backupGist.files['gh_explorer_backup.json']) {
      showFlash('No GitHub Gist backup found for this account.', 'info');
      return;
    }

    const rawUrl = backupGist.files['gh_explorer_backup.json'].raw_url;
    const contentRes = await fetch(rawUrl);
    if (!contentRes.ok) throw new Error('Failed to download Gist content.');
    const jsonStr = await contentRes.text();

    await importAppData(jsonStr);
    showFlash('Restored from GitHub Private Gist successfully!', 'success');
  } catch (err) {
    console.error('Gist restore error:', err);
    showFlash(`Cloud restore failed: ${err.message}`, 'info');
  }
}
