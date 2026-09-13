/* ==========================================================================
   GitHub Markdown Explorer - Core Application Logic
   ========================================================================== */

// --- HELPER: Base64 UTF-8 Decoder (Hỗ trợ Tiếng Việt & Unicode) ---
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
  view: 'repos', // 'repos' | 'favorites'
  isOffline: !navigator.onLine,
  fontScale: parseInt(localStorage.getItem('gh_font_scale') || '100', 10),
  isGuideOpen: false,
  activeGuideTab: 'pat',
  isRawView: false,
  syncStatus: {} // [fileKey]: { status: 'synced'|'syncing'|'cached'|'error', lastSyncedAt: number, sha: string }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Setup Network Listeners
  window.addEventListener('online', handleNetworkChange);
  window.addEventListener('offline', handleNetworkChange);
  handleNetworkChange();

  // Setup Initial Font Zoom Scale
  applyFontScale(appState.fontScale);

  // Initialize Mermaid
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

  // Check existing PAT Token
  if (appState.token) {
    showAppShell();
    loadRepos();
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

// --- NETWORK STATE HANDLING (Logic 14) ---
function handleNetworkChange() {
  appState.isOffline = !navigator.onLine;
  const badge = document.getElementById('networkBadge');
  const btnSyncAll = document.getElementById('btnSyncAll');

  if (appState.isOffline) {
    badge.className = 'gh-badge gh-badge-secondary';
    badge.innerHTML = '<span class="badge-dot"></span> <span class="badge-text">Offline</span>';
    showFlash('Bạn đang ngoại tuyến (Offline Mode). Đang hiển thị bản Cache.', 'info');
    if (btnSyncAll) btnSyncAll.disabled = true;
  } else {
    badge.className = 'gh-badge gh-badge-success';
    badge.innerHTML = '<span class="badge-dot"></span> <span class="badge-text">Online</span>';
    if (btnSyncAll) btnSyncAll.disabled = false;
  }
}

// --- LOGIC 1: PAT Entry & Connect ---
async function connectWithToken() {
  const input = document.getElementById('patInput');
  const errorDiv = document.getElementById('patError');
  const token = input.value.trim();

  if (!token) {
    errorDiv.textContent = 'Bắt buộc nhập Personal Access Token.';
    errorDiv.classList.remove('hidden');
    return;
  }

  errorDiv.classList.add('hidden');
  const btnConnect = document.getElementById('btnConnect');
  btnConnect.disabled = true;
  btnConnect.textContent = 'Đang xác thực...';

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
      
      showFlash(`Chào mừng ${userData.login}! Đã kết nối thành công.`, 'success');
      showAppShell();
      loadRepos();
    } else if (res.status === 401) {
      errorDiv.textContent = 'Token không hợp lệ hoặc đã hết hạn.';
      errorDiv.classList.remove('hidden');
    } else {
      errorDiv.textContent = `Lỗi xác thực (HTTP ${res.status}).`;
      errorDiv.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Connect error:', err);
    errorDiv.textContent = 'Lỗi kết nối mạng, vui lòng kiểm tra lại.';
    errorDiv.classList.remove('hidden');
  } finally {
    btnConnect.disabled = false;
    btnConnect.textContent = 'Kết nối';
  }
}

function showPatCard() {
  document.getElementById('patEntryCard').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('btnSettings').classList.add('hidden');
  
  const connBadge = document.getElementById('connectionBadge');
  connBadge.className = 'gh-badge gh-badge-secondary';
  connBadge.innerHTML = '<span class="badge-text">Chưa kết nối</span>';
}

function showAppShell() {
  document.getElementById('patEntryCard').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('btnSettings').classList.remove('hidden');
  document.getElementById('btnSettings').onclick = disconnectToken;

  const connBadge = document.getElementById('connectionBadge');
  connBadge.className = 'gh-badge gh-badge-success';
  connBadge.innerHTML = '<span class="badge-dot"></span> <span class="badge-text">Đã kết nối</span>';
}

// --- LOGIC 11: Disconnect PAT ---
function disconnectToken() {
  if (confirm('Bạn có chắc chắn muốn ngắt kết nối PAT? Các mục Yêu thích và bản Cache vẫn được giữ lại.')) {
    appState.token = null;
    localStorage.removeItem('gh_pat_token');
    appState.repos = [];
    appState.currentRepo = null;
    appState.currentFile = null;
    appState.currentFileContent = null;
    showPatCard();
    showFlash('Đã ngắt kết nối Token.', 'info');
  }
}

// --- LOGIC 2: Load Repositories ---
async function loadRepos() {
  const container = document.getElementById('repoListContainer');
  container.innerHTML = '<div class="blankslate"><p>Đang tải danh sách kho lưu trữ...</p></div>';

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
      container.innerHTML = `<div class="blankslate"><p class="text-danger">Không thể tải repos (HTTP ${res.status}).</p></div>`;
    }
  } catch (err) {
    console.error('Load repos error:', err);
    container.innerHTML = '<div class="blankslate"><p class="text-danger">Lỗi kết nối khi tải danh sách repo.</p></div>';
  }
}

function renderRepoList(filteredList = null) {
  const container = document.getElementById('repoListContainer');
  const list = filteredList || appState.repos;

  if (list.length === 0) {
    container.innerHTML = '<div class="blankslate"><p>Không tìm thấy kho lưu trữ nào.</p></div>';
    return;
  }

  container.innerHTML = list.map(repo => {
    const isFav = isRepoFavorited(repo.owner, repo.name);
    const activeClass = appState.currentRepo && appState.currentRepo.owner === repo.owner && appState.currentRepo.name === repo.name ? 'active' : '';
    
    return `
      <div class="gh-action-item ${activeClass}" onclick="openRepo('${repo.owner}', '${repo.name}')">
        <div class="repo-item-main">
          <svg class="octicon octicon-repo text-muted" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25Z"></path>
          </svg>
          <div>
            <div class="repo-name">${repo.owner}/${repo.name}</div>
            ${repo.description ? `<div class="repo-desc">${repo.description}</div>` : ''}
          </div>
        </div>
        <button class="btn-star-icon ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation(); toggleFavoriteRepo('${repo.owner}', '${repo.name}')" title="Đánh dấu Yêu thích">
          <svg class="octicon octicon-star" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
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
    showFlash(`Đã xóa ${owner}/${name} khỏi danh sách Yêu thích.`, 'info');
  } else {
    appState.favoriteRepos.push({ owner, name });
    showFlash(`Đã thêm ${owner}/${name} vào Yêu thích!`, 'success');
  }

  localStorage.setItem('gh_favorite_repos', JSON.stringify(appState.favoriteRepos));
  renderRepoList();
  renderFavoritesList();
}

// --- LOGIC 4: Open Repo & Fetch Tree ---
async function openRepo(owner, name) {
  appState.currentRepo = { owner, name };
  appState.currentPath = [];
  renderRepoList(); // Update active highlights

  const treeContainer = document.getElementById('fileTreeContainer');
  treeContainer.innerHTML = '<div class="blankslate"><p>Đang tải cây thư mục repository...</p></div>';
  updateBreadcrumb();

  try {
    // Step 1: Get Repo default branch
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

    // Step 2: Fetch recursive git tree
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/${defaultBranch}?recursive=1`, {
      headers: {
        'Authorization': `Bearer ${appState.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!treeRes.ok) throw new Error(`Tree HTTP ${treeRes.status}`);
    const treeData = await treeRes.json();

    if (treeData.truncated) {
      showFlash('Cảnh báo: Repo quá lớn, chỉ hiển thị cây thư mục một phần.', 'attention');
    }

    appState.currentTreeEntries = treeData.tree || [];
    renderFileTree();
  } catch (err) {
    console.error('Open repo error:', err);
    treeContainer.innerHTML = '<div class="blankslate"><p class="text-danger">Không thể tải cây thư mục file.</p></div>';
  }
}

// --- LOGIC 5: Navigate Folders & Render File Tree ---
function renderFileTree() {
  const container = document.getElementById('fileTreeContainer');
  const currentPathStr = appState.currentPath.join('/');
  
  // Filter entries in currentPath level
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
    container.innerHTML = '<div class="blankslate"><p>Thư mục này rỗng hoặc không chứa file.</p></div>';
    return;
  }

  // Sort folders first, then files
  entries.sort((a, b) => {
    if (a.type === b.type) return a.path.localeCompare(b.path);
    return a.type === 'tree' ? -1 : 1;
  });

  container.innerHTML = entries.map(entry => {
    const isFolder = entry.type === 'tree';
    const isMd = entry.path.endsWith('.md');
    const name = entry.path.split('/').pop();

    if (isFolder) {
      return `
        <div class="tree-row" onclick="navigateFolder('${name}')">
          <svg class="octicon octicon-file-directory" viewBox="0 0 16 16" width="16" height="16" fill="#54a3ff">
            <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
          </svg>
          <span class="tree-name">${name}</span>
        </div>
      `;
    } else {
      return `
        <div class="tree-row ${isMd ? 'is-md' : ''}" onclick="${isMd ? `openMarkdownFile('${appState.currentRepo.owner}', '${appState.currentRepo.name}', '${entry.path}')` : ''}">
          <svg class="octicon ${isMd ? 'octicon-file-code' : 'octicon-file'}" viewBox="0 0 16 16" width="16" height="16" fill="${isMd ? '#0969da' : '#656d76'}">
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
          </svg>
          <span class="tree-name">${name}</span>
        </div>
      `;
    }
  }).join('');
}

function navigateFolder(folderName) {
  if (folderName === '..') {
    appState.currentPath.pop();
  } else {
    appState.currentPath.push(folderName);
  }
  updateBreadcrumb();
  renderFileTree();
}

function updateBreadcrumb() {
  const container = document.getElementById('breadcrumb');
  if (!appState.currentRepo) {
    container.innerHTML = '<span class="text-muted">Chọn một kho lưu trữ để duyệt cây thư mục</span>';
    return;
  }

  let html = `<span class="crumb-link" onclick="appState.currentPath=[]; updateBreadcrumb(); renderFileTree();">${appState.currentRepo.name}</span>`;
  
  let accumulatedPath = [];
  appState.currentPath.forEach((segment, idx) => {
    accumulatedPath.push(segment);
    const pathSnap = [...accumulatedPath];
    html += ` / <span class="crumb-link" onclick="appState.currentPath=${JSON.stringify(pathSnap)}; updateBreadcrumb(); renderFileTree();">${segment}</span>`;
  });

  container.innerHTML = html;
}

// --- LOGIC 6: Open Markdown File (Stale-While-Revalidate & Offline Cache) ---
async function openMarkdownFile(owner, name, path) {
  appState.currentFile = { owner, name, path };
  const fileKey = `${owner}/${name}/${path}`;

  // Show viewer Box
  document.getElementById('markdownViewerBox').classList.remove('hidden');
  document.getElementById('viewerFileName').textContent = path.split('/').pop();
  document.getElementById('linkOpenGithub').href = `https://github.com/${owner}/${name}/blob/${appState.currentRepo ? appState.currentRepo.defaultBranch || 'main' : 'main'}/${path}`;

  updateViewerFavoriteStar();
  const viewerPanel = document.getElementById('markdownViewerPanel');
  viewerPanel.innerHTML = '<p class="text-muted">Đang nạp tài liệu...</p>';

  // Step 1: Check IndexedDB Cache
  let cached = null;
  try {
    cached = await getIdb().get(fileKey);
  } catch (err) {
    console.warn('IndexedDB read error:', err);
  }

  if (cached && cached.content) {
    renderMarkdown(cached.content);
    updateFileSyncBadge('cached', cached.lastSyncedAt);
  }

  // Step 2: If Offline
  if (appState.isOffline) {
    if (!cached) {
      viewerPanel.innerHTML = '<div class="blankslate"><p class="text-danger">Không có kết nối mạng và chưa lưu bản cache cho file này.</p></div>';
    } else {
      showFlash('Đang xem bản cache lưu ngoại tuyến.', 'info');
    }
    return;
  }

  // Step 3: Online Revalidate with GitHub API
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
      
      // Fallback: If content is missing (e.g. file >1MB) or decoding produced empty text
      if (!rawContent && (data.download_url || data.sha)) {
        try {
          const rawRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${path}`, {
            headers: {
              'Authorization': `Bearer ${appState.token}`,
              'Accept': 'application/vnd.github.v3.raw'
            }
          });
          if (rawRes.ok) {
            rawContent = await rawRes.text();
          }
        } catch (rawErr) {
          console.warn('Raw fetch fallback error:', rawErr);
        }
      }

      appState.currentFileContent = rawContent;

      // Check SHA update
      if (!cached || cached.sha !== data.sha) {
        renderMarkdown(rawContent);
        
        // Auto-update cache if favorited
        if (isFileFavorited(owner, name, path)) {
          cacheFavoriteFile(owner, name, path, rawContent, data.sha);
        }
      }

      updateFileSyncBadge('synced', Date.now());
    } else {
      if (!cached) {
        const errorText = await res.text().catch(() => '');
        viewerPanel.innerHTML = `<div class="blankslate"><p class="text-danger">Không thể nạp file từ GitHub (HTTP ${res.status}: ${res.statusText}). ${errorText ? `<br><small>${errorText}</small>` : ''}</p></div>`;
      }
    }
  } catch (err) {
    console.error('Fetch markdown error:', err);
    if (!cached) {
      viewerPanel.innerHTML = `<div class="blankslate"><p class="text-danger">Lỗi kết nối khi tải file Markdown: ${err.message || err}</p></div>`;
    }
  }
}

function updateFileSyncBadge(status, timestamp = Date.now()) {
  const badge = document.getElementById('fileSyncBadge');
  if (status === 'synced') {
    badge.className = 'gh-badge gh-badge-success';
    badge.innerHTML = '🟢 Synced';
  } else if (status === 'syncing') {
    badge.className = 'gh-badge gh-badge-attention';
    badge.innerHTML = '🟡 Syncing...';
  } else if (status === 'cached') {
    badge.className = 'gh-badge gh-badge-secondary';
    badge.innerHTML = '⚪ Offline Cache';
  }
}

// --- LOGIC 7 & 8: Render Markdown, PlantUML & Mermaid ---
function renderMarkdown(rawContent) {
  appState.currentFileContent = rawContent;

  // Custom Marked Code Renderer for Mermaid & PlantUML
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
          <img src="${url}" alt="PlantUML Diagram" onerror="this.onerror=null; this.replaceWith('Sơ đồ PlantUML hiển thị thất bại.');">
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

  // Render Mermaid diagrams asynchronously
  if (window.mermaid) {
    try {
      const mNodes = viewerPanel.querySelectorAll('.mermaid');
      if (mNodes.length > 0) {
        mermaid.run({
          nodes: Array.from(mNodes)
        }).catch(mErr => {
          console.warn('Mermaid async run error:', mErr);
        });
      }
    } catch (mErr) {
      console.warn('Mermaid render warning:', mErr);
    }
  }

  // Syntax Highlighting
  viewerPanel.querySelectorAll('pre code').forEach((block) => {
    if (window.hljs && typeof window.hljs.highlightElement === 'function') {
      try {
        window.hljs.highlightElement(block);
      } catch (hErr) {
        console.warn('Highlight element warning:', hErr);
      }
    }
  });

  // Re-apply Font Zoom Scale
  applyFontScale(appState.fontScale);
}

// PlantUML Custom Base64 Encoding with Pako Raw Deflate
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

// Custom 64-bit PlantUML Encoding Helper
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
  return encode6bit(c1 & 0x3F) +
         encode6bit(c2 & 0x3F) +
         encode6bit(c3 & 0x3F) +
         encode6bit(c4 & 0x3F);
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
    try {
      await getIdb().del(fileKey);
    } catch (err) { console.warn('Cache delete err:', err); }
    showFlash('Đã xóa file khỏi Yêu thích.', 'info');
  } else {
    appState.favoriteFiles.push({ owner, name, path });
    showFlash('Đã thêm file vào Yêu thích & lưu Cache offline!', 'success');
    
    // Auto-cache to IndexedDB
    if (appState.currentFileContent && appState.currentFile && appState.currentFile.path === path) {
      cacheFavoriteFile(owner, name, path, appState.currentFileContent);
    } else {
      cacheFavoriteFile(owner, name, path);
    }
  }

  localStorage.setItem('gh_favorite_files', JSON.stringify(appState.favoriteFiles));
  updateViewerFavoriteStar();
  renderFavoritesList();
}

async function cacheFavoriteFile(owner, name, path, content = null, sha = '') {
  const fileKey = `${owner}/${name}/${path}`;
  
  if (content) {
    const data = { fileKey, owner, name, path, content, sha, lastSyncedAt: Date.now() };
    await getIdb().set(fileKey, data);
    return;
  }

  // If content not provided, fetch from GitHub
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
  } catch (err) {
    console.error('Cache favorite file fetch error:', err);
  }
}

function updateViewerFavoriteStar() {
  if (!appState.currentFile) return;
  const { owner, name, path } = appState.currentFile;
  const isFav = isFileFavorited(owner, name, path);
  const btn = document.getElementById('btnFavCurrentFile');
  
  if (isFav) {
    btn.classList.add('favorited');
  } else {
    btn.classList.remove('favorited');
  }
}

function renderFavoritesList() {
  const favFilesContainer = document.getElementById('favFilesContainer');
  const favReposContainer = document.getElementById('favReposContainer');

  // Fav Files
  if (appState.favoriteFiles.length === 0) {
    favFilesContainer.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>Chưa có file yêu thích nào.</p></div>';
  } else {
    favFilesContainer.innerHTML = appState.favoriteFiles.map(file => `
      <div class="gh-action-item" onclick="openMarkdownFile('${file.owner}', '${file.name}', '${file.path}')">
        <div class="repo-item-main">
          <svg class="octicon octicon-file-code text-muted" viewBox="0 0 16 16" width="16" height="16" fill="#0969da">
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v9.086A1.75 1.75 0 0 1 12.75 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.5 4.25V1.5Zm6.75.5v2.25c0 .138.112.25.25.25h2.25L10.5 2Z"></path>
          </svg>
          <div>
            <div class="repo-name">${file.path.split('/').pop()}</div>
            <div class="repo-desc">${file.owner}/${file.name}</div>
          </div>
        </div>
        <button class="btn-star-icon favorited" onclick="event.stopPropagation(); toggleFavoriteFile('${file.owner}', '${file.name}', '${file.path}')">
          <svg class="octicon octicon-star" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
          </svg>
        </button>
      </div>
    `).join('');
  }

  // Fav Repos
  if (appState.favoriteRepos.length === 0) {
    favReposContainer.innerHTML = '<div class="blankslate" style="padding: 16px;"><p>Chưa có repo yêu thích nào.</p></div>';
  } else {
    favReposContainer.innerHTML = appState.favoriteRepos.map(repo => `
      <div class="gh-action-item" onclick="openRepo('${repo.owner}', '${repo.name}')">
        <div class="repo-item-main">
          <svg class="octicon octicon-repo text-muted" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25Z"></path>
          </svg>
          <div class="repo-name">${repo.owner}/${repo.name}</div>
        </div>
        <button class="btn-star-icon favorited" onclick="event.stopPropagation(); toggleFavoriteRepo('${repo.owner}', '${repo.name}')">
          <svg class="octicon octicon-star" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
          </svg>
        </button>
      </div>
    `).join('');
  }
}

// --- LOGIC 13: Sync Favorites ---
async function syncCurrentFile() {
  if (!appState.currentFile) return;
  const { owner, name, path } = appState.currentFile;
  await syncFavoriteFile(owner, name, path);
}

async function syncFavoriteFile(owner, name, path) {
  if (appState.isOffline) {
    showFlash('Không thể đồng bộ khi đang ngoại tuyến.', 'info');
    return;
  }

  showFlash(`Đang đồng bộ file ${path.split('/').pop()}...`, 'info');
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
      showFlash(`Đã đồng bộ xong ${path.split('/').pop()}!`, 'success');
    }
  } catch (err) {
    console.error('Sync file error:', err);
    showFlash('Đồng bộ thất bại, vui lòng thử lại.', 'error');
  }
}

async function syncAllFavorites() {
  if (appState.isOffline) {
    showFlash('Không thể đồng bộ khi đang ngoại tuyến.', 'info');
    return;
  }

  if (appState.favoriteFiles.length === 0) {
    showFlash('Chưa có file yêu thích nào để đồng bộ.', 'info');
    return;
  }

  showFlash(`Đang đồng bộ ${appState.favoriteFiles.length} file yêu thích...`, 'info');

  const promises = appState.favoriteFiles.map(f => syncFavoriteFile(f.owner, f.name, f.path));
  await Promise.allSettled(promises);

  showFlash('Hoàn tất đồng bộ tất cả các file yêu thích!', 'success');
}

// --- LOGIC 10: Sidebar Tab Switching & Filtering ---
function switchView(targetView) {
  appState.view = targetView;

  const tabRepos = document.getElementById('tabRepos');
  const tabFavorites = document.getElementById('tabFavorites');
  const repoSection = document.getElementById('repoListSection');
  const favSection = document.getElementById('favoritesSection');

  if (targetView === 'repos') {
    tabRepos.classList.add('active');
    tabFavorites.classList.remove('active');
    repoSection.classList.remove('hidden');
    favSection.classList.add('hidden');
  } else {
    tabFavorites.classList.add('active');
    tabRepos.classList.remove('active');
    favSection.classList.remove('hidden');
    repoSection.classList.add('hidden');
    renderFavoritesList();
  }
}

function filterList(query) {
  const q = query.toLowerCase().trim();

  if (appState.view === 'repos') {
    const filtered = appState.repos.filter(r => 
      r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
    renderRepoList(filtered);
  } else {
    // Filter favorites
    const container = document.getElementById('favFilesContainer');
    const items = container.querySelectorAll('.gh-action-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      if (text.includes(q)) {
        item.classList.remove('hidden');
      } else {
        item.classList.add('hidden');
      }
    });
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
  const contentPat = document.getElementById('guidePatContent');
  const contentFeatures = document.getElementById('guideFeaturesContent');

  if (tabName === 'pat') {
    tabPat.classList.add('active');
    tabFeatures.classList.remove('active');
    contentPat.classList.remove('hidden');
    contentFeatures.classList.add('hidden');
  } else {
    tabFeatures.classList.add('active');
    tabPat.classList.remove('active');
    contentFeatures.classList.remove('hidden');
    contentPat.classList.add('hidden');
  }
}

// Event listener to open modal from header icon
document.getElementById('btnOpenHelp').onclick = () => toggleGuideModal(true, 'pat');
