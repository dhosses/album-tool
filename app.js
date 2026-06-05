let authToken = null;

async function initAuth() {
  const status = await fetch('/api/auth-status').then(r => r.json());
  if (!status.required) {
    authToken = 'none';
    return;
  }
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  document.getElementById('loginInput').focus();
}

async function submitLogin() {
  const password = document.getElementById('loginInput').value;
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginErr');
  btn.disabled = true;
  err.style.display = 'none';

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(password)}`
  });
  const data = await res.json();

  if (data.ok) {
    authToken = data.token;
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('searchInput').focus();
  } else {
    err.style.display = 'block';
    document.getElementById('loginInput').value = '';
    document.getElementById('loginInput').focus();
  }
  btn.disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  document.getElementById('loginInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLogin();
  });
});

function apiFetch(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${authToken}` };
  return fetch(url, opts);
}

function apiUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return authToken && authToken !== 'none' ? `${path}${sep}token=${authToken}` : path;
}

let currentTracks = [];
let currentArtworkUrl = '';
let currentMode = 'album';
let artistStack = [];
let carouselIndex = 0;
let carouselTotal = 0;
let copyFormat = 'numbered';
let currentArtistAlbumsData = [];
let currentArtistSortedName = '';
let currentSort = 'newest';
let suggestionItems = [];
let suggestionIndex = -1;
const CAROUSEL_VISIBLE = 3;
const RECENT_KEY = 'albumtool_recent';

// ── Input events ───────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActiveSuggestion(suggestionIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActiveSuggestion(suggestionIndex - 1);
  } else if (e.key === 'Enter') {
    if (suggestionIndex >= 0 && suggestionItems[suggestionIndex]) {
      e.preventDefault();
      selectSuggestion(suggestionItems[suggestionIndex]);
    } else {
      hideSuggestions();
      doSearch();
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});
document.getElementById('searchInput').addEventListener('input', onSearchInput);
document.getElementById('searchInput').addEventListener('focus', () => {
  if (!document.getElementById('searchInput').value.trim()) showRecent();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-input-wrap')) hideSuggestions();
});

// ── Recent searches ────────────────────────────────────────────
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(q) {
  const list = getRecent().filter(r => r !== q);
  list.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
}
function showRecent() {
  if (currentMode !== 'album') return;
  const list = getRecent();
  if (!list.length) return;
  renderSuggestions(list.map(r => ({ type: 'recent', label: r, query: r })));
}

// ── Search suggestions ─────────────────────────────────────────
let suggestTimer = null;
function onSearchInput() {
  const q = document.getElementById('searchInput').value.trim();
  clearTimeout(suggestTimer);
  if (!q) { showRecent(); return; }
  suggestTimer = setTimeout(() => fetchSuggestions(q), 300);
}
async function fetchSuggestions(q) {
  try {
    const url = currentMode === 'artist'
      ? `/api/suggest?q=${encodeURIComponent(q)}&type=artist`
      : `/api/suggest?q=${encodeURIComponent(q)}`;
    const res = await apiFetch(url);
    const data = await res.json();
    if (data.results && data.results.length) {
      const items = currentMode === 'artist'
        ? data.results.map(r => ({
            type: 'artist',
            label: r.genre ? `${r.name} — ${r.genre}` : r.name,
            query: r.name
          }))
        : data.results.map(r => ({
            type: 'album',
            label: `${r.albumName} — ${r.artist}`,
            query: `${r.albumName} ${r.artist}`
          }));
      renderSuggestions(items);
    } else {
      hideSuggestions();
    }
  } catch { hideSuggestions(); }
}
function renderSuggestions(items) {
  suggestionItems = items;
  suggestionIndex = -1;
  const el = document.getElementById('suggestions');
  el.innerHTML = items.map((item, i) =>
    `<div class="suggestion-item" data-idx="${i}">
      <span class="sug-icon">${item.type === 'recent' ? '↺' : item.type === 'artist' ? '◎' : '♪'}</span>
      <span class="sug-label">${item.label}</span>
    </div>`
  ).join('');
  items.forEach((item, i) => {
    el.children[i].addEventListener('mousedown', e => {
      e.preventDefault(); // prevent input blur before click registers
      selectSuggestion(item);
    });
    el.children[i].addEventListener('mouseover', () => {
      setActiveSuggestion(i);
    });
  });
  el.classList.add('active');
}
function setActiveSuggestion(idx) {
  const el = document.getElementById('suggestions');
  const items = el.querySelectorAll('.suggestion-item');
  if (!items.length) return;
  suggestionIndex = Math.max(-1, Math.min(idx, items.length - 1));
  items.forEach((row, i) => row.classList.toggle('active', i === suggestionIndex));
  if (suggestionIndex >= 0) {
    document.getElementById('searchInput').value = suggestionItems[suggestionIndex].query;
  }
}
function selectSuggestion(item) {
  document.getElementById('searchInput').value = item.query;
  hideSuggestions();
  doSearch();
}
function hideSuggestions() {
  document.getElementById('suggestions').classList.remove('active');
  suggestionItems = [];
  suggestionIndex = -1;
}

// ── Mode ───────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  document.getElementById('tabAlbum').classList.toggle('active', mode === 'album');
  document.getElementById('tabArtist').classList.toggle('active', mode === 'artist');
  document.getElementById('searchInput').placeholder = mode === 'album' ? 'Album name + artist' : 'Artist name';
  hideSuggestions();
  resetSearch();
}

// ── Search ─────────────────────────────────────────────────────
async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  hideSuggestions();
  saveRecent(q);

  document.getElementById('results').classList.remove('active');
  document.getElementById('artistResults').classList.remove('active');
  document.getElementById('errorMsg').classList.remove('active');
  document.getElementById('loading').classList.add('active');
  document.getElementById('searchBtn').disabled = true;
  document.getElementById('loadingText').textContent = 'Searching...';

  const endpoint = currentMode === 'artist'
    ? `/api/artist?q=${encodeURIComponent(q)}`
    : `/api/search?q=${encodeURIComponent(q)}`;

  let data;
  try {
    const res = await apiFetch(endpoint);
    try {
      data = await res.json();
    } catch {
      showError(`Server error (status ${res.status}). Check the terminal for details.`);
      return;
    }
    if (!res.ok || data.error) {
      showError(data.error || (currentMode === 'artist' ? 'Artist not found.' : 'Album not found. Try adding the artist name.'));
      return;
    }
  } catch (err) {
    showError(`Connection error: ${err.message}`);
    return;
  } finally {
    document.getElementById('loading').classList.remove('active');
    document.getElementById('searchBtn').disabled = false;
  }

  await new Promise(r => setTimeout(r, 200));
  if (currentMode === 'artist') renderArtistResults(data);
  else renderResults(data);
}

// ── Album results ──────────────────────────────────────────────
function renderResults(data) {
  currentTracks = data.tracks;
  currentArtworkUrl = data.artworkUrl;

  document.getElementById('artworkImg').src = data.artworkUrl;
  document.getElementById('albumName').textContent = data.albumName;
  document.getElementById('artistName').textContent = data.artist;
  document.getElementById('releaseDate').textContent = data.releaseDate;
  document.getElementById('duration').textContent = data.duration;
  document.getElementById('trackCount').textContent = data.tracks.length + ' songs';

  const genrePill = document.getElementById('genrePill');
  if (data.genre) {
    document.getElementById('genreValue').textContent = data.genre;
    genrePill.style.display = '';
  } else {
    genrePill.style.display = 'none';
  }
  document.getElementById('explicitPill').style.display = data.explicit ? '' : 'none';

  const safeName = `${data.artist} - ${data.albumName}`.replace(/[/\\?%*:|"<>]/g, '');

  document.getElementById('artworkDownloadBtn').href =
    apiUrl(`/api/download-artwork?url=${encodeURIComponent(data.artworkUrl)}&filename=${encodeURIComponent(safeName)}`);

  document.getElementById('appleMusicBtn').href = data.appleMusicUrl;
  document.getElementById('appleMusicUrl').textContent = data.appleMusicUrl;

  const spotifyCodeImg = document.getElementById('spotifyCode');
  const spotifyCodeMissing = document.getElementById('spotifyCodeMissing');
  const qrDownloadBtn = document.getElementById('qrDownloadBtn');
  if (data.spotifyCodesUrl) {
    spotifyCodeImg.src = apiUrl(`/api/proxy-image?url=${encodeURIComponent(data.spotifyCodesUrl)}`);
    spotifyCodeImg.style.display = 'block';
    qrDownloadBtn.href = apiUrl(`/api/proxy-image?url=${encodeURIComponent(data.spotifyCodesUrl)}&download=${encodeURIComponent(safeName + ' QR.png')}`);
    qrDownloadBtn.style.display = 'inline-block';
    spotifyCodeMissing.style.display = 'none';
  } else {
    spotifyCodeImg.style.display = 'none';
    qrDownloadBtn.style.display = 'none';
    spotifyCodeMissing.style.display = 'block';
  }

  renderTracklist();

  document.getElementById('moreAlbumsSection').style.display = 'none';
  document.getElementById('results').classList.add('active');
  document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });

  loadMoreAlbums(data.artist, data.albumName);
}

function renderTracklist() {
  document.getElementById('tracklist').innerHTML = currentTracks.map(t =>
    `<div class="track-row">
      <span class="track-num">${t.number}.</span>
      <span class="track-title">${t.title}</span>
    </div>`
  ).join('');
}

// ── Copy tracklist ─────────────────────────────────────────────
function copyTracks() {
  const text = copyFormat === 'numbered'
    ? currentTracks.map(t => `${t.number}. ${t.title}`).join('\n')
    : currentTracks.map(t => t.title).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyTracksBtn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy all tracks'; btn.classList.remove('copied'); }, 2000);
  });
}

function toggleCopyFormat() {
  copyFormat = copyFormat === 'numbered' ? 'plain' : 'numbered';
  document.getElementById('copyFormatBtn').textContent = copyFormat === 'numbered' ? '1. Title' : 'Title';
}

// ── More albums carousel ───────────────────────────────────────
async function loadMoreAlbums(artist, currentAlbum) {
  try {
    const res = await apiFetch(`/api/artist-albums?name=${encodeURIComponent(artist)}`);
    const data = await res.json();
    if (!res.ok || data.error || !data.albums.length) return;
    const others = data.albums.filter(a => a.name.toLowerCase() !== currentAlbum.toLowerCase());
    if (!others.length) return;

    document.getElementById('moreAlbumsTitle').textContent = `More from ${artist}`;
    const grid = document.getElementById('moreAlbumsGrid');
    grid.innerHTML = others.map(a => `
      <div class="album-card" data-album-id="${a.id || ''}" data-album-name="${a.name.replace(/"/g, '&quot;')}" data-artist-name="${artist.replace(/"/g, '&quot;')}">
        <img src="${a.artworkUrl}" alt="${a.name}" loading="lazy">
        <div class="album-card-info">
          <div class="album-card-title">${a.name}</div>
          <div class="album-card-year">${a.year} · ${a.trackCount} tracks</div>
        </div>
      </div>
    `).join('');
    grid.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('click', () => openAlbum(card.dataset.albumName, card.dataset.artistName, card.dataset.albumId));
    });
    carouselIndex = 0;
    carouselTotal = others.length;
    updateCarousel();
    document.getElementById('moreAlbumsSection').style.display = 'block';
  } catch {}
}

function updateCarousel() {
  const cardWidth = 160 + 12;
  document.getElementById('moreAlbumsGrid').style.transform = `translateX(-${carouselIndex * cardWidth}px)`;
  document.getElementById('carouselPrev').disabled = carouselIndex === 0;
  document.getElementById('carouselNext').disabled =
    carouselTotal <= CAROUSEL_VISIBLE || carouselIndex >= carouselTotal - CAROUSEL_VISIBLE;
}

function shiftCarousel(dir) {
  carouselIndex = Math.max(0, Math.min(carouselIndex + dir, carouselTotal - CAROUSEL_VISIBLE));
  updateCarousel();
}

// ── Artist results ─────────────────────────────────────────────
function renderArtistResults(data) {
  document.getElementById('artistList').innerHTML = '';
  document.getElementById('albumsGrid').innerHTML = '';

  if (data.artists) {
    document.getElementById('artistResultName').textContent = 'Artists';
    document.getElementById('artistResultCount').textContent = `${data.artists.length} results`;
    document.getElementById('sortControls').style.display = 'none';

    document.getElementById('artistList').innerHTML = data.artists.map((a, i) => `
      <div class="artist-card" data-artist-name="${a.name.replace(/"/g, '&quot;')}">
        ${a.imageUrl
          ? `<img class="artist-card-img" src="${apiUrl(`/api/proxy-image?url=${encodeURIComponent(a.imageUrl)}`)}" alt="${a.name}" loading="lazy">`
          : `<div class="artist-card-placeholder">${a.name[0]}</div>`}
        <div class="artist-card-info">
          <div class="artist-card-name">${a.name}</div>
          ${a.genre ? `<div class="artist-card-genre">${a.genre}</div>` : ''}
          <div class="artist-card-count" id="acount-${i}">— albums</div>
        </div>
      </div>
    `).join('');

    document.getElementById('artistList').querySelectorAll('.artist-card').forEach(card => {
      card.addEventListener('click', () => openArtist(card.dataset.artistName));
    });

    data.artists.forEach((a, i) => loadAlbumCount(a.name, `acount-${i}`));
  } else {
    currentArtistAlbumsData = data.albums;
    currentArtistSortedName = data.artist;
    currentSort = 'newest';
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'newest'));
    document.getElementById('artistResultName').textContent = data.artist;
    document.getElementById('artistResultCount').textContent = `${data.albums.length} albums`;
    document.getElementById('sortControls').style.display = 'flex';
    renderAlbumsGrid(data.albums, data.artist);
  }

  artistStack.push(data);
  document.getElementById('artistResults').classList.add('active');
  document.getElementById('artistResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadAlbumCount(artistName, countId) {
  try {
    const res = await apiFetch(`/api/artist-albums?name=${encodeURIComponent(artistName)}`);
    const data = await res.json();
    const el = document.getElementById(countId);
    if (el && data.albums) {
      el.textContent = `${data.albums.length} album${data.albums.length !== 1 ? 's' : ''}`;
    }
  } catch {}
}

function renderAlbumsGrid(albums, artist) {
  document.getElementById('albumsGrid').innerHTML = albums.map(a => `
    <div class="album-card" data-album-id="${a.id || ''}" data-album-name="${a.name.replace(/"/g, '&quot;')}" data-artist-name="${artist.replace(/"/g, '&quot;')}">
      <img src="${a.artworkUrl}" alt="${a.name}" loading="lazy">
      <div class="album-card-info">
        <div class="album-card-title">${a.name}</div>
        <div class="album-card-year">${a.year} · ${a.trackCount} tracks</div>
      </div>
    </div>
  `).join('');
  document.getElementById('albumsGrid').querySelectorAll('.album-card').forEach(card => {
    card.addEventListener('click', () => openAlbum(card.dataset.albumName, card.dataset.artistName, card.dataset.albumId));
  });
}

// ── Sort albums ────────────────────────────────────────────────
function setSortAlbums(sort) {
  currentSort = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  const sorted = [...currentArtistAlbumsData];
  if (sort === 'newest') sorted.sort((a, b) => b.year - a.year);
  else if (sort === 'oldest') sorted.sort((a, b) => a.year - b.year);
  else if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name));
  renderAlbumsGrid(sorted, currentArtistSortedName);
}

// ── Navigation ─────────────────────────────────────────────────
async function openArtist(artistName) {
  document.getElementById('errorMsg').classList.remove('active');
  document.getElementById('loading').classList.add('active');
  document.getElementById('loadingText').textContent = `Loading ${artistName}...`;

  let data;
  try {
    const res = await apiFetch(`/api/artist-albums?name=${encodeURIComponent(artistName)}`);
    data = await res.json();
    if (!res.ok || data.error) { showError(data.error || 'Failed to load albums.'); return; }
  } catch (err) {
    showError(`Connection error: ${err.message}`); return;
  } finally {
    document.getElementById('loading').classList.remove('active');
  }

  renderArtistResults(data);
}

async function openAlbum(albumName, artistName, albumId) {
  document.getElementById('errorMsg').classList.remove('active');
  document.getElementById('loading').classList.add('active');
  document.getElementById('loadingText').textContent = 'Loading album...';

  let data;
  try {
    const url = albumId
      ? `/api/album?id=${encodeURIComponent(albumId)}`
      : `/api/search?q=${encodeURIComponent(albumName + ' ' + artistName)}`;
    const res = await apiFetch(url);
    data = await res.json();
    if (!res.ok || data.error) { showError(data.error || 'Failed to load album.'); return; }
  } catch (err) {
    showError(`Connection error: ${err.message}`); return;
  } finally {
    document.getElementById('loading').classList.remove('active');
  }

  document.getElementById('artistResults').classList.remove('active');
  renderResults(data);
}

function goBack() {
  document.getElementById('results').classList.remove('active');
  document.getElementById('spotifyCode').style.display = 'none';
  document.getElementById('moreAlbumsSection').style.display = 'none';

  if (artistStack.length > 0) {
    const prev = artistStack.pop();
    renderArtistResults(prev);
  } else {
    document.getElementById('artistResults').classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('active');
  document.getElementById('loading').classList.remove('active');
}

function copyText(elId, btn) {
  const text = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'copied!';
    setTimeout(() => btn.textContent = 'copy', 2000);
  });
}

function resetSearch() {
  artistStack = [];
  currentSort = 'newest';
  document.getElementById('results').classList.remove('active');
  document.getElementById('artistResults').classList.remove('active');
  document.getElementById('spotifyCode').style.display = 'none';
  document.getElementById('searchInput').value = '';
  document.getElementById('searchInput').focus();
  hideSuggestions();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
