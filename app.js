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

// --- HELPER: UTF-8 to Base64 Encoder (Vietnamese & Unicode support) ---
function utf8ToBase64(str) {
  if (!str) return '';
  try {
    const bytes = new TextEncoder().encode(str);
    let binaryStr = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binaryStr += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binaryStr);
  } catch (e) {
    console.error('Base64 encode error:', e);
    return btoa(unescape(encodeURIComponent(str)));
  }
}

function getParentDirPath(filePath) {
  if (!filePath) return '/';
  const parts = filePath.split('/');
  if (parts.length <= 1) return '/';
  parts.pop();
  return parts.join('/');
}

// --- HELPER: Safely encode path segments for GitHub REST API (preserving directory slashes) ---
function encodeGitPath(path) {
  if (!path) return '';
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

// --- HELPER: Detect if a text string is actually raw GitHub API JSON metadata ---
function isGitHubApiJson(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      if (obj.sha && (obj.download_url !== undefined || obj.git_url !== undefined || obj.html_url !== undefined || obj.type === 'file')) {
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// --- HELPER: Extract genuine file content from GitHub API response or fallback ---
async function resolveFileRawContent(data, owner, name, path) {
  if (!data) return '';

  // 1. If file has size 0 or empty base64 content, it is legitimately empty (0 bytes)
  if (data.size === 0 || (data.content === '' && data.encoding === 'base64')) {
    return '';
  }

  // 2. Standard GitHub contents API (files <= 1MB) returns base64 content
  if (typeof data.content === 'string' && data.content.length > 0) {
    return base64ToUtf8(data.content);
  }

  // 3. For large files (> 1MB) or if content was omitted by GitHub:
  let rawContent = '';

  // 3a. Try fetching directly from download_url (raw.githubusercontent.com)
  if (data.download_url) {
    try {
      const headers = {};
      if (appState.token) {
        headers['Authorization'] = `Bearer ${appState.token}`;
      }
      const dlRes = await fetch(data.download_url, { headers });
      if (dlRes.ok) {
        const text = await dlRes.text();
        if (!isGitHubApiJson(text)) {
          return text;
        }
      }
    } catch (e) {
      console.warn('Fallback download_url failed:', e);
    }
  }

  // 3b. Try fetching blob directly via Git Data Blobs API (supports up to 100MB)
  if (data.sha) {
    try {
      const blobRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/blobs/${data.sha}`, {
        headers: {
          'Authorization': `Bearer ${appState.token}`,
          'Accept': 'application/vnd.github.v3.raw'
        }
      });
      if (blobRes.ok) {
        const text = await blobRes.text();
        if (!isGitHubApiJson(text)) {
          return text;
        }
      }
    } catch (e) {
      console.warn('Fallback blob raw failed:', e);
    }
  }

  // 3c. Try fetching contents API with raw Accept header
  try {
    const rawRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3.raw'
      }
    });
    if (rawRes.ok) {
      const text = await rawRes.text();
      if (!isGitHubApiJson(text)) {
        return text;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed.size === 0) return '';
        if (parsed.content) return base64ToUtf8(parsed.content);
      } catch (e) {}
    }
  } catch (rawErr) {
    console.warn('Fallback contents raw failed:', rawErr);
  }

  return rawContent;
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
  currentFileSha: null, // GitHub blob SHA of currently opened file
  isEditing: false,
  editorTab: 'write', // 'write' | 'preview'
  editorOriginalContent: '',
  isPushingCommit: false,
  favGroups: JSON.parse(localStorage.getItem('gh_fav_groups') || '["All"]'),
  activeFavGroup: 'All',
  favoriteRepos: JSON.parse(localStorage.getItem('gh_favorite_repos') || '[]'),
  favoriteFiles: JSON.parse(localStorage.getItem('gh_favorite_files') || '[]'),
  readingHistory: JSON.parse(localStorage.getItem('gh_reading_history') || '[]'),
  mobileView: 'favPages', // 'favPages' | 'favRepos' | 'allRepos' | 'history' | 'reader' | 'tree' | 'viewer'
  previousView: 'favPages',
  isOffline: !navigator.onLine,
  fontScale: parseInt(localStorage.getItem('gh_font_scale') || '100', 10),
  isSelectionLocked: true,
  isGuideOpen: false,
  activeGuideTab: 'pat',
  isRawView: false,
  syncStatus: {},
  hasUnsavedChanges: false,
  lastGistBackupTime: localStorage.getItem('gh_last_gist_backup_time') || null,
  autoGistBackupTimer: null,
  readerHeadings: []
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFavGroups() {
  if (!Array.isArray(appState.favGroups) || appState.favGroups.length === 0) {
    appState.favGroups = ['All'];
  }
  if (!appState.favGroups.includes('All')) {
    appState.favGroups.unshift('All');
  }
  localStorage.setItem('gh_fav_groups', JSON.stringify(appState.favGroups));

  let filesChanged = false;
  if (Array.isArray(appState.favoriteFiles)) {
    appState.favoriteFiles.forEach(file => {
      if (!Array.isArray(file.groups) || file.groups.length === 0) {
        file.groups = ['All'];
        filesChanged = true;
      } else if (!file.groups.includes('All')) {
        file.groups.unshift('All');
        filesChanged = true;
      }
    });
  }
  if (filesChanged) {
    localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  }
}
sanitizeFavGroups();

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
    if (appState.isEditing) {
      if (!confirmDiscardEditorChanges()) {
        try {
          history.pushState({ view: 'viewer', pathLength: appState.currentPath.length }, '', '#/viewer');
        } catch (e) {}
        return;
      }
      exitEditModeUI();
      try {
        history.pushState({ view: 'viewer', pathLength: appState.currentPath.length }, '', '#/viewer');
      } catch (e) {}
      return;
    }
    if (appState.mobileView === 'viewer' || appState.mobileView === 'tree' || appState.currentPath.length > 0) {
      handleHeaderBack(true);
    } else if (event.state && event.state.view) {
      switchMobileView(event.state.view, true);
    }
  });

  // Warn before closing/reloading browser tab if editor has unsaved edits
  window.addEventListener('beforeunload', (e) => {
    if (appState.isEditing && hasEditorUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Register PWA Service Worker & Handle Updates (PWA Standards Rule 3, 5, 6D)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
      console.log('[PWA] Service Worker registered:', reg.scope);

      // If a worker is already waiting, show update banner
      if (reg.waiting) {
        promptPwaUpdate(reg.waiting);
      }

      // Listen for new worker installing
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              promptPwaUpdate(newWorker);
            }
          });
        }
      });

      // Auto-check for updates on load, tab focus, and visibility change
      reg.update();
      window.addEventListener('focus', () => reg.update());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });

    // Reload page when a new Service Worker takes control after user confirmation
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }

  // Initialize PWA Install Flow (Rule 6)
  initPWAInstallFlow();

  // Global Escape & Ctrl/Cmd+S key listener (Rule 10)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleGuideModal(false);
      closeManagePageGroupsModal();
      toggleIosInstallModal(false);
      toggleTocModal(false);
      closeTtsLanguageModal();
      closeCommitPushModal();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      if (appState.isEditing) {
        e.preventDefault();
        openCommitPushModal();
      }
    }
  });

  initMarkdownEditorListeners();

  applyFontScale(appState.fontScale);
  applyLockSelect();

  // Code Block Copy Button Listener (Event Delegation)
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy-code');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      handleCopyCodeBlock(copyBtn);
    }
  });

  if (window.mermaid) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default',
        fontSize: 14,
        flowchart: { htmlLabels: true },
        sequence: { showSequenceNumbers: false }
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

  if (targetView !== 'viewer' && appState.isEditing) {
    if (!confirmDiscardEditorChanges()) {
      return;
    }
    exitEditModeUI();
  }

  if (targetView !== 'viewer' && typeof ttsStop === 'function' && typeof ttsState !== 'undefined' && ttsState.active) {
    ttsStop();
  }

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
  const headerViewerGroup = document.getElementById('headerViewerGroup');

  if (appState.mobileView === 'viewer') {
    btnBack.classList.remove('hidden');
    headerBrand.classList.add('hidden');
    if (headerViewerGroup) headerViewerGroup.classList.remove('hidden');
    if (appState.currentFile) {
      const { name, path } = appState.currentFile;
      const cleanRepoName = (name || '').includes('/') ? name.split('/').pop() : name;
      const fileName = path ? path.split('/').pop() : 'Document';
      const parentPath = getParentDirPath(path || '');
      const repoPathDesc = parentPath ? `[${cleanRepoName}]:[${parentPath}]` : `[${cleanRepoName}]`;
      const headerViewerTitleEl = document.getElementById('headerViewerTitle');
      if (headerViewerTitleEl) {
        headerViewerTitleEl.innerHTML = `<div class="header-viewer-repo">${escapeHtml(repoPathDesc)}</div><div class="header-viewer-filename">${escapeHtml(fileName)}</div>`;
      }
    }
  } else if (appState.mobileView === 'tree' || appState.currentPath.length > 0) {
    btnBack.classList.remove('hidden');
    headerBrand.classList.add('hidden');
    if (headerViewerGroup) headerViewerGroup.classList.add('hidden');
  } else {
    btnBack.classList.add('hidden');
    headerBrand.classList.remove('hidden');
    if (headerViewerGroup) headerViewerGroup.classList.add('hidden');
  }
}

function handleHeaderBack(isPopState = false) {
  toggleTocModal(false);
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
  if (appState.isEditing && !confirmDiscardEditorChanges()) {
    return;
  }
  if (confirm('Are you sure you want to disconnect PAT? Favorites and Cache will be preserved.')) {
    if (appState.isEditing) exitEditModeUI();
    appState.token = null;
    localStorage.removeItem('gh_pat_token');
    localStorage.removeItem('gh_last_location_state');
    appState.repos = [];
    appState.currentRepo = null;
    appState.currentFile = null;
    appState.currentFileContent = null;
    appState.currentFileSha = null;
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

  // Sort: Favorited repos on top, then by most recently updated/modified first
  list = [...list].sort((a, b) => {
    const aFav = isRepoFavorited(a.owner, a.name) ? 1 : 0;
    const bFav = isRepoFavorited(b.owner, b.name) ? 1 : 0;
    if (bFav !== aFav) return bFav - aFav;

    const aTime = a.lastModified || (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
    const bTime = b.lastModified || (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
    return bTime - aTime;
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
    const repoObj = appState.repos.find(r => r.owner === owner && r.name === name);
    const updatedAt = repoObj && repoObj.updatedAt ? new Date(repoObj.updatedAt).getTime() : Date.now();
    appState.favoriteRepos.unshift({ owner, name, updatedAt, lastModified: Date.now(), addedAt: Date.now() });
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
  const favRepo = appState.favoriteRepos.find(r => r.owner === owner && r.name === name);
  if (favRepo) {
    favRepo.lastModified = Date.now();
    localStorage.setItem('gh_favorite_repos', JSON.stringify(appState.favoriteRepos));
  }

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
      const cleanRepoName = appState.currentRepo ? ((appState.currentRepo.name || '').includes('/') ? appState.currentRepo.name.split('/').pop() : appState.currentRepo.name) : '';
      return `
        <div class="tree-row ${isMd ? 'is-md' : ''}" onclick="${isMd ? `openMarkdownFile('${appState.currentRepo.owner}', '${appState.currentRepo.name}', '${entry.path}')` : ''}">
          <div class="tree-row-left">
            <svg class="octicon ${isMd ? 'octicon-file-code' : 'octicon-file'}" viewBox="0 0 16 16" width="18" height="18" fill="${isMd ? '#0969da' : '#656d76'}">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
            </svg>
            <div>
              ${isMd ? `<div class="repo-desc" style="font-size: 11px; color: var(--color-fg-muted); margin-bottom: 1px;">[${cleanRepoName}]:[${getParentDirPath(entry.path)}]</div>` : ''}
              <span class="tree-name">${name}</span>
            </div>
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

function formatCommitTime(dateInput) {
  if (!dateInput) return 'vừa xong';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const ago = formatTimeAgo(d.getTime());
    return `${dateStr} ${timeStr} (${ago})`;
  } catch (e) {
    return String(dateInput);
  }
}

async function fetchLatestCommitInfo(owner, name, path) {
  if (!appState.token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/commits?path=${encodeURIComponent(path)}&page=1&per_page=1`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        return {
          sha: item.sha,
          date: item.commit ? (item.commit.committer?.date || item.commit.author?.date) : null
        };
      }
    }
  } catch (e) {
    console.warn('Fetch commit info error:', e);
  }
  return null;
}

async function checkAndUpdatePageIfModified(owner, name, path, cached) {
  updateFileSyncBadge('syncing');

  try {
    // 1. Fast API check: fetch latest commit info (~400 bytes)
    const commitInfo = await fetchLatestCommitInfo(owner, name, path);
    const latestCommitSha = commitInfo ? commitInfo.sha : null;
    const lastCommitDate = commitInfo ? commitInfo.date : null;

    // 2. Check if file has changed remote
    let hasChanged = false;
    if (cached.lastCommitSha && latestCommitSha) {
      hasChanged = (cached.lastCommitSha !== latestCommitSha);
    } else {
      // Fallback for legacy cache: check If-None-Match header against GitHub
      const metaRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
        headers: {
          'Authorization': `Bearer ${appState.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'If-None-Match': cached.sha ? `"${cached.sha}"` : ''
        }
      });
      if (metaRes.status === 304) {
        hasChanged = false;
      } else if (metaRes.ok) {
        const metaData = await metaRes.json();
        hasChanged = (cached.sha !== metaData.sha);
      }
    }

    if (!hasChanged) {
      // File has NOT changed remote! Avoid downloading content again.
      cached.lastSyncedAt = Date.now();
      if (latestCommitSha) cached.lastCommitSha = latestCommitSha;
      if (lastCommitDate) cached.lastCommitDate = lastCommitDate;
      await getIdb().set(cached.fileKey, cached);
      updateFileSyncBadge('synced', cached.lastSyncedAt);
      return;
    }

    // File HAS CHANGED remote! Download new content
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const rawContent = await resolveFileRawContent(data, owner, name, path);

      const updatedCache = {
        fileKey: cached.fileKey,
        owner,
        name,
        path,
        content: rawContent,
        sha: data.sha,
        lastCommitSha: latestCommitSha || cached.lastCommitSha || data.sha,
        lastCommitDate: lastCommitDate || cached.lastCommitDate || null,
        lastSyncedAt: Date.now()
      };

      await getIdb().set(cached.fileKey, updatedCache);
      markStateDirty();

      if (appState.currentFile && appState.currentFile.owner === owner && appState.currentFile.name === name && appState.currentFile.path === path) {
        appState.currentFileSha = data.sha || null;
        if (!appState.isEditing) {
          appState.currentFileContent = rawContent;
          renderMarkdown(rawContent);
          updateFileSyncBadge('synced', Date.now());

          const commitTimeStr = formatCommitTime(updatedCache.lastCommitDate);
          showFlash(`Trang đã được cập nhật mới (Commit gần nhất: ${commitTimeStr})`, 'success', 500);
        }
      }
    } else {
      updateFileSyncBadge('cached', cached.lastSyncedAt);
    }
  } catch (err) {
    console.warn('Check & update page error:', err);
    updateFileSyncBadge('cached', cached.lastSyncedAt);
  }
}

// --- LOGIC 6: Open Markdown File ---
async function openMarkdownFile(owner, name, path) {
  if (appState.isEditing) {
    if (!confirmDiscardEditorChanges()) {
      return;
    }
    exitEditModeUI();
  }
  appState.currentFile = { owner, name, path };
  appState.currentFileSha = null;
  appState.isSelectionLocked = true; // Always default to locked for each new page opened
  applyLockSelect();
  saveCurrentLocationState();
  const fileKey = `${owner}/${name}/${path}`;

  const favFile = appState.favoriteFiles.find(f => f.owner === owner && f.name === name && f.path === path);
  if (favFile) {
    favFile.lastModified = Date.now();
    localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  }

  addToHistory(owner, name, path);
  switchMobileView('viewer');

  const cleanRepoName = (name || '').includes('/') ? name.split('/').pop() : name;
  const fileName = path.split('/').pop();
  const parentPath = getParentDirPath(path);
  const repoPathDesc = parentPath ? `[${cleanRepoName}]:[${parentPath}]` : `[${cleanRepoName}]`;

  const headerViewerTitleEl = document.getElementById('headerViewerTitle');
  if (headerViewerTitleEl) {
    headerViewerTitleEl.innerHTML = `<div class="header-viewer-repo">${escapeHtml(repoPathDesc)}</div><div class="header-viewer-filename">${escapeHtml(fileName)}</div>`;
  }
  const viewerTitleEl = document.getElementById('viewerFileName');
  if (viewerTitleEl) {
    viewerTitleEl.innerHTML = `<div class="repo-desc" style="font-size: 11px; color: var(--color-fg-muted); line-height: 1.2;">${repoPathDesc}</div><div style="font-weight: 600; font-size: 14px; color: var(--gh-text-primary); line-height: 1.3;">${fileName}</div>`;
  }
  document.getElementById('linkOpenGithub').href = `https://github.com/${owner}/${name}/blob/${appState.currentRepo ? appState.currentRepo.defaultBranch || 'main' : 'main'}/${encodeGitPath(path)}`;

  updateViewerFavoriteStar();
  const viewerPanel = document.getElementById('markdownViewerPanel');
  viewerPanel.innerHTML = '<p class="text-muted">Loading document...</p>';
  clearReaderTableOfContents();

  // Step 1: Check Cache
  let cached = null;
  try {
    cached = await getIdb().get(fileKey);
  } catch (err) { console.warn('Cache read error:', err); }

  if (cached && typeof cached.content === 'string') {
    // Self-healing: if cached content was polluted with GitHub API JSON metadata
    if (isGitHubApiJson(cached.content)) {
      try {
        const parsed = JSON.parse(cached.content);
        if (parsed.size === 0 || parsed.content === '') {
          cached.content = '';
          await getIdb().set(fileKey, cached);
        } else if (parsed.content) {
          cached.content = base64ToUtf8(parsed.content);
          await getIdb().set(fileKey, cached);
        } else {
          cached = null; // force re-fetch
        }
      } catch (e) {
        cached = null;
      }
    }
  }

  if (cached && typeof cached.content === 'string') {
    appState.currentFileSha = cached.sha || null;
    renderMarkdown(cached.content);
    updateFileSyncBadge('cached', cached.lastSyncedAt);

    if (appState.isOffline) {
      showFlash('Viewing offline cached version.', 'info');
      return;
    }

    if (appState.token) {
      checkAndUpdatePageIfModified(owner, name, path, cached);
    }
    return;
  }

  // Step 2: If Offline (and no cache)
  if (appState.isOffline) {
    viewerPanel.innerHTML = '<div class="blankslate"><p class="text-danger">No network connection and no offline cached version available for this file.</p></div>';
    return;
  }

  // Step 3: Fetch GitHub API (Initial load, no cache yet)
  updateFileSyncBadge('syncing');

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const rawContent = await resolveFileRawContent(data, owner, name, path);

      appState.currentFileSha = data.sha || null;
      appState.currentFileContent = rawContent;
      renderMarkdown(rawContent);

      const commitInfo = await fetchLatestCommitInfo(owner, name, path);
      const newCache = {
        fileKey,
        owner,
        name,
        path,
        content: rawContent,
        sha: data.sha,
        lastCommitSha: commitInfo ? commitInfo.sha : data.sha,
        lastCommitDate: commitInfo ? commitInfo.date : null,
        lastSyncedAt: Date.now()
      };
      await getIdb().set(fileKey, newCache);

      updateFileSyncBadge('synced', Date.now());
    } else {
      const errorText = await res.text().catch(() => '');
      viewerPanel.innerHTML = `<div class="blankslate"><p class="text-danger">Unable to load file from GitHub (HTTP ${res.status}). ${errorText ? `<br><small>${errorText}</small>` : ''}</p></div>`;
    }
  } catch (err) {
    console.error('Fetch markdown error:', err);
    viewerPanel.innerHTML = `<div class="blankslate"><p class="text-danger">Connection error loading file: ${err.message || err}</p></div>`;
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
  if (typeof ttsStop === 'function' && typeof ttsState !== 'undefined' && ttsState.active) {
    ttsStop();
  }

  // Self-healing safeguard: if rawContent is accidentally GitHub API JSON metadata
  if (isGitHubApiJson(rawContent)) {
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed.size === 0 || parsed.content === '') {
        rawContent = '';
      } else if (parsed.content) {
        rawContent = base64ToUtf8(parsed.content);
      } else {
        rawContent = '';
      }
    } catch (e) {
      rawContent = '';
    }
  }

  appState.currentFileContent = rawContent;

  const viewerPanel = document.getElementById('markdownViewerPanel');
  const rawPanel = document.getElementById('rawMarkdownPanel');

  if (!rawContent || !rawContent.trim()) {
    viewerPanel.innerHTML = `
      <div class="blankslate" style="padding: 48px 16px; text-align: center; color: var(--color-fg-muted);">
        <svg class="octicon octicon-file" viewBox="0 0 16 16" width="36" height="36" fill="currentColor" style="opacity: 0.4; margin-bottom: 12px;">
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
        </svg>
        <h3 style="font-size: 15px; font-weight: 600; margin: 0 0 6px 0; color: var(--color-fg-default);">Tài liệu trống</h3>
        <p style="font-size: 13px; margin: 0 0 16px 0;">Tệp tin này hiện chưa có nội dung (0 bytes).</p>
        <button type="button" class="gh-btn gh-btn-sm gh-btn-primary" onclick="enterEditMode()">
          <svg class="octicon octicon-pencil" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"></path>
          </svg>
          <span>Bắt đầu viết nội dung</span>
        </button>
      </div>
    `;
    if (rawPanel) rawPanel.textContent = '';
    clearReaderTableOfContents();
    return;
  }

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

    const escapedCode = escapeHtml(code);
    return `
      <div class="code-block-wrapper">
        <button class="btn-copy-code" type="button" title="Copy code" aria-label="Copy code">
          <svg class="octicon octicon-copy" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
          </svg>
          <span>Copy</span>
        </button>
        <pre><code class="hljs language-${lang}">${escapedCode}</code></pre>
      </div>
    `;
  };

  marked.setOptions({ renderer });
  const rawHtml = marked.parse(rawContent);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['div', 'img', 'button', 'span', 'svg', 'path'],
    ADD_ATTR: ['src', 'alt', 'class', 'type', 'title', 'aria-label', 'viewBox', 'width', 'height', 'fill', 'd']
  });

  viewerPanel.innerHTML = cleanHtml;
  rawPanel.textContent = rawContent;

  // Render LaTeX / Math Expressions (KaTeX: e.g. $\rightarrow$, $\sum$, equations)
  if (window.renderMathInElement) {
    try {
      renderMathInElement(viewerPanel, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (kErr) {
      console.warn('KaTeX render warning:', kErr);
    }
  }

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
  applyLockSelect();
  buildReaderTableOfContents();
}

function handleCopyCodeBlock(btn) {
  const wrapper = btn.closest('.code-block-wrapper');
  if (!wrapper) return;
  const codeEl = wrapper.querySelector('pre code');
  if (!codeEl) return;

  const codeText = codeEl.textContent || codeEl.innerText || '';

  const setCopiedUI = () => {
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg class="octicon octicon-check" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
      </svg>
      <span>Copied!</span>
    `;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `
        <svg class="octicon octicon-copy" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
        </svg>
        <span>Copy</span>
      `;
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(codeText).then(setCopiedUI).catch(() => {
      fallbackCopyText(codeText);
      setCopiedUI();
    });
  } else {
    fallbackCopyText(codeText);
    setCopiedUI();
  }
}

function fallbackCopyText(text) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch (e) {
    console.warn('Fallback copy failed:', e);
  }
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

async function copyAllMarkdown() {
  const content = appState.currentFileContent || (document.getElementById('rawMarkdownPanel') ? document.getElementById('rawMarkdownPanel').textContent : '');
  if (!content) {
    showFlash('No Markdown content available to copy.', 'info');
    return;
  }

  const btn = document.getElementById('btnCopyAllMarkdown');
  const originalHtml = btn ? btn.innerHTML : '';

  const setCopiedUI = () => {
    if (btn) {
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg class="octicon octicon-check" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
        </svg>
        <span>Copied!</span>
      `;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = originalHtml;
      }, 2000);
    }
    showFlash('Copied entire Markdown file to clipboard!', 'success');
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedUI();
    } catch (err) {
      fallbackCopyText(content);
      setCopiedUI();
    }
  } else {
    fallbackCopyText(content);
    setCopiedUI();
  }
}

async function downloadCurrentMarkdownFile() {
  const content = appState.currentFileContent || (document.getElementById('rawMarkdownPanel') ? document.getElementById('rawMarkdownPanel').textContent : '');
  if (!content) {
    showFlash('No Markdown content available to download.', 'info');
    return;
  }

  let fileName = 'document.md';
  if (appState.currentFile && appState.currentFile.path) {
    fileName = appState.currentFile.path.split('/').pop() || 'document.md';
  }

  const btn = document.getElementById('btnDownloadMarkdown');
  const originalHtml = btn ? btn.innerHTML : '';

  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const success = await downloadBlobFile(blob, fileName, 'text/markdown');
    if (!success) return; // User cancelled share dialog

    if (btn) {
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg class="octicon octicon-check" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
        </svg>
        <span>Saved!</span>
      `;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = originalHtml;
      }, 2000);
    }
    showFlash(`Downloaded ${fileName}!`, 'success');
  } catch (err) {
    console.error('Download error:', err);
    showFlash('Failed to download Markdown file.', 'error');
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
    // If user clicks star from file viewer or elsewhere, confirm if removing from All
    if (confirm('Remove file from Favorites & delete from All groups permanently?')) {
      appState.favoriteFiles.splice(index, 1);
      try { await getIdb().del(fileKey); } catch (err) {}
      showFlash('Removed file from Favorites.', 'info');
    } else {
      return;
    }
  } else {
    appState.favoriteFiles.unshift({ owner, name, path, groups: ['All'], lastModified: Date.now(), addedAt: Date.now() });
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

  const favFile = appState.favoriteFiles.find(f => f.owner === owner && f.name === name && f.path === path);
  if (favFile) {
    favFile.lastModified = Date.now();
    localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  }
  
  if (typeof content === 'string') {
    const data = { fileKey, owner, name, path, content, sha, lastSyncedAt: Date.now() };
    await getIdb().set(fileKey, data);
    markStateDirty();
    return;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const fileData = await res.json();
      const raw = await resolveFileRawContent(fileData, owner, name, path);
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

async function manageCurrentFileGroups() {
  if (!appState.currentFile) return;
  const { owner, name, path } = appState.currentFile;

  let file = appState.favoriteFiles.find(f => f.owner === owner && (f.name === name || (f.name && name && f.name.endsWith(name))) && f.path === path)
    || appState.favoriteFiles.find(f => f.owner === owner && f.path === path);

  if (!file) {
    // Automatically add to Favorites with default group ['All'] and cache offline
    const newFav = { owner, name, path, groups: ['All'], lastModified: Date.now(), addedAt: Date.now() };
    appState.favoriteFiles.unshift(newFav);
    localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
    markStateDirty();
    updateViewerFavoriteStar();
    renderFavoritesList();

    if (appState.currentFileContent) {
      cacheFavoriteFile(owner, name, path, appState.currentFileContent);
    } else {
      cacheFavoriteFile(owner, name, path);
    }

    showFlash('Added to Favorites (Group: All). Select additional groups below:', 'success');
  }

  openManagePageGroupsModal(owner, name, path);
}

// --- FAV GROUPS MANAGEMENT ---
function renderFavGroupsBar() {
  const container = document.getElementById('favGroupsBar');
  if (!container) return;

  sanitizeFavGroups();

  if (!appState.activeFavGroup || !appState.favGroups.includes(appState.activeFavGroup)) {
    appState.activeFavGroup = 'All';
  }

  const chipsHtml = appState.favGroups.map(group => {
    const isActive = group === appState.activeFavGroup;
    const activeClass = isActive ? 'active' : '';

    return `
      <div class="fav-group-chip ${activeClass}" onclick="setActiveFavGroup('${escapeHtml(group)}')">
        <span>${escapeHtml(group)}</span>
      </div>
    `;
  }).join('');

  const addBtnHtml = `
    <button class="fav-group-chip-add" onclick="promptCreateGroup()">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
        <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"></path>
      </svg>
      <span>Group</span>
    </button>
  `;

  container.innerHTML = chipsHtml + addBtnHtml;
  updateDeleteGroupButtonUI();
}

function updateDeleteGroupButtonUI() {
  const btn = document.getElementById('btnDeleteActiveFavGroup');
  if (!btn) return;
  const currentGroup = appState.activeFavGroup || 'All';
  if (currentGroup === 'All') {
    btn.classList.add('hidden');
  } else {
    btn.classList.remove('hidden');
    btn.title = `Delete group "${currentGroup}"`;
    btn.innerHTML = `
      <svg class="octicon octicon-trash" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a1.75 1.75 0 0 0 1.744 1.475h2.2c.905 0 1.66-.69 1.744-1.475l.66-6.6a.75.75 0 0 0-1.492-.15l-.66 6.6a.25.25 0 0 1-.248.21h-2.2a.25.25 0 0 1-.248-.21l-.66-6.6a.75.75 0 0 0-1.496.15ZM6.5 1.5h3a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"></path>
      </svg>
      <span>Delete Group</span>
    `;
  }
}

function deleteCurrentActiveFavGroup() {
  const currentGroup = appState.activeFavGroup || 'All';
  if (currentGroup === 'All') {
    showFlash('Group "All" cannot be deleted.', 'info');
    return;
  }
  deleteFavGroup(currentGroup);
}

function setActiveFavGroup(groupName) {
  appState.activeFavGroup = groupName;
  renderFavGroupsBar();
  renderFavoritesList();
}

function promptCreateGroup() {
  const name = prompt('Enter new group name:');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  if (appState.favGroups.includes(trimmed)) {
    showFlash(`Group "${trimmed}" already exists.`, 'info');
    setActiveFavGroup(trimmed);
    return;
  }

  appState.favGroups.push(trimmed);
  localStorage.setItem('gh_fav_groups', JSON.stringify(appState.favGroups));
  markStateDirty();
  showFlash(`Group "${trimmed}" created!`, 'success');
  setActiveFavGroup(trimmed);
}

function deleteFavGroup(groupName) {
  if (groupName === 'All') {
    showFlash('Group "All" cannot be deleted.', 'info');
    return;
  }

  // Count how many pages belong to this group
  const pagesInGroupCount = appState.favoriteFiles.filter(file => {
    const groups = file.groups || ['All'];
    return groups.includes(groupName);
  }).length;

  const warningMsg = `⚠️ Delete group "${groupName}"?\n\n` +
    `• This group currently contains ${pagesInGroupCount} favorite page${pagesInGroupCount === 1 ? '' : 's'}.\n` +
    `• After deletion, all ${pagesInGroupCount} page${pagesInGroupCount === 1 ? '' : 's'} will still be kept safely in group "All".\n\n` +
    `Do you want to proceed with deleting this group?`;

  if (!confirm(warningMsg)) {
    return;
  }

  appState.favGroups = appState.favGroups.filter(g => g !== groupName);
  localStorage.setItem('gh_fav_groups', JSON.stringify(appState.favGroups));

  appState.favoriteFiles.forEach(file => {
    if (file.groups) {
      file.groups = file.groups.filter(g => g !== groupName);
      if (file.groups.length === 0) {
        file.groups.push('All');
      }
    }
  });
  localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));

  markStateDirty();
  showFlash(`Group "${groupName}" deleted. (Pages retained in "All")`, 'info');

  if (appState.activeFavGroup === groupName) {
    appState.activeFavGroup = 'All';
  }

  renderFavGroupsBar();
  renderFavoritesList();
}

// --- CONTEXT-AWARE FAVORITE PAGE DELETION ---
async function removeFavoriteFileInCurrentContext(owner, name, path) {
  const currentGroup = appState.activeFavGroup || 'All';

  if (currentGroup === 'All') {
    // Deleting in group "All" requires confirmation because it completely deletes the page
    if (confirm('Deleting from "All" will remove this favorite page permanently. Continue?')) {
      await deleteFavoriteFileCompletely(owner, name, path);
    }
  } else {
    // Deleting from custom group requires NO confirmation
    const file = appState.favoriteFiles.find(f => f.owner === owner && f.name === name && f.path === path);
    if (file) {
      file.groups = (file.groups || []).filter(g => g !== currentGroup);
      if (file.groups.length === 0) {
        file.groups.push('All');
      }
      localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
      markStateDirty();
      showFlash(`Removed page from group "${currentGroup}".`, 'info');
      renderFavoritesList();
    }
  }
}

async function deleteFavoriteFileCompletely(owner, name, path) {
  const index = appState.favoriteFiles.findIndex(f => f.owner === owner && f.name === name && f.path === path);
  const fileKey = `${owner}/${name}/${path}`;

  if (index > -1) {
    appState.favoriteFiles.splice(index, 1);
    try { await getIdb().del(fileKey); } catch (err) {}
    localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
    markStateDirty();
    showFlash('Favorite page deleted permanently.', 'info');
    updateViewerFavoriteStar();
    renderFavoritesList();
    if (appState.mobileView === 'tree') renderFileTree();
    if (appState.mobileView === 'history') renderHistoryList();
  }
}

// --- MODAL: MANAGE PAGE GROUPS ---
let currentManagingFile = null;

function getManagingFileObj() {
  if (!currentManagingFile) return null;
  const { owner, name, path } = currentManagingFile;
  return appState.favoriteFiles.find(f => f.owner === owner && f.name === name && f.path === path)
    || appState.favoriteFiles.find(f => f.owner === owner && f.path === path)
    || null;
}

function openManagePageGroupsModal(owner, name, path) {
  currentManagingFile = { owner, name, path };
  const modal = document.getElementById('manageGroupsModal');
  if (!modal) return;

  const file = getManagingFileObj();
  if (!file) {
    console.warn('File not found in favoriteFiles:', owner, name, path);
    return;
  }

  const titleEl = document.getElementById('manageGroupsModalTitle');
  if (titleEl) {
    titleEl.textContent = `Groups for: ${path.split('/').pop()}`;
  }

  renderManageGroupsModalContent();
  modal.classList.remove('hidden');
}

function closeManagePageGroupsModal() {
  const modal = document.getElementById('manageGroupsModal');
  if (modal) modal.classList.add('hidden');
  currentManagingFile = null;
}

function renderManageGroupsModalContent() {
  const file = getManagingFileObj();
  if (!file) return;

  const fileGroups = file.groups || ['All'];
  const listEl = document.getElementById('manageGroupsModalList') || document.getElementById('manageGroupsModalBody');
  if (!listEl) return;

  sanitizeFavGroups();

  listEl.innerHTML = appState.favGroups.map(group => {
    const isAll = group === 'All';
    const isChecked = isAll || fileGroups.includes(group);

    if (isAll) {
      return `
        <label class="modal-group-item disabled" title="All pages belong to group All by default">
          <span class="modal-group-name">
            ${escapeHtml(group)}
            <span class="modal-group-badge">Default</span>
          </span>
          <input type="checkbox" class="modal-group-checkbox" checked disabled />
        </label>
      `;
    }

    return `
      <label class="modal-group-item">
        <span class="modal-group-name">${escapeHtml(group)}</span>
        <input type="checkbox" class="modal-group-checkbox" ${isChecked ? 'checked' : ''} onchange="toggleFileGroupModal('${escapeHtml(group)}', this.checked)">
      </label>
    `;
  }).join('');
}

function toggleFileGroupModal(groupName, isChecked) {
  if (groupName === 'All') return; // Group All is always locked/checked

  const file = getManagingFileObj();
  if (!file) return;

  if (!Array.isArray(file.groups)) file.groups = ['All'];

  if (isChecked) {
    if (!file.groups.includes(groupName)) {
      file.groups.push(groupName);
    }
  } else {
    file.groups = file.groups.filter(g => g !== groupName);
    if (file.groups.length === 0) {
      file.groups.push('All');
    }
  }

  localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  markStateDirty();
  renderManageGroupsModalContent();
  renderFavoritesList();
}

function createGroupFromModal() {
  const input = document.getElementById('newGroupNameModalInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;

  if (appState.favGroups.includes(name)) {
    showFlash(`Group "${name}" already exists.`, 'info');
  } else {
    appState.favGroups.push(name);
    localStorage.setItem('gh_fav_groups', JSON.stringify(appState.favGroups));
    markStateDirty();
    showFlash(`Group "${name}" created!`, 'success');
  }

  const file = getManagingFileObj();
  if (file) {
    if (!Array.isArray(file.groups)) file.groups = ['All'];
    if (!file.groups.includes(name)) file.groups.push(name);
    localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  }

  input.value = '';
  renderFavGroupsBar();
  renderManageGroupsModalContent();
  renderFavoritesList();
}

async function renderFavoritesList() {
  const favFilesContainer = document.getElementById('favFilesContainer');
  const favReposContainer = document.getElementById('favReposContainer');

  if (!favFilesContainer || !favReposContainer) return;

  renderFavGroupsBar();
  sanitizeFavGroups();

  const activeGroup = appState.activeFavGroup || 'All';

  // Filter favorite files by active group
  const filteredFiles = appState.favoriteFiles.filter(f => {
    const groups = f.groups || ['All'];
    if (activeGroup === 'All') return true;
    return groups.includes(activeGroup);
  });

  if (filteredFiles.length === 0) {
    if (appState.favoriteFiles.length === 0) {
      favFilesContainer.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>No favorite pages yet.</p></div>';
    } else {
      favFilesContainer.innerHTML = `<div class="blankslate" style="padding: 16px;"><p>No pages in group "${escapeHtml(activeGroup)}".</p></div>`;
    }
  } else {
    const fileItems = await Promise.all(filteredFiles.map(async file => {
      const cleanRepoName = (file.name || '').includes('/') ? file.name.split('/').pop() : file.name;
      const fileKey = `${file.owner}/${cleanRepoName}/${file.path}`;
      let syncTime = 0;
      let syncText = '';
      try {
        const cached = await getIdb().get(fileKey);
        if (cached && cached.lastSyncedAt) {
          syncTime = cached.lastSyncedAt;
          syncText = ` • <span class="text-muted">Synced ${formatTimeAgo(cached.lastSyncedAt)}</span>`;
        }
      } catch (e) {}

      const lastModifiedTime = file.lastModified || file.updatedAt || syncTime || file.addedAt || 0;
      return { file, cleanRepoName, syncText, lastModifiedTime };
    }));

    // Sort favorite pages by most recently modified / accessed / synced first
    fileItems.sort((a, b) => b.lastModifiedTime - a.lastModifiedTime);

    const fileItemsHtml = fileItems.map(item => {
      const { file, cleanRepoName, syncText } = item;
      const groups = file.groups || ['All'];
      const badgesHtml = groups.map(g => `<span class="group-badge">${escapeHtml(g)}</span>`).join('');

      return `
        <div class="gh-action-item" onclick="openMarkdownFile('${file.owner}', '${file.name}', '${file.path}')">
          <div class="repo-item-main" style="min-width: 0; flex: 1;">
            <svg class="octicon octicon-file-code text-muted" viewBox="0 0 16 16" width="18" height="18" fill="#0969da" style="flex-shrink: 0; margin-top: 2px;">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
            </svg>
            <div style="min-width: 0; overflow: hidden;">
              <div class="repo-desc">[${cleanRepoName}]:[${getParentDirPath(file.path)}]${syncText}</div>
              <div class="repo-name">${file.path.split('/').pop()}</div>
              <div class="group-badge-container">${badgesHtml}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;" onclick="event.stopPropagation();">
            <button class="btn-group-manage-icon" onclick="openManagePageGroupsModal('${file.owner}', '${file.name}', '${file.path}')" title="Manage Groups">
              <svg class="octicon octicon-tag" viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                <path d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
              </svg>
            </button>
            <button class="btn-star-icon favorited" onclick="removeFavoriteFileInCurrentContext('${file.owner}', '${file.name}', '${file.path}')" title="${activeGroup === 'All' ? 'Delete page completely' : 'Remove from group ' + escapeHtml(activeGroup)}">
              <svg class="octicon octicon-star" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    });
    favFilesContainer.innerHTML = fileItemsHtml.join('');
  }

  if (appState.favoriteRepos.length === 0) {
    favReposContainer.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>No favorite repositories yet.</p></div>';
  } else {
    // Sort favorite repos by most recently modified / accessed / added first
    const sortedFavRepos = [...appState.favoriteRepos].sort((a, b) => {
      const repoA = appState.repos.find(r => r.owner === a.owner && r.name === a.name);
      const repoB = appState.repos.find(r => r.owner === b.owner && r.name === b.name);
      const timeA = a.lastModified || a.updatedAt || (repoA && repoA.updatedAt ? new Date(repoA.updatedAt).getTime() : 0) || a.addedAt || 0;
      const timeB = b.lastModified || b.updatedAt || (repoB && repoB.updatedAt ? new Date(repoB.updatedAt).getTime() : 0) || b.addedAt || 0;
      return timeB - timeA;
    });

    favReposContainer.innerHTML = sortedFavRepos.map(repo => {
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
  if (appState.isEditing) {
    if (!confirmDiscardEditorChanges()) return;
    exitEditModeUI();
  }
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
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const rawContent = await resolveFileRawContent(data, owner, name, path);
      
      await cacheFavoriteFile(owner, name, path, rawContent, data.sha);
      
      if (appState.currentFile && appState.currentFile.owner === owner && appState.currentFile.name === name && appState.currentFile.path === path) {
        appState.currentFileSha = data.sha || null;
        if (!appState.isEditing) {
          renderMarkdown(rawContent);
        }
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

  const sortedHistory = [...appState.readingHistory].sort((a, b) => (b.readAt || 0) - (a.readAt || 0));

  container.innerHTML = sortedHistory.map(file => {
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
            <div class="repo-desc">[${cleanRepoName}]:[${getParentDirPath(file.path)}] • <span class="text-muted">${timeAgo}</span></div>
            <div class="repo-name">${file.path.split('/').pop()}</div>
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

// --- LOGIC: Lock / Unlock Text Selection ---
function applyLockSelect() {
  const viewerBodies = document.querySelectorAll('.viewer-body, #markdownViewerPanel');
  const btn = document.getElementById('btnToggleLockSelect');
  const icon = document.getElementById('lockSelectIcon');
  const text = document.getElementById('lockSelectText');

  viewerBodies.forEach(el => {
    if (appState.isSelectionLocked) {
      el.classList.add('selection-locked');
    } else {
      el.classList.remove('selection-locked');
    }
  });

  if (btn) {
    if (appState.isSelectionLocked) {
      btn.classList.add('active-lock');
      btn.title = 'Text selection is Locked (Tap to Unlock / Copy text)';
      if (icon) {
        icon.innerHTML = '<path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8 2V4a2 2 0 1 0-4 0v2ZM3.5 7.75v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Z"></path>';
      }
      if (text) text.textContent = 'Lock';
    } else {
      btn.classList.remove('active-lock');
      btn.title = 'Text selection is Unlocked (Tap to Lock)';
      if (icon) {
        icon.innerHTML = '<path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4ZM10.5 4a2.5 2.5 0 0 0-5 0v2h5ZM3.5 7.75v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Z"></path>';
      }
      if (text) text.textContent = 'Unlock';
    }
  }
}

function toggleLockSelect() {
  appState.isSelectionLocked = !appState.isSelectionLocked;
  applyLockSelect();
  showFlash(
    appState.isSelectionLocked
      ? '🔒 Text selection LOCKED (Touch scroll optimized)'
      : '🔓 Text selection UNLOCKED (Active for this page session)',
    'info',
    2000
  );
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
      favGroups: appState.favGroups,
      favoriteRepos: appState.favoriteRepos,
      favoriteFiles: appState.favoriteFiles,
      readingHistory: appState.readingHistory,
      fontScale: appState.fontScale,
      cachedFiles: cachedFiles
    };

    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `gh_explorer_backup_${dateStr}.json`;
    const success = await downloadBlobFile(blob, fileName, 'application/json');
    if (!success) return; // Cancelled
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

    // Merge Fav Groups
    if (Array.isArray(data.favGroups)) {
      const mergedGroupsSet = new Set(['All', ...appState.favGroups, ...data.favGroups]);
      appState.favGroups = Array.from(mergedGroupsSet);
      localStorage.setItem('gh_fav_groups', JSON.stringify(appState.favGroups));
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

    // 2. Smart Merge Favorite Files (Deduplicate and merge groups)
    if (Array.isArray(data.favoriteFiles)) {
      const mergedFilesMap = new Map();
      appState.favoriteFiles.concat(data.favoriteFiles).forEach(f => {
        if (f && f.owner && f.name && f.path) {
          const key = `${f.owner}/${f.name}/${f.path}`;
          const existing = mergedFilesMap.get(key);
          if (existing) {
            const mergedGroups = Array.from(new Set(['All', ...(existing.groups || []), ...(f.groups || [])]));
            mergedFilesMap.set(key, { ...existing, ...f, groups: mergedGroups });
          } else {
            const groups = Array.from(new Set(['All', ...(f.groups || [])]));
            mergedFilesMap.set(key, { ...f, groups });
          }
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
      favGroups: appState.favGroups,
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

/* ==========================================================================
   PWA STANDARDS IMPLEMENTATION (Rule 6, Rule 8, Rule 10)
   ========================================================================== */

/**
 * Universal Mobile File Download & Web Share Handler (Rule 8)
 * Uses Web Share API on iOS Safari/PWA to save to Files; falls back to <a> download on Desktop/Android.
 */
async function downloadBlobFile(blob, fileName, mimeType = 'text/plain') {
  const file = new File([blob], fileName, { type: mimeType });
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: fileName
      });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') {
        return false;
      }
      console.warn('[WebShare] Fallback to direct download link:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/**
 * In-App PWA Update Notification Banner (Rule 6D)
 * Displays a non-intrusive banner when a new Service Worker is waiting to activate.
 */
function promptPwaUpdate(waitingWorker) {
  const banner = document.getElementById('pwaUpdateBanner');
  const btnReload = document.getElementById('btnPwaReload');
  const btnDismiss = document.getElementById('btnPwaDismiss');
  if (!banner) return;

  banner.classList.remove('hidden');

  if (btnReload) {
    btnReload.onclick = () => {
      waitingWorker.postMessage({ action: 'skipWaiting' });
    };
  }

  if (btnDismiss) {
    btnDismiss.onclick = () => {
      banner.classList.add('hidden');
    };
  }
}

/**
 * PWA Install Button Pattern (Rule 6A, 6B, 6C)
 * Supports native beforeinstallprompt on Chromium and custom guide modal on iOS Safari.
 */
function initPWAInstallFlow() {
  const btnInstall = document.getElementById('btnInstall');
  const iosInstallModal = document.getElementById('iosInstallModal');
  const btnCloseIosModal = document.getElementById('btnCloseIosModal');
  const btnGotItIos = document.getElementById('btnGotItIos');

  let deferredInstallPrompt = null;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isStandalone) {
    if (btnInstall) btnInstall.classList.add('hidden');
  } else if (isIOS && btnInstall) {
    // iOS Safari does not fire beforeinstallprompt: show button to open instructions
    btnInstall.classList.remove('hidden');
  }

  // 1. Listen for beforeinstallprompt on Chromium (Android / Desktop)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!isStandalone && btnInstall) {
      btnInstall.classList.remove('hidden');
    }
  });

  // 2. Listen when app is installed successfully
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (btnInstall) btnInstall.classList.add('hidden');
    showFlash('Cài đặt ứng dụng thành công!', 'success');
  });

  // 3. Handle click on Install button
  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          btnInstall.classList.add('hidden');
        }
        deferredInstallPrompt = null;
      } else if (iosInstallModal) {
        toggleIosInstallModal(true);
      }
    });
  }

  if (btnCloseIosModal) {
    btnCloseIosModal.addEventListener('click', () => toggleIosInstallModal(false));
  }
  if (btnGotItIos) {
    btnGotItIos.addEventListener('click', () => toggleIosInstallModal(false));
  }
}

/**
 * Toggle iOS Safari Install Guide Modal
 */
function toggleIosInstallModal(show) {
  const modal = document.getElementById('iosInstallModal');
  if (!modal) return;
  if (show) {
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

// --- LOGIC 19: Reader Table of Contents (H1 & H2 Seek Drawer) ---
/**
 * Scans the rendered markdown panel for H1 and H2 tags only (strictly 2 levels).
 * Extracts text, ensures unique element IDs for scrolling, and populates the TOC drawer.
 */
function buildReaderTableOfContents() {
  const viewerPanel = document.getElementById('markdownViewerPanel');
  if (!viewerPanel) return;

  // Query strictly H1 and H2 tags as requested (2 levels only)
  const headingElements = viewerPanel.querySelectorAll('h1, h2');
  const headings = [];

  headingElements.forEach((el, index) => {
    const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!rawText) return;

    let id = el.id;
    if (!id) {
      const slug = rawText
        .toLowerCase()
        .replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      id = slug ? `h-${slug}-${index + 1}` : `heading-${index + 1}`;
      el.id = id;
    }

    const tagName = el.tagName.toLowerCase();
    const level = tagName === 'h1' ? 1 : 2;

    headings.push({
      id,
      text: rawText,
      level
    });
  });

  appState.readerHeadings = headings;

  // Update count badge
  const countBadge = document.getElementById('readerTocCount');
  if (countBadge) {
    countBadge.textContent = headings.length.toString();
  }

  // Reset search filter input
  const searchInput = document.getElementById('tocSearchInput');
  if (searchInput) {
    searchInput.value = '';
  }

  renderTocList(headings);
}

/**
 * Renders the array of headings into the side modal list.
 */
function renderTocList(headings) {
  const listContainer = document.getElementById('readerTocList');
  if (!listContainer) return;

  if (!headings || headings.length === 0) {
    listContainer.innerHTML = `
      <div style="padding: 28px 16px; text-align: center; color: var(--color-fg-muted); font-size: 13px;">
        <svg class="octicon" viewBox="0 0 16 16" width="28" height="28" fill="currentColor" style="opacity: 0.5; margin-bottom: 8px;">
          <path d="M2 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm3.75-1.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5ZM3 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"></path>
        </svg>
        <div>Không tìm thấy tiêu đề H1, H2 trong tài liệu này.</div>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = headings.map(item => {
    const levelClass = item.level === 1 ? 'toc-item-h1' : 'toc-item-h2';
    const tagClass = item.level === 1 ? 'toc-tag-h1' : 'toc-tag-h2';
    const tagLabel = item.level === 1 ? 'H1' : 'H2';

    return `
      <div role="button" tabindex="0" class="toc-item ${levelClass}" onclick="seekToHeading('${escapeHtml(item.id)}')" onkeydown="if(event.key==='Enter'||event.key===' ')seekToHeading('${escapeHtml(item.id)}')" aria-label="Nhảy đến ${tagLabel}: ${escapeHtml(item.text)}">
        <span class="toc-level-tag ${tagClass}">${tagLabel}</span>
        <span class="toc-item-text">${escapeHtml(item.text)}</span>
      </div>
    `;
  }).join('');
}

/**
 * Smoothly scrolls the viewer to the chosen heading element and highlights it with a temporary pulse.
 */
function seekToHeading(headingId) {
  if (!headingId) return;
  const target = document.getElementById(headingId);

  // Close the TOC modal
  toggleTocModal(false);

  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Trigger visual pulse glow
    target.classList.remove('heading-target-active');
    void target.offsetWidth; // Force reflow
    target.classList.add('heading-target-active');

    setTimeout(() => {
      target.classList.remove('heading-target-active');
    }, 2000);
  }
}

/**
 * Filters the TOC list dynamically as the user types in the search field.
 */
function filterTocItems(query) {
  if (!appState.readerHeadings) return;
  const q = (query || '').trim().toLowerCase();

  if (!q) {
    renderTocList(appState.readerHeadings);
    return;
  }

  const filtered = appState.readerHeadings.filter(item =>
    (item.text || '').toLowerCase().includes(q)
  );
  renderTocList(filtered);
}

let isTocScrollLockInitialized = false;

/**
 * Initializes boundary scroll containment for the TOC side modal
 * to prevent scroll chaining to the background content when hitting top or bottom.
 */
function initTocScrollLock() {
  if (isTocScrollLockInitialized) return;
  const modal = document.getElementById('readerTocModal');
  const tocList = document.getElementById('readerTocList');
  if (!modal || !tocList) return;

  isTocScrollLockInitialized = true;

  // 1. Prevent touchmove scrolling on backdrop and non-scrollable header/filter
  modal.addEventListener('touchmove', (e) => {
    if (!e.target.closest('.side-modal-body')) {
      e.preventDefault();
    }
  }, { passive: false });

  // 2. Prevent touch scroll chaining at boundaries of .side-modal-body
  let startTouchY = 0;
  tocList.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 0) {
      startTouchY = e.touches[0].clientY;
    }
  }, { passive: true });

  tocList.addEventListener('touchmove', (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startTouchY;
    const isAtTop = tocList.scrollTop <= 0;
    const isAtBottom = Math.ceil(tocList.scrollTop + tocList.clientHeight) >= tocList.scrollHeight - 1;

    // Pulling down while at top (trying to scroll up beyond beginning)
    if (isAtTop && deltaY > 0) {
      e.preventDefault();
      return;
    }
    // Pushing up while at bottom (trying to scroll down past end of list)
    if (isAtBottom && deltaY < 0) {
      e.preventDefault();
      return;
    }
  }, { passive: false });

  // 3. Prevent mouse wheel / trackpad scroll chaining at boundaries
  tocList.addEventListener('wheel', (e) => {
    const isAtTop = tocList.scrollTop <= 0;
    const isAtBottom = Math.ceil(tocList.scrollTop + tocList.clientHeight) >= tocList.scrollHeight - 1;

    if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
      e.preventDefault();
    }
  }, { passive: false });
}

/**
 * Toggles the TOC side modal drawer open or closed.
 */
function toggleTocModal(show) {
  const modal = document.getElementById('readerTocModal');
  if (!modal) return;

  const shouldOpen = (show === undefined) ? modal.classList.contains('hidden') : Boolean(show);

  if (shouldOpen) {
    initTocScrollLock();

    // If headings haven't been scanned yet, scan them now
    if (!appState.readerHeadings || appState.readerHeadings.length === 0) {
      buildReaderTableOfContents();
    }
    modal.classList.remove('hidden');
    document.body.classList.add('body-toc-open');

    const searchInput = document.getElementById('tocSearchInput');
    if (searchInput) {
      searchInput.value = '';
      renderTocList(appState.readerHeadings);
    }
  } else {
    modal.classList.add('hidden');
    document.body.classList.remove('body-toc-open');
  }
}

/**
 * Resets the TOC state when closing or changing documents.
 */
function clearReaderTableOfContents() {
  appState.readerHeadings = [];
  const countBadge = document.getElementById('readerTocCount');
  if (countBadge) countBadge.textContent = '0';

  const listContainer = document.getElementById('readerTocList');
  if (listContainer) listContainer.innerHTML = '';

  const modal = document.getElementById('readerTocModal');
  if (modal && !modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
  }
  document.body.classList.remove('body-toc-open');
}

/* ==========================================================================
   TEXT TO SPEECH (TTS) ENGINE FOR READER VIEW (BACKGROUND & LOCK SCREEN ENABLED)
   - Ngôn ngữ mặc định: Tiếng Việt (vi-VN)
   - Tiêu đề (H1, H2): Giọng nữ (trong trẻo, nhịp độ tự nhiên 1.0, pitch cao 1.15-1.25)
   - Còn lại (H3-H6, p, li, blockquote): Giọng nam trầm, tốc độ nhanh hơn 25% (pitch 0.75, rate 1.25)
   - Đảm bảo đọc 100% khi tắt màn hình hoặc đưa app xuống background qua 4 tầng:
     1. Silent Audio Keep-Alive Loop (giữ OS Audio Session & Web Thread luôn active)
     2. Media Session API (điều khiển trực tiếp trên Màn hình khóa Lock Screen)
     3. Watchdog & Anti-Freeze Timer (khắc phục lỗi ngắt của Chromium và tự gỡ kẹt)
     4. Screen Wake Lock API (giữ sáng màn hình khi đang xem trực tiếp)
   ========================================================================== */

// Khoảng thời gian tự ngắt 0.1s (100ms) khi gặp dấu chấm câu, header, hoặc bullet
const TTS_PAUSE_DURATION_MS = 100;

const ttsState = {
  isSupported: true,
  mode: 'audio', // 'audio' (HTML5 Media Stream) | 'speechSynthesis' (Offline Fallback)
  language: (function() {
    try {
      return localStorage.getItem('gh_md_tts_lang') || 'vi';
    } catch (e) {
      return 'vi';
    }
  })(),
  active: false,
  playing: false,
  currentIndex: 0,
  items: [], // Array of { element, type: 'h1'|'h2'|'body', text, isHeader, isBullet, pauseAfterMs }
  femaleVoice: null,
  maleVoice: null,
  viVoices: [],
  enVoices: [],
  utterance: null,
  audioPlayer: null,
  preloadAudio: null,
  watchdogTimer: null,
  pauseTimeout: null,
  currentStartTimestamp: 0,
  wakeLock: null
};

/**
 * Generates Google Translate TTS audio URL for selected language (vi | en).
 */
function getTtsAudioUrl(text) {
  const clean = (text || '').trim();
  const encoded = encodeURIComponent(clean);
  const langCode = (ttsState.language === 'en') ? 'en' : 'vi';
  return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encoded}`;
}

/**
 * Returns or creates the dedicated HTML5 Audio element for media playback.
 */
function getTtsAudioPlayer() {
  if (!ttsState.audioPlayer) {
    let audio = document.getElementById('ttsAudioPlayer');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'ttsAudioPlayer';
      audio.playsInline = true;
      audio.preload = 'auto';
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }
    ttsState.audioPlayer = audio;
  }
  return ttsState.audioPlayer;
}

/**
 * Request Screen Wake Lock (keeps screen on if user leaves phone on desk).
 */
async function requestTtsWakeLock() {
  try {
    if ('wakeLock' in navigator && !ttsState.wakeLock) {
      ttsState.wakeLock = await navigator.wakeLock.request('screen');
      ttsState.wakeLock.addEventListener('release', () => {
        ttsState.wakeLock = null;
      });
    }
  } catch (e) {}
}

/**
 * Release Screen Wake Lock.
 */
function releaseTtsWakeLock() {
  try {
    if (ttsState.wakeLock) {
      ttsState.wakeLock.release().catch(() => {});
      ttsState.wakeLock = null;
    }
  } catch (e) {}
}

/**
 * Registers Media Session API for Lock Screen Controls & Bluetooth Headset (iOS & Android).
 */
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    const isEn = (ttsState.language === 'en');
    const defaultTitle = isEn ? 'Markdown Document' : 'Tài liệu Markdown';
    const fileName = appState.currentFile ? appState.currentFile.path.split('/').pop() : defaultTitle;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: fileName,
      artist: isEn ? 'GitHub Markdown Reader • English' : 'GitHub Markdown Reader • Tiếng Việt',
      album: isEn ? 'H1/H2 Female • Content Male' : 'H1/H2 Giọng nữ • Nội dung Giọng nam',
      artwork: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });

    const safeSetAction = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (err) {}
    };

    // Bluetooth Headset Remote Control Handlers (AVRCP / MediaKeys)
    safeSetAction('play', () => {
      ttsPlay();
    });
    safeSetAction('pause', () => {
      ttsPause();
    });
    safeSetAction('stop', () => {
      ttsPause(); // Safely pause so playback can be resumed from headset
    });
    safeSetAction('toggleplaypause', () => {
      ttsTogglePlayPause();
    });
    safeSetAction('previoustrack', () => {
      ttsPrev();
    });
    safeSetAction('nexttrack', () => {
      ttsNext();
    });
    safeSetAction('seekbackward', () => {
      ttsPrev();
    });
    safeSetAction('seekforward', () => {
      ttsNext();
    });
  } catch (e) {
    console.warn('[TTS] Media Session error:', e);
  }
}

/**
 * Updates Media Session playback state and segment info on Lock Screen and Bluetooth.
 */
function updateMediaSessionStatus() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = ttsState.playing ? 'playing' : 'paused';

    if (ttsState.items && ttsState.items.length > 0 && ttsState.currentIndex < ttsState.items.length) {
      const cur = ttsState.items[ttsState.currentIndex];
      const isEn = (ttsState.language === 'en');
      let roleText = '';
      if (cur.type === 'h1' || cur.type === 'h2') {
        roleText = isEn ? 'Female Voice' : 'Giọng nữ';
      } else {
        roleText = isEn ? 'Male Voice' : 'Giọng nam';
      }
      const defaultTitle = isEn ? 'Markdown Document' : 'Tài liệu Markdown';
      const fileName = appState.currentFile ? appState.currentFile.path.split('/').pop() : defaultTitle;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: `[${ttsState.currentIndex + 1}/${ttsState.items.length}] ${fileName}`,
        artist: `${roleText} • ${cur.text.slice(0, 50)}...`,
        album: isEn ? 'GitHub Markdown Reader (English)' : 'GitHub Markdown Reader (Tiếng Việt)',
        artwork: [
          { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });

      if ('setPositionState' in navigator.mediaSession && ttsState.audioPlayer && isFinite(ttsState.audioPlayer.duration) && ttsState.audioPlayer.duration > 0) {
        try {
          const dur = ttsState.audioPlayer.duration;
          const pos = Math.min(dur, Math.max(0, ttsState.audioPlayer.currentTime || 0));
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: ttsState.audioPlayer.playbackRate || 1.0,
            position: pos
          });
        } catch (posErr) {}
      }
    }
  } catch (e) {}
}

/**
 * Watchdog timer: verifies playback progress in background and auto-recovers if stuck.
 */
function startTtsWatchdog() {
  stopTtsWatchdog();
  ttsState.watchdogTimer = setInterval(() => {
    if (!ttsState.active || !ttsState.playing) return;

    // In audio mode: check if audio is paused unexpectedly while playing flag is true
    if (ttsState.mode === 'audio' && ttsState.audioPlayer) {
      if (ttsState.audioPlayer.paused && !ttsState.pauseTimeout) {
        ttsState.audioPlayer.play().catch(() => {});
      }
    }

    // In speech synthesis mode: keep Chrome synthesis active
    if (ttsState.mode === 'speechSynthesis' && 'speechSynthesis' in window) {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (e) {}
    }

    // Auto-recovery if a segment gets stuck longer than safety threshold
    if (ttsState.currentStartTimestamp > 0 && ttsState.items && ttsState.currentIndex < ttsState.items.length) {
      const item = ttsState.items[ttsState.currentIndex];
      const wordCount = (item.text || '').split(/\s+/).length;
      const maxAllowedDurationMs = Math.max(8000, (wordCount * 600) + 9000);
      const elapsedMs = Date.now() - ttsState.currentStartTimestamp;

      if (elapsedMs > maxAllowedDurationMs) {
        console.warn('[TTS Watchdog] Detected stuck segment in background. Auto-advancing...');
        ttsSpeakItem(ttsState.currentIndex + 1);
      }
    }
  }, 3000);
}

/**
 * Stops watchdog timer.
 */
function stopTtsWatchdog() {
  if (ttsState.watchdogTimer) {
    clearInterval(ttsState.watchdogTimer);
    ttsState.watchdogTimer = null;
  }
}

/**
 * Handle visibility changes (Lock screen / App minimized).
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // When returning to screen, sync visual highlight and scroll to active item
    if (ttsState.active && ttsState.items && ttsState.currentIndex < ttsState.items.length) {
      const item = ttsState.items[ttsState.currentIndex];
      document.querySelectorAll('.tts-active-reading').forEach(el => el.classList.remove('tts-active-reading'));
      if (item.element) {
        item.element.classList.add('tts-active-reading');
        try {
          item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
          item.element.scrollIntoView();
        }
      }
      updateTtsUI();
    }
  }
});

/**
 * Initializes and selects voices for fallback Web Speech API (Vietnamese & English).
 */
function initTtsVoices() {
  if (!('speechSynthesis' in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    ttsState.viVoices = voices.filter(v => {
      const lang = (v.lang || '').toLowerCase();
      return lang.startsWith('vi') || lang.includes('viet');
    });

    ttsState.enVoices = voices.filter(v => {
      const lang = (v.lang || '').toLowerCase();
      return lang.startsWith('en');
    });

    selectVoicesForLanguage();
  } catch (e) {
    console.warn('TTS voice init error:', e);
  }
}

/**
 * Selects female voice (for H1, H2) and male voice (for content) according to selected language.
 */
function selectVoicesForLanguage() {
  const isEn = (ttsState.language === 'en');
  const voiceList = isEn ? ttsState.enVoices : ttsState.viVoices;

  if (isEn) {
    // 1. English Female Voice
    ttsState.femaleVoice = voiceList.find(v => {
      const name = (v.name || '').toLowerCase();
      return name.includes('female') || name.includes('samantha') || name.includes('karen') ||
             name.includes('victoria') || name.includes('zira') || name.includes('ava') ||
             name.includes('allison') || name.includes('susan');
    }) || voiceList[0] || null;

    // 2. English Male Voice
    ttsState.maleVoice = voiceList.find(v => {
      const name = (v.name || '').toLowerCase();
      return (name.includes('male') || name.includes('alex') || name.includes('daniel') ||
              name.includes('david') || name.includes('fred') || name.includes('tom') ||
              name.includes('oliver') || name.includes('george')) &&
             !name.includes('female');
    }) || voiceList.find(v => v !== ttsState.femaleVoice) || voiceList[1] || voiceList[0] || null;
  } else {
    // 1. Vietnamese Female Voice
    ttsState.femaleVoice = voiceList.find(v => {
      const name = (v.name || '').toLowerCase();
      return name.includes('female') || name.includes('nữ') || name.includes('nu') ||
             name.includes('linh') || name.includes('hoaimy') || name.includes('mai') ||
             name.includes('chi') || name.includes('lan') || name.includes('an');
    }) || voiceList[0] || null;

    // 2. Vietnamese Male Voice
    ttsState.maleVoice = voiceList.find(v => {
      const name = (v.name || '').toLowerCase();
      return (name.includes('male') || name.includes('nam') || name.includes('namminh') ||
              name.includes('minh') || name.includes('trung') || name.includes('khoa')) &&
             !name.includes('female');
    });

    if (!ttsState.maleVoice && voiceList.length > 1) {
      ttsState.maleVoice = voiceList.find(v => v !== ttsState.femaleVoice) || voiceList[1];
    } else if (!ttsState.maleVoice) {
      ttsState.maleVoice = voiceList[0] || null;
    }
  }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    initTtsVoices();
  };
  initTtsVoices();
}

/**
 * Splits paragraph text into distinct speech units at punctuation marks
 * (e.g., periods, exclamation, question marks, colons, semicolons, ellipsis, em dashes).
 * Protects decimal numbers (e.g. 3.14) and common abbreviations from false splits.
 */
function splitTextIntoSentences(rawText) {
  if (!rawText) return [];
  let text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const PLACEHOLDER_DECIMAL = '__DECIMAL_DOT__';
  const PLACEHOLDER_ABBR = '__ABBR_DOT__';

  // 1. Protect decimal numbers (e.g., 3.14, 0.2) and common abbreviations (VI & EN)
  let protectedText = text
    .replace(/(\d+)\.(\d+)/g, '$1' + PLACEHOLDER_DECIMAL + '$2')
    .replace(/(v\.v|e\.g|i\.e|tp|th\.s|ts|dr|mr|mrs|ms|inc|ltd|co|corp|approx|vs|etc)\./gi, '$1' + PLACEHOLDER_ABBR);

  // 2. Segment at punctuation marks: . ! ? : ; … or end of string
  const regex = /[^.!?…;:]+([.!?…;:]+|$)/g;
  const rawMatches = protectedText.match(regex);
  const candidateSentences = [];

  if (rawMatches && rawMatches.length > 0) {
    rawMatches.forEach(m => {
      let s = m
        .replace(new RegExp(PLACEHOLDER_DECIMAL, 'g'), '.')
        .replace(new RegExp(PLACEHOLDER_ABBR, 'g'), '.')
        .trim();
      if (s.length > 0) candidateSentences.push(s);
    });
  } else {
    candidateSentences.push(text);
  }

  // 3. For extra-long sentences (>150 chars), split by commas to stay within TTS stream limits
  const finalSentences = [];
  candidateSentences.forEach(sentence => {
    if (sentence.length <= 150) {
      finalSentences.push(sentence);
    } else {
      const commaParts = sentence.split(/,\s*/);
      let currentChunk = '';
      commaParts.forEach((part, pIdx) => {
        const isLastPart = (pIdx === commaParts.length - 1);
        const suffix = isLastPart ? '' : ', ';
        if ((currentChunk + part + suffix).length > 140 && currentChunk.length > 0) {
          finalSentences.push(currentChunk.trim());
          currentChunk = part + suffix;
        } else {
          currentChunk += part + suffix;
        }
      });
      if (currentChunk.trim().length > 0) {
        finalSentences.push(currentChunk.trim());
      }
    }
  });

  return finalSentences.length > 0 ? finalSentences : [text];
}

/**
 * Extracts, segments into speech units, and cleans text elements from the markdown viewer panel for TTS.
 * Automatically enables 0.1s pause mechanism for:
 * - All punctuation marks (periods, commas, colons, semicolons, exclamation, question marks)
 * - All headers (H1 through H6)
 * - Every bullet list item (LI)
 */
function extractTtsItems() {
  const panel = document.getElementById('markdownViewerPanel');
  if (!panel) return [];

  const items = [];
  const candidates = panel.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote');

  candidates.forEach(el => {
    // Skip code blocks, diagrams, blank states, and hidden panels
    if (el.closest('.code-block-wrapper') || el.closest('pre') || el.closest('.mermaid') ||
        el.closest('.plantuml-diagram') || el.closest('.blankslate') || el.closest('.raw-content-panel')) {
      return;
    }

    // Avoid duplicate speech: if li contains p, we read the inner p elements instead
    if (el.tagName.toLowerCase() === 'li' && el.querySelector('p')) {
      return;
    }
    // If blockquote contains p or headings, read inner children instead
    if (el.tagName.toLowerCase() === 'blockquote' && el.querySelector('p, h1, h2, h3, h4, h5, h6')) {
      return;
    }

    // Clean text by cloning and stripping non-speech sub-elements:
    // Strictly strip code blocks, pre elements, copy buttons, SVGs, math, and styles
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.code-block-wrapper, pre, .btn-copy-code, button, svg, .katex-html, style, script').forEach(node => node.remove());

    // Also strip code elements that represent code blocks (syntax highlighted, language tagged, or multiline)
    clone.querySelectorAll('code').forEach(codeEl => {
      if (codeEl.classList.contains('hljs') ||
          (codeEl.className && codeEl.className.includes('language-')) ||
          (codeEl.textContent && codeEl.textContent.includes('\n')) ||
          (codeEl.textContent && codeEl.textContent.trim().length > 60)) {
        codeEl.remove();
      }
    });

    let text = (clone.textContent || '').trim();

    // Clean raw code fences, markdown artifact remnants, and format links
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/```[a-zA-Z0-9_-]*/g, '');
    text = text.replace(/```/g, '');
    text = text.replace(/^#+\s*/, '');
    const linkWord = (ttsState.language === 'en') ? 'link' : 'đường dẫn liên kết';
    text = text.replace(/https?:\/\/[^\s]+/g, linkWord);
    text = text.replace(/\s+/g, ' ').trim();

    // If empty, too short, or only punctuation remnants (e.g. ":", "-", "•", ".", ";")
    if (!text || text.length < 2 || /^[:\-\s•.,;]+$/.test(text)) return;

    const tag = el.tagName.toLowerCase();
    const isH1 = (tag === 'h1');
    const isH2 = (tag === 'h2');
    const isHeader = isH1 || isH2 || ['h3', 'h4', 'h5', 'h6'].includes(tag);
    const isBullet = (tag === 'li');

    let voiceType = 'body';
    if (isH1) voiceType = 'h1';
    else if (isH2) voiceType = 'h2';

    if (isHeader) {
      // Headers: Read complete title unit then apply 0.1s pause
      items.push({
        element: el,
        type: voiceType,
        text: text,
        isHeader: true,
        pauseAfterMs: TTS_PAUSE_DURATION_MS
      });
    } else {
      // Paragraphs & Bullets: Segment by punctuation marks with 0.1s pause for each sentence/bullet
      const sentences = splitTextIntoSentences(text);
      sentences.forEach((sentenceText, sIdx) => {
        items.push({
          element: el,
          type: voiceType,
          text: sentenceText,
          isHeader: false,
          isBullet: isBullet && (sIdx === sentences.length - 1),
          pauseAfterMs: TTS_PAUSE_DURATION_MS
        });
      });
    }
  });

  return items;
}

/**
 * Plays speech unit via HTML5 Audio Stream (persistent when screen locked).
 */
function playViaAudioElement(item, index) {
  ttsState.mode = 'audio';
  const audio = getTtsAudioPlayer();

  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  const audioUrl = getTtsAudioUrl(item.text);
  audio.src = audioUrl;

  // Voice rules:
  // - Headers H1 & H2: Female voice (natural pitch, clear speed 1.0)
  // - Others: Male voice (faster by 25%: playbackRate 1.25, preserves pitch)
  if (item.type === 'h1' || item.type === 'h2') {
    audio.preservesPitch = true;
    audio.playbackRate = 1.0;
  } else {
    audio.preservesPitch = true;
    audio.playbackRate = 1.25; // Nhanh hơn 25% theo yêu cầu
  }

  audio.onended = () => {
    if (ttsState.playing && ttsState.active) {
      if (ttsState.pauseTimeout) {
        clearTimeout(ttsState.pauseTimeout);
      }
      const pauseDuration = item.pauseAfterMs || TTS_PAUSE_DURATION_MS; // 0.1s
      ttsState.pauseTimeout = setTimeout(() => {
        if (ttsState.playing && ttsState.active) {
          ttsSpeakItem(index + 1);
        }
      }, pauseDuration);
    }
  };

  audio.onerror = (e) => {
    console.warn('[TTS Audio Stream] Fallback to SpeechSynthesis due to audio error:', e);
    playViaSpeechSynthesis(item, index);
  };

  ttsState.playing = true;
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      updateMediaSessionStatus();
    }).catch(err => {
      console.warn('[TTS Audio play notice]:', err);
      playViaSpeechSynthesis(item, index);
    });
  }
}

/**
 * Plays speech unit via Web Speech API (offline fallback).
 */
function playViaSpeechSynthesis(item, index) {
  ttsState.mode = 'speechSynthesis';
  if (!('speechSynthesis' in window)) {
    showFlash('Trình duyệt không hỗ trợ Web Speech API.', 'warning');
    return;
  }

  if (ttsState.audioPlayer) {
    try { ttsState.audioPlayer.pause(); } catch (e) {}
  }

  try { window.speechSynthesis.cancel(); } catch (e) {}

  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = (ttsState.language === 'en') ? 'en-US' : 'vi-VN';

  if (item.type === 'h1' || item.type === 'h2') {
    if (ttsState.femaleVoice) utterance.voice = ttsState.femaleVoice;
    utterance.pitch = ttsState.femaleVoice ? 1.15 : 1.25;
    utterance.rate = 1.0;
  } else {
    if (ttsState.maleVoice) utterance.voice = ttsState.maleVoice;
    utterance.pitch = (ttsState.language === 'en') ? 0.85 : 0.75;
    utterance.rate = 1.25; // Nhanh hơn 25%
  }

  utterance.onend = () => {
    if (ttsState.playing && ttsState.active) {
      if (ttsState.pauseTimeout) clearTimeout(ttsState.pauseTimeout);
      const pauseDuration = item.pauseAfterMs || TTS_PAUSE_DURATION_MS;
      ttsState.pauseTimeout = setTimeout(() => {
        if (ttsState.playing && ttsState.active) {
          ttsSpeakItem(index + 1);
        }
      }, pauseDuration);
    }
  };

  utterance.onerror = (event) => {
    if (event.error === 'canceled' || event.error === 'interrupted') return;
    if (ttsState.playing && ttsState.active) {
      ttsSpeakItem(index + 1);
    }
  };

  ttsState.utterance = utterance;
  ttsState.playing = true;

  try {
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.error('SpeechSynthesis.speak error:', e);
  }
}

/**
 * Speaks the TTS item at the specified index with 0.1s pause and background support.
 */
function ttsSpeakItem(index) {
  if (ttsState.pauseTimeout) {
    clearTimeout(ttsState.pauseTimeout);
    ttsState.pauseTimeout = null;
  }

  if (!ttsState.items || ttsState.items.length === 0) {
    showFlash('Không tìm thấy nội dung văn bản để đọc.', 'info');
    ttsStop();
    return;
  }

  if (index < 0 || index >= ttsState.items.length) {
    ttsStop();
    showFlash('Đã đọc xong 100% nội dung bài viết.', 'success');
    return;
  }

  ttsState.currentIndex = index;
  ttsState.currentStartTimestamp = Date.now();
  const item = ttsState.items[index];

  // Update DOM highlights smoothly
  if (document.visibilityState === 'visible') {
    const prevItem = (index > 0 && ttsState.items[index - 1]) ? ttsState.items[index - 1] : null;
    if (!prevItem || prevItem.element !== item.element) {
      document.querySelectorAll('.tts-active-reading').forEach(el => el.classList.remove('tts-active-reading'));
      if (item.element) {
        item.element.classList.add('tts-active-reading');
        try {
          item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
          item.element.scrollIntoView();
        }
      }
    }
  }

  // Preload next audio unit in background to eliminate transition latency
  if (index + 1 < ttsState.items.length && navigator.onLine) {
    try {
      if (!ttsState.preloadAudio) {
        ttsState.preloadAudio = new Audio();
      }
      ttsState.preloadAudio.src = getTtsAudioUrl(ttsState.items[index + 1].text);
      ttsState.preloadAudio.preload = 'auto';
    } catch (e) {}
  }

  // Choose playback engine: HTML5 Media Stream (screen-off persistent) or SpeechSynthesis (offline)
  if (navigator.onLine) {
    playViaAudioElement(item, index);
  } else {
    playViaSpeechSynthesis(item, index);
  }

  updateTtsUI();
  updateMediaSessionStatus();
}

/**
 * Updates UI elements for TTS (Soundwave, Badges, Progress, Button Icons).
 */
function updateTtsUI() {
  const controlBar = document.getElementById('ttsControlBar');
  const soundwave = document.getElementById('ttsSoundwave');
  const voiceRoleBadge = document.getElementById('ttsVoiceRoleBadge');
  const progressText = document.getElementById('ttsProgressText');
  const playPauseIcon = document.getElementById('ttsPlayPauseIcon');
  const btnToggleTts = document.getElementById('btnToggleTts');
  const btnHeaderTts = document.getElementById('btnHeaderTts');
  const ttsBtnLabel = document.getElementById('ttsBtnLabel');

  if (controlBar) {
    if (ttsState.active) {
      controlBar.classList.remove('hidden');
    } else {
      controlBar.classList.add('hidden');
    }
  }

  if (btnToggleTts) {
    if (ttsState.active) {
      btnToggleTts.classList.add('active');
      if (ttsBtnLabel) ttsBtnLabel.textContent = ttsState.playing ? 'Đang đọc' : 'Tạm dừng';
    } else {
      btnToggleTts.classList.remove('active');
      if (ttsBtnLabel) ttsBtnLabel.textContent = 'Đọc';
    }
  }

  if (btnHeaderTts) {
    if (ttsState.active) {
      btnHeaderTts.classList.add('tts-active');
    } else {
      btnHeaderTts.classList.remove('tts-active');
    }
  }

  if (soundwave) {
    if (ttsState.playing) {
      soundwave.classList.add('active');
    } else {
      soundwave.classList.remove('active');
    }
  }

  // Update Play/Pause Icon and Label
  const playPauseText = document.getElementById('ttsPlayPauseText');
  const isEn = (ttsState.language === 'en');
  if (playPauseIcon) {
    if (ttsState.playing) {
      // Pause icon
      playPauseIcon.innerHTML = `
        <path d="M4.5 3.25A.75.75 0 0 1 5.25 4v8a.75.75 0 0 1-1.5 0V4a.75.75 0 0 1 .75-.75Zm7 0a.75.75 0 0 1 .75v8a.75.75 0 0 1-1.5 0V4a.75.75 0 0 1 .75-.75Z"></path>
      `;
      if (playPauseText) playPauseText.textContent = isEn ? 'Pause' : 'Tạm dừng';
    } else {
      // Play icon
      playPauseIcon.innerHTML = `
        <path d="M4.5 3.75A.75.75 0 0 1 5.7 3.12l7 4.25a.75.75 0 0 1 0 1.26l-7 4.25A.75.75 0 0 1 4.5 12.25v-8.5Z"></path>
      `;
      if (playPauseText) playPauseText.textContent = isEn ? 'Resume' : 'Tiếp tục';
    }
  }

  const stopBtnText = document.getElementById('ttsStopBtnText');
  if (stopBtnText) {
    stopBtnText.textContent = isEn ? 'Stop' : 'Dừng';
  }

  // Update Language Badge Text
  const langBadgeText = document.getElementById('ttsLangBadgeText');
  if (langBadgeText) {
    langBadgeText.textContent = (ttsState.language === 'en') ? '🇬🇧 EN' : '🇻🇳 VI';
  }

  // Update Role Badge and Progress
  if (ttsState.items && ttsState.items.length > 0 && ttsState.currentIndex < ttsState.items.length) {
    const cur = ttsState.items[ttsState.currentIndex];
    const isEn = (ttsState.language === 'en');
    if (voiceRoleBadge) {
      if (cur.type === 'h1') {
        voiceRoleBadge.textContent = isEn ? 'H1 • Female' : 'H1 • Giọng nữ';
        voiceRoleBadge.className = 'tts-voice-role role-female';
      } else if (cur.type === 'h2') {
        voiceRoleBadge.textContent = isEn ? 'H2 • Female' : 'H2 • Giọng nữ';
        voiceRoleBadge.className = 'tts-voice-role role-female';
      } else {
        voiceRoleBadge.textContent = isEn ? 'Content • Male' : 'Nội dung • Giọng nam';
        voiceRoleBadge.className = 'tts-voice-role role-male';
      }
    }
    if (progressText) {
      progressText.textContent = isEn
        ? `Part ${ttsState.currentIndex + 1} / ${ttsState.items.length}`
        : `Đoạn ${ttsState.currentIndex + 1} / ${ttsState.items.length}`;
    }
  }
}

/**
 * Attaches interactive click-to-speak listeners to all paragraphs.
 * Maps each element to its first sentence index.
 */
function attachTtsClickListeners() {
  const panel = document.getElementById('markdownViewerPanel');
  if (panel) panel.classList.add('tts-mode-active');

  const elementFirstIndexMap = new Map();
  ttsState.items.forEach((item, idx) => {
    if (item.element && !elementFirstIndexMap.has(item.element)) {
      elementFirstIndexMap.set(item.element, idx);
    }
  });

  elementFirstIndexMap.forEach((firstIdx, el) => {
    el.dataset.ttsIndex = firstIdx;
    el.onclick = (e) => {
      if (ttsState.active) {
        e.stopPropagation();
        ttsSpeakItem(firstIdx);
      }
    };
  });

  // Prevent clicks or interactions with code blocks from triggering speech
  panel.querySelectorAll('.code-block-wrapper, pre').forEach(codeBlock => {
    codeBlock.onclick = (e) => {
      e.stopPropagation();
    };
  });
}

/**
 * Detaches interactive click-to-speak listeners.
 */
function detachTtsClickListeners() {
  const panel = document.getElementById('markdownViewerPanel');
  if (panel) {
    panel.classList.remove('tts-mode-active');
    panel.querySelectorAll('.code-block-wrapper, pre').forEach(codeBlock => {
      codeBlock.onclick = null;
    });
  }

  ttsState.items.forEach((item) => {
    if (item.element) {
      delete item.element.dataset.ttsIndex;
      item.element.onclick = null;
    }
  });
}

/**
 * Toggles TTS player on/off or play/pause.
 * If inactive, opens language selection modal to let user choose Vietnamese or English.
 */
function toggleTtsPlayer() {
  if (ttsState.active) {
    ttsTogglePlayPause();
  } else {
    showTtsLanguageModal();
  }
}

/**
 * Shows the Language Selection Modal for TTS.
 */
function showTtsLanguageModal() {
  const modal = document.getElementById('ttsLanguageModal');
  if (!modal) return;

  const currentLang = ttsState.language || localStorage.getItem('gh_md_tts_lang') || 'vi';
  const optVi = document.getElementById('ttsOptVi');
  const optEn = document.getElementById('ttsOptEn');

  if (optVi && optEn) {
    if (currentLang === 'en') {
      optVi.classList.remove('active');
      optEn.classList.add('active');
    } else {
      optVi.classList.add('active');
      optEn.classList.remove('active');
    }
  }

  modal.classList.remove('hidden');
}

/**
 * Closes the Language Selection Modal.
 */
function closeTtsLanguageModal() {
  const modal = document.getElementById('ttsLanguageModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Selects reading language and starts or updates TTS playback.
 */
function selectTtsLanguageAndStart(lang) {
  ttsState.language = (lang === 'en') ? 'en' : 'vi';
  try {
    localStorage.setItem('gh_md_tts_lang', ttsState.language);
  } catch (e) {}

  closeTtsLanguageModal();

  if (ttsState.active) {
    // If player is already active and user switched language from player bar
    initTtsVoices();
    ttsState.items = extractTtsItems();
    updateTtsUI();
    updateMediaSessionStatus();
    ttsSpeakItem(ttsState.currentIndex);
  } else {
    // Start fresh reading session
    initTtsVoices();
    ttsState.items = extractTtsItems();
    if (ttsState.items.length === 0) {
      showFlash((ttsState.language === 'en') ? 'No readable text found.' : 'Không có văn bản nào để đọc.', 'info');
      return;
    }
    ttsState.active = true;
    setupMediaSession();
    requestTtsWakeLock();
    startTtsWatchdog();
    attachTtsClickListeners();
    ttsSpeakItem(0);
  }
}

/**
 * Explicitly pauses TTS playback (supports Bluetooth Remote, Lock Screen & In-App UI).
 */
function ttsPause() {
  if (!ttsState.active) return;

  // Clear any pause interval
  if (ttsState.pauseTimeout) {
    clearTimeout(ttsState.pauseTimeout);
    ttsState.pauseTimeout = null;
  }

  if (ttsState.playing) {
    ttsState.playing = false;

    if (ttsState.mode === 'audio' && ttsState.audioPlayer) {
      try {
        if (!ttsState.audioPlayer.paused) {
          ttsState.audioPlayer.pause();
        }
      } catch (e) {}
    } else if ('speechSynthesis' in window) {
      try { window.speechSynthesis.pause(); } catch (e) {}
    }

    stopTtsWatchdog();
    releaseTtsWakeLock();
    updateTtsUI();
    updateMediaSessionStatus();
  }
}

/**
 * Explicitly resumes TTS playback (supports Bluetooth Remote, Lock Screen & In-App UI).
 */
function ttsPlay() {
  if (!ttsState.active) {
    toggleTtsPlayer();
    return;
  }
  if (ttsState.playing) return;

  if (ttsState.pauseTimeout) {
    clearTimeout(ttsState.pauseTimeout);
    ttsState.pauseTimeout = null;
  }

  ttsState.playing = true;
  requestTtsWakeLock();
  startTtsWatchdog();

  if (ttsState.mode === 'audio' && ttsState.audioPlayer && ttsState.audioPlayer.src) {
    ttsState.audioPlayer.play().catch(() => {
      ttsSpeakItem(ttsState.currentIndex);
    });
    updateTtsUI();
    updateMediaSessionStatus();
  } else if (window.speechSynthesis && window.speechSynthesis.paused) {
    try { window.speechSynthesis.resume(); } catch (e) {}
    updateTtsUI();
    updateMediaSessionStatus();
  } else {
    ttsSpeakItem(ttsState.currentIndex);
  }
}

/**
 * Toggles play and pause state of the current speech.
 */
function ttsTogglePlayPause() {
  if (!ttsState.active) {
    toggleTtsPlayer();
    return;
  }
  if (ttsState.playing) {
    ttsPause();
  } else {
    ttsPlay();
  }
}

/**
 * Skips to next paragraph or sentence.
 */
function ttsNext() {
  if (!ttsState.active || !ttsState.items || ttsState.items.length === 0) return;
  if (ttsState.pauseTimeout) {
    clearTimeout(ttsState.pauseTimeout);
    ttsState.pauseTimeout = null;
  }
  const nextIdx = ttsState.currentIndex + 1;
  if (nextIdx < ttsState.items.length) {
    ttsSpeakItem(nextIdx);
  } else {
    showFlash((ttsState.language === 'en') ? 'Reached end of document.' : 'Đã đến cuối tài liệu.', 'info');
  }
}

/**
 * Goes back to previous paragraph or sentence.
 */
function ttsPrev() {
  if (!ttsState.active || !ttsState.items || ttsState.items.length === 0) return;
  if (ttsState.pauseTimeout) {
    clearTimeout(ttsState.pauseTimeout);
    ttsState.pauseTimeout = null;
  }
  const prevIdx = Math.max(0, ttsState.currentIndex - 1);
  ttsSpeakItem(prevIdx);
}

/**
 * Stops TTS playback and resets highlighting.
 */
function ttsStop() {
  if (ttsState.pauseTimeout) {
    clearTimeout(ttsState.pauseTimeout);
    ttsState.pauseTimeout = null;
  }

  if (ttsState.audioPlayer) {
    try {
      ttsState.audioPlayer.pause();
      ttsState.audioPlayer.currentTime = 0;
    } catch (e) {}
  }

  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  ttsState.playing = false;
  ttsState.active = false;
  ttsState.currentIndex = 0;
  ttsState.currentStartTimestamp = 0;

  stopTtsWatchdog();
  releaseTtsWakeLock();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
  }

  detachTtsClickListeners();
  document.querySelectorAll('.tts-active-reading').forEach(el => el.classList.remove('tts-active-reading'));

  updateTtsUI();
}

/**
 * Closes floating player bar and stops speech.
 */
function ttsClose() {
  ttsStop();
}

/* ==========================================================================
   MARKDOWN EDITOR & GITHUB COMMIT / PUSH MODULE
   ========================================================================== */

/**
 * Attaches input and keyboard listeners for the Markdown editor and commit modal.
 */
function initMarkdownEditorListeners() {
  const textarea = document.getElementById('markdownEditorTextarea');
  if (textarea) {
    textarea.addEventListener('input', () => {
      updateEditorDirtyUI();
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + '  ' + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        updateEditorDirtyUI();
      }
    });
  }

  const commitMsgInput = document.getElementById('commitMessageInput');
  if (commitMsgInput) {
    commitMsgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        executeCommitAndPush();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const descInput = document.getElementById('commitDescriptionInput');
        if (descInput) descInput.focus();
      }
    });
  }

  const commitDescInput = document.getElementById('commitDescriptionInput');
  if (commitDescInput) {
    commitDescInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        executeCommitAndPush();
      }
    });
  }
}

/**
 * Checks whether the editor currently holds unsaved modifications.
 */
function hasEditorUnsavedChanges() {
  if (!appState.isEditing) return false;
  const textarea = document.getElementById('markdownEditorTextarea');
  if (!textarea) return false;
  return textarea.value !== appState.editorOriginalContent;
}

/**
 * Prompts confirmation before discarding unsaved editor modifications.
 */
function confirmDiscardEditorChanges() {
  if (!hasEditorUnsavedChanges()) return true;
  return confirm('Bạn có thay đổi chưa được push lên GitHub.\nBạn có chắc chắn muốn hủy bỏ các thay đổi này không?');
}

/**
 * Updates the editor header status text and Push button state.
 */
function updateEditorDirtyUI() {
  const dirtyBadge = document.getElementById('editorDirtyBadge');
  const btnPush = document.getElementById('btnEditorPush');
  const isDirty = hasEditorUnsavedChanges();

  if (dirtyBadge) {
    if (isDirty) {
      dirtyBadge.textContent = '● Đã thay đổi (Chưa push)';
      dirtyBadge.classList.add('is-dirty');
    } else {
      dirtyBadge.textContent = 'Đang chỉnh sửa (Chưa sửa)';
      dirtyBadge.classList.remove('is-dirty');
    }
  }

  if (btnPush) {
    btnPush.disabled = !isDirty;
  }
}

/**
 * Enters Markdown Edit Mode for the currently opened file.
 */
function enterEditMode() {
  if (!appState.currentFile) {
    showFlash('Vui lòng mở một tệp Markdown trước khi chỉnh sửa.', 'info');
    return;
  }

  if (appState.currentFileContent === null || appState.currentFileContent === undefined) {
    showFlash('Tài liệu đang tải, vui lòng thử lại sau giây lát.', 'info');
    return;
  }

  if (!appState.token) {
    showFlash('Cần kết nối GitHub PAT để chỉnh sửa và push lên repo.', 'error');
    return;
  }

  if (typeof ttsStop === 'function' && typeof ttsState !== 'undefined' && ttsState.active) {
    ttsStop();
  }
  toggleTocModal(false);

  appState.isEditing = true;
  appState.editorTab = 'write';
  appState.editorOriginalContent = appState.currentFileContent || '';

  const fileName = appState.currentFile.path.split('/').pop() || 'document.md';
  const headerFileNameEl = document.getElementById('editorHeaderFileName');
  if (headerFileNameEl) {
    headerFileNameEl.textContent = fileName;
  }

  const editorBar = document.getElementById('editorControlBar');
  if (editorBar) editorBar.classList.remove('hidden');

  const viewerMobileHeader = document.querySelector('#viewViewer .viewer-mobile-header');
  if (viewerMobileHeader) viewerMobileHeader.classList.add('hidden');

  const viewerBody = document.querySelector('#viewViewer .viewer-body');
  if (viewerBody) viewerBody.classList.add('is-editing');

  const viewerPanel = document.getElementById('markdownViewerPanel');
  const rawPanel = document.getElementById('rawMarkdownPanel');
  const editorContainer = document.getElementById('markdownEditorContainer');

  if (viewerPanel) viewerPanel.classList.add('hidden');
  if (rawPanel) rawPanel.classList.add('hidden');
  if (editorContainer) editorContainer.classList.remove('hidden');

  const textarea = document.getElementById('markdownEditorTextarea');
  if (textarea) {
    textarea.value = appState.editorOriginalContent;
  }

  switchEditorTab('write');
  updateEditorDirtyUI();

  if (textarea) {
    setTimeout(() => {
      textarea.focus();
    }, 50);
  }
}

/**
 * Cancels editing (with confirmation if dirty) and restores Reader mode.
 */
function cancelEditMode() {
  if (!confirmDiscardEditorChanges()) {
    return;
  }
  exitEditModeUI();
}

/**
 * Restores Reader view UI from Edit mode without prompting.
 */
function exitEditModeUI() {
  appState.isEditing = false;
  appState.editorTab = 'write';

  closeCommitPushModal();

  const editorBar = document.getElementById('editorControlBar');
  if (editorBar) editorBar.classList.add('hidden');

  const viewerMobileHeader = document.querySelector('#viewViewer .viewer-mobile-header');
  if (viewerMobileHeader) viewerMobileHeader.classList.remove('hidden');

  const viewerBody = document.querySelector('#viewViewer .viewer-body');
  if (viewerBody) viewerBody.classList.remove('is-editing');

  const editorContainer = document.getElementById('markdownEditorContainer');
  if (editorContainer) editorContainer.classList.add('hidden');

  const viewerPanel = document.getElementById('markdownViewerPanel');
  const rawPanel = document.getElementById('rawMarkdownPanel');

  if (appState.isRawView) {
    if (viewerPanel) viewerPanel.classList.add('hidden');
    if (rawPanel) rawPanel.classList.remove('hidden');
  } else {
    if (viewerPanel) viewerPanel.classList.remove('hidden');
    if (rawPanel) rawPanel.classList.add('hidden');
  }
}

/**
 * Switches between 'write' (Textarea) and 'preview' (Rendered Markdown) inside Edit Mode.
 */
function switchEditorTab(tab) {
  appState.editorTab = tab;

  const btnWrite = document.getElementById('btnEditorTabWrite');
  const btnPreview = document.getElementById('btnEditorTabPreview');
  const writePane = document.getElementById('markdownEditorWritePane');
  const previewPane = document.getElementById('markdownEditorPreviewPane');
  const formatTools = document.getElementById('editorFormatTools');
  const textarea = document.getElementById('markdownEditorTextarea');

  if (tab === 'preview') {
    if (btnWrite) {
      btnWrite.classList.remove('active');
      btnWrite.setAttribute('aria-selected', 'false');
    }
    if (btnPreview) {
      btnPreview.classList.add('active');
      btnPreview.setAttribute('aria-selected', 'true');
    }
    if (writePane) writePane.classList.add('hidden');
    if (formatTools) formatTools.classList.add('hidden');
    if (previewPane) {
      previewPane.classList.remove('hidden');
      renderEditorPreviewContent(textarea ? textarea.value : '', previewPane);
    }
  } else {
    if (btnWrite) {
      btnWrite.classList.add('active');
      btnWrite.setAttribute('aria-selected', 'true');
    }
    if (btnPreview) {
      btnPreview.classList.remove('active');
      btnPreview.setAttribute('aria-selected', 'false');
    }
    if (previewPane) previewPane.classList.add('hidden');
    if (writePane) writePane.classList.remove('hidden');
    if (formatTools) formatTools.classList.remove('hidden');
  }
}

/**
 * Renders live Markdown preview inside the Editor Preview pane (GFM, Mermaid, PlantUML, KaTeX, Highlight.js).
 */
function renderEditorPreviewContent(rawText, targetPanel) {
  if (!targetPanel) return;

  if (!rawText || !rawText.trim()) {
    targetPanel.innerHTML = '<div class="blankslate"><p class="text-muted">Chưa có nội dung để xem trước.</p></div>';
    return;
  }

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
      return `<div class="plantuml-diagram"><img src="${url}" alt="PlantUML Diagram"></div>`;
    }

    const escapedCode = escapeHtml(code);
    return `<div class="code-block-wrapper"><pre><code class="hljs language-${lang}">${escapedCode}</code></pre></div>`;
  };

  marked.setOptions({ renderer });
  const rawHtml = marked.parse(rawText);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['div', 'img', 'button', 'span', 'svg', 'path'],
    ADD_ATTR: ['src', 'alt', 'class', 'type', 'title', 'aria-label', 'viewBox', 'width', 'height', 'fill', 'd']
  });

  targetPanel.innerHTML = cleanHtml;

  if (window.renderMathInElement) {
    try {
      renderMathInElement(targetPanel, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {}
  }

  if (window.mermaid) {
    try {
      const mNodes = targetPanel.querySelectorAll('.mermaid');
      if (mNodes.length > 0) {
        mermaid.run({ nodes: Array.from(mNodes) }).catch(() => {});
      }
    } catch (e) {}
  }

  targetPanel.querySelectorAll('pre code').forEach((block) => {
    if (window.hljs && typeof window.hljs.highlightElement === 'function') {
      try { window.hljs.highlightElement(block); } catch (e) {}
    }
  });
}

/**
 * Inserts or wraps Markdown syntax at the current cursor selection in the editor textarea.
 */
function insertEditorMarkdown(type) {
  const textarea = document.getElementById('markdownEditorTextarea');
  if (!textarea) return;

  if (appState.editorTab !== 'write') {
    switchEditorTab('write');
  }

  textarea.focus();
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.substring(start, end);

  let before = '';
  let middle = selected;
  let after = '';

  const needsNewlinePrefix = start > 0 && val[start - 1] !== '\n';

  switch (type) {
    case 'h1':
      before = (needsNewlinePrefix ? '\n' : '') + '# ';
      middle = selected || 'Tiêu đề 1';
      break;
    case 'h2':
      before = (needsNewlinePrefix ? '\n' : '') + '## ';
      middle = selected || 'Tiêu đề 2';
      break;
    case 'bold':
      before = '**';
      middle = selected || 'văn bản in đậm';
      after = '**';
      break;
    case 'italic':
      before = '*';
      middle = selected || 'văn bản in nghiêng';
      after = '*';
      break;
    case 'code':
      before = '`';
      middle = selected || 'code';
      after = '`';
      break;
    case 'codeblock':
      before = (needsNewlinePrefix ? '\n' : '') + '```\n';
      middle = selected || '// code';
      after = '\n```\n';
      break;
    case 'list':
      before = (needsNewlinePrefix ? '\n' : '') + '- ';
      middle = selected || 'Mục danh sách';
      break;
    case 'task':
      before = (needsNewlinePrefix ? '\n' : '') + '- [ ] ';
      middle = selected || 'Công việc cần làm';
      break;
    case 'quote':
      before = (needsNewlinePrefix ? '\n' : '') + '> ';
      middle = selected || 'Trích dẫn';
      break;
    case 'link':
      before = '[';
      middle = selected || 'tiêu đề liên kết';
      after = '](https://)';
      break;
    default:
      return;
  }

  const replacement = before + middle + after;
  textarea.setRangeText(replacement, start, end, 'select');
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + middle.length;
  updateEditorDirtyUI();
}

/**
 * Opens the Commit & Push confirmation modal.
 */
function openCommitPushModal() {
  if (!appState.isEditing || !appState.currentFile) return;

  if (!hasEditorUnsavedChanges()) {
    showFlash('Nội dung chưa có thay đổi nào để push lên GitHub.', 'info');
    return;
  }

  if (!navigator.onLine || appState.isOffline) {
    showFlash('Bạn đang ngoại tuyến (Offline). Vui lòng kết nối mạng để push thay đổi.', 'error', 4000);
    return;
  }

  if (!appState.token) {
    showFlash('Cần kết nối GitHub PAT để thực hiện push.', 'error');
    return;
  }

  const { owner, name, path } = appState.currentFile;
  const fileName = path.split('/').pop() || 'document.md';
  const targetBranch = (appState.currentRepo && appState.currentRepo.owner === owner && appState.currentRepo.name === name && appState.currentRepo.defaultBranch)
    ? appState.currentRepo.defaultBranch
    : 'default branch';

  const targetInfoEl = document.getElementById('commitTargetInfo');
  if (targetInfoEl) {
    targetInfoEl.innerHTML = `
      <div><span class="text-muted">Repo:</span> <strong>${escapeHtml(owner)}/${escapeHtml(name)}</strong> <span class="text-muted">(${escapeHtml(targetBranch)})</span></div>
      <div><span class="text-muted">Tệp:</span> <code>${escapeHtml(path)}</code></div>
    `;
  }

  const msgInput = document.getElementById('commitMessageInput');
  if (msgInput) {
    msgInput.value = `Update ${fileName}`;
  }

  const descInput = document.getElementById('commitDescriptionInput');
  if (descInput) {
    descInput.value = '';
  }

  const errEl = document.getElementById('commitPushError');
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  setCommitPushLoadingState(false);

  const modal = document.getElementById('commitPushModal');
  if (modal) {
    modal.classList.remove('hidden');
    if (msgInput) {
      setTimeout(() => {
        msgInput.focus();
        msgInput.select();
      }, 60);
    }
  }
}

/**
 * Closes the Commit & Push confirmation modal.
 */
function closeCommitPushModal() {
  if (appState.isPushingCommit) return;
  const modal = document.getElementById('commitPushModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Toggles loading spinner and button disabled states during GitHub API push.
 */
function setCommitPushLoadingState(isLoading) {
  appState.isPushingCommit = isLoading;
  const btnConfirm = document.getElementById('btnConfirmPush');
  const btnCancel = document.getElementById('btnCancelCommitModal');
  const btnClose = document.getElementById('btnCloseCommitModal');
  const msgInput = document.getElementById('commitMessageInput');
  const descInput = document.getElementById('commitDescriptionInput');

  if (btnCancel) btnCancel.disabled = isLoading;
  if (btnClose) btnClose.disabled = isLoading;
  if (msgInput) msgInput.disabled = isLoading;
  if (descInput) descInput.disabled = isLoading;

  if (btnConfirm) {
    btnConfirm.disabled = isLoading;
    if (isLoading) {
      btnConfirm.innerHTML = `
        <svg class="octicon octicon-sync is-spinning" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
          <path d="M1.705 8.005a6.295 6.295 0 0 1 11.252-3.712l-1.606 1.606a.75.75 0 1 0 1.06 1.06l2.885-2.886a.75.75 0 0 0 0-1.06L13.41.127a.75.75 0 0 0-1.06 1.06l1.378 1.378A7.795 7.795 0 0 0 .205 8.005a.75.75 0 0 0 1.5 0Zm12.59 0a6.295 6.295 0 0 1-11.252 3.712l1.606-1.606a.75.75 0 1 0-1.06-1.06L.704 11.937a.75.75 0 0 0 0 1.06l2.885 2.886a.75.75 0 0 0 1.06-1.06l-1.378-1.378a7.795 7.795 0 0 0 13.734-5.44.75.75 0 0 0-1.5 0Z"></path>
        </svg>
        <span>Đang push...</span>
      `;
    } else {
      btnConfirm.innerHTML = `
        <svg class="octicon octicon-repo-push" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
          <path d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V1.5h-8a1 1 0 0 0-1 1v6.708A2.493 2.493 0 0 1 3.5 9h3.25a.75.75 0 0 1 0 1.5H3.5a1 1 0 0 0 0 2h5.75a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 11.5Zm13.23 7.79h-.001l-1.224-1.224v6.184a.75.75 0 0 1-1.5 0V9.066L10.28 10.29a.75.75 0 0 1-1.06-1.061l2.505-2.504a.75.75 0 0 1 1.06 0L15.29 9.23a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018Z"></path>
        </svg>
        <span>Commit &amp; Push</span>
      `;
    }
  }
}

/**
 * Executes GitHub REST API PUT /repos/{owner}/{repo}/contents/{path} to commit & push changes.
 */
async function executeCommitAndPush() {
  if (appState.isPushingCommit || !appState.currentFile) return;

  const textarea = document.getElementById('markdownEditorTextarea');
  const msgInput = document.getElementById('commitMessageInput');
  const descInput = document.getElementById('commitDescriptionInput');
  const errEl = document.getElementById('commitPushError');

  if (!textarea || !msgInput) return;

  const newContent = textarea.value;
  const fileName = appState.currentFile.path.split('/').pop() || 'document.md';
  const commitSummary = msgInput.value.trim() || `Update ${fileName}`;
  const commitDesc = descInput ? descInput.value.trim() : '';
  const fullCommitMessage = commitDesc ? `${commitSummary}\n\n${commitDesc}` : commitSummary;

  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  if (!navigator.onLine || appState.isOffline) {
    if (errEl) {
      errEl.textContent = 'Không có kết nối mạng. Vui lòng kiểm tra kết nối Internet và thử lại.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  setCommitPushLoadingState(true);

  const { owner, name, path } = appState.currentFile;
  const targetBranch = (appState.currentRepo && appState.currentRepo.owner === owner && appState.currentRepo.name === name && appState.currentRepo.defaultBranch)
    ? appState.currentRepo.defaultBranch
    : null;

  try {
    // 1. Fetch latest remote file metadata to ensure accurate blob SHA and detect external changes
    let targetSha = appState.currentFileSha || null;
    const branchQuery = targetBranch ? `?ref=${encodeURIComponent(targetBranch)}` : '';
    const metaRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}${branchQuery}`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      cache: 'no-store'
    });

    if (metaRes.status === 200) {
      const metaData = await metaRes.json();
      if (appState.currentFileSha && metaData.sha && metaData.sha !== appState.currentFileSha) {
        const proceedOverwrite = confirm(
          '⚠️ Tệp tin này trên GitHub vừa có commit mới từ một thiết bị/nguồn khác kể từ khi bạn mở trang.\n\n' +
          'Bạn có muốn tiếp tục push và ghi đè nội dung mới của bạn lên phiên bản trên GitHub không?'
        );
        if (!proceedOverwrite) {
          setCommitPushLoadingState(false);
          return;
        }
      }
      targetSha = metaData.sha;
    } else if (metaRes.status === 404) {
      // File does not exist yet on remote branch -> GitHub API creates it when sha is omitted
      targetSha = null;
    } else if (metaRes.status === 401 || metaRes.status === 403) {
      throw new Error('GitHub PAT không hợp lệ hoặc không có quyền truy cập repository này.');
    }

    // 2. Build PUT payload with UTF-8 safe Base64 content
    const payload = {
      message: fullCommitMessage,
      content: utf8ToBase64(newContent)
    };
    if (targetSha) {
      payload.sha = targetSha;
    }
    if (targetBranch) {
      payload.branch = targetBranch;
    }

    const putRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeGitPath(path)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!putRes.ok) {
      let apiMsg = '';
      try {
        const errData = await putRes.json();
        apiMsg = errData.message || '';
      } catch (e) {}

      if (putRes.status === 401) {
        throw new Error('GitHub PAT đã hết hạn hoặc không hợp lệ (HTTP 401).');
      } else if (putRes.status === 403 || putRes.status === 404) {
        throw new Error(
          `Không đủ quyền ghi lên repository (HTTP ${putRes.status}). Hãy đảm bảo PAT của bạn có quyền "repo" (Classic PAT) hoặc "Contents: Read and write" (Fine-grained PAT).${apiMsg ? ` Chi tiết: ${apiMsg}` : ''}`
        );
      } else if (putRes.status === 409) {
        throw new Error('Xung đột phiên bản SHA trên GitHub (HTTP 409). Vui lòng nhấn Commit & Push lại để đồng bộ.');
      } else {
        throw new Error(`Push thất bại (HTTP ${putRes.status})${apiMsg ? `: ${apiMsg}` : '.'}`);
      }
    }

    const putData = await putRes.json();
    const newBlobSha = (putData.content && putData.content.sha) ? putData.content.sha : targetSha;
    const newCommitSha = (putData.commit && putData.commit.sha) ? putData.commit.sha : newBlobSha;
    const newCommitDate = (putData.commit && (putData.commit.committer?.date || putData.commit.author?.date))
      ? (putData.commit.committer?.date || putData.commit.author?.date)
      : new Date().toISOString();

    // 3. Update local appState & IndexedDB offline cache
    appState.currentFileContent = newContent;
    appState.currentFileSha = newBlobSha;
    appState.editorOriginalContent = newContent;

    const fileKey = `${owner}/${name}/${path}`;
    const updatedCache = {
      fileKey,
      owner,
      name,
      path,
      content: newContent,
      sha: newBlobSha,
      lastCommitSha: newCommitSha,
      lastCommitDate: newCommitDate,
      lastSyncedAt: Date.now()
    };
    await getIdb().set(fileKey, updatedCache);

    const favFile = appState.favoriteFiles.find(f => f.owner === owner && f.name === name && f.path === path);
    if (favFile) {
      favFile.lastModified = Date.now();
      localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
    }
    markStateDirty();

    // 4. Close modal, exit Edit mode, re-render Markdown & show confirmation
    setCommitPushLoadingState(false);
    exitEditModeUI();
    renderMarkdown(newContent);
    updateFileSyncBadge('synced', Date.now());
    renderFavoritesList();

    showFlash(`Đã commit & push "${fileName}" lên GitHub thành công!`, 'success', 3500);
  } catch (err) {
    console.error('Commit & Push error:', err);
    setCommitPushLoadingState(false);
    if (errEl) {
      errEl.textContent = err.message || 'Đã xảy ra lỗi khi push lên GitHub.';
      errEl.classList.remove('hidden');
    }
  }
}




