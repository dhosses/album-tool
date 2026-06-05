const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env file if present
const envPath = process.env.ENV_FILE || path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

const PORT = process.env.PORT || 3000;

const APP_PASSWORD = process.env.APP_PASSWORD || null;
const SESSION_TOKEN = APP_PASSWORD ? crypto.randomBytes(32).toString('hex') : null;

function isAuthenticated(req, parsed) {
  if (!APP_PASSWORD) return true;
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${SESSION_TOKEN}`) return true;
  return parsed && parsed.searchParams.get('token') === SESSION_TOKEN;
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*'
      }
    };
    lib.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

const EDITION_RE = /deluxe|extended|special edition|remaster|anniversary|bonus/i;

function stripEdition(name) {
  return name.replace(/\s*[\(\[](deluxe|extended|special edition|remaster|anniversary|bonus)[^\)\]]*[\)\]]/gi, '').trim().toLowerCase();
}

async function searchAppleMusic(query) {
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=album&limit=10`;
  const res = await fetchUrl(searchUrl);
  const data = JSON.parse(res.body);
  if (!data.results || data.results.length === 0) return null;

  // If the query asks for a specific edition, just return the first result
  if (EDITION_RE.test(query)) return data.results[0];

  const queryLower = query.toLowerCase().trim();

  const sorted = [...data.results].sort((a, b) => {
    const aIsEdition = EDITION_RE.test(a.collectionName);
    const bIsEdition = EDITION_RE.test(b.collectionName);
    // Exact name match wins (full name or with edition tag stripped)
    const aExact = a.collectionName.toLowerCase() === queryLower || stripEdition(a.collectionName) === queryLower;
    const bExact = b.collectionName.toLowerCase() === queryLower || stripEdition(b.collectionName) === queryLower;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    // Non-edition before edition
    if (!aIsEdition && bIsEdition) return -1;
    if (aIsEdition && !bIsEdition) return 1;
    // Shorter name preferred (standard is always shorter than deluxe)
    return a.collectionName.length - b.collectionName.length;
  });

  const best = sorted[0];

  // If the best result is still an edition, iTunes text search doesn't have the standard
  // version in its top results — look up the full artist discography by ID instead
  if (EDITION_RE.test(best.collectionName) && best.artistId) {
    const baseName = stripEdition(best.collectionName);
    try {
      const lookupRes = await fetchUrl(`https://itunes.apple.com/lookup?id=${best.artistId}&entity=album&limit=200`);
      const lookupData = JSON.parse(lookupRes.body);
      const standard = (lookupData.results || [])
        .filter(r => r.wrapperType === 'collection' && r.collectionType === 'Album')
        .find(r =>
          !EDITION_RE.test(r.collectionName) &&
          r.artistName.toLowerCase() === best.artistName.toLowerCase() &&
          (r.collectionName.toLowerCase() === baseName || stripEdition(r.collectionName) === baseName)
        );
      if (standard) return standard;
    } catch (_) { /* fall through */ }
  }

  return best;
}

let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        spotifyToken = json.access_token;
        spotifyTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
        resolve(spotifyToken);
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function getSpotifyAlbumUri(query) {
  const token = await getSpotifyToken();
  if (!token) return null;
  const encoded = encodeURIComponent(query);
  const parsed = new URL(`https://api.spotify.com/v1/search?q=${encoded}&type=album&limit=1`);
  return new Promise((resolve) => {
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const album = json.albums && json.albums.items[0];
          resolve(album ? album.uri : null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function getAlbumTracks(collectionId) {
  const lookupUrl = `https://itunes.apple.com/lookup?id=${collectionId}&entity=song`;
  const res = await fetchUrl(lookupUrl);
  const data = JSON.parse(res.body);
  return data.results.filter(r => r.wrapperType === 'track').sort((a, b) => a.trackNumber - b.trackNumber);
}

function stripFeatures(title) {
  return title
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*\[feat\..*?\]/gi, '')
    .replace(/\s*\(ft\..*?\)/gi, '')
    .replace(/\s*\[ft\..*?\]/gi, '')
    .replace(/\s*feat\..+$/gi, '')
    .replace(/\s*ft\..+$/gi, '')
    .trim();
}

async function getArtworkUrl(appleMusicUrl) {
  try {
    const apiUrl = `https://bendodson.com/projects/apple-music-artwork-finder/?url=${encodeURIComponent(appleMusicUrl)}`;
    const res = await fetchUrl(apiUrl);
    const match = res.body.match(/href="(https:\/\/[^"]+mzstatic[^"]+\.(jpg|png)[^"]*)"/i);
    if (match) {
      return match[1].replace(/\d+x\d+bb/, '3000x3000bb');
    }
    const imgMatch = res.body.match(/src="(https:\/\/[^"]+mzstatic[^"]+\.(jpg|png)[^"]*)"/i);
    if (imgMatch) return imgMatch[1].replace(/\d+x\d+bb/, '3000x3000bb');
    return null;
  } catch (e) {
    return null;
  }
}

function formatDuration(ms) {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins} mins ${secs} secs`;
}

function formatReleaseDate(dateStr) {
  const d = new Date(dateStr);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

async function buildAlbumResult(album, query) {
  const searchQuery = query || `${album.collectionName} ${album.artistName}`;
  const [tracks, spotifyUri] = await Promise.all([
    getAlbumTracks(album.collectionId),
    getSpotifyAlbumUri(searchQuery)
  ]);
  const totalMs = tracks.reduce((sum, t) => sum + (t.trackTimeMillis || 0), 0);
  const appleMusicUrl = `https://music.apple.com/us/album/${album.collectionId}`;
  const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(searchQuery)}/albums`;
  const artworkUrl = album.artworkUrl100.replace('100x100bb', '3000x3000bb');
  const artworkFinderUrl = `https://bendodson.com/projects/apple-music-artwork-finder/?url=${encodeURIComponent(appleMusicUrl)}`;
  const spotifyCodesUrl = spotifyUri
    ? `https://scannables.scdn.co/uri/plain/png/000000/white/640/${spotifyUri}`
    : null;
  const explicit = album.collectionExplicitness === 'explicit' || tracks.some(t => t.trackExplicitness === 'explicit');
  const genre = album.primaryGenreName || null;
  return {
    albumName: album.collectionName,
    artist: album.artistName,
    releaseDate: formatReleaseDate(album.releaseDate),
    duration: formatDuration(totalMs),
    explicit,
    genre,
    artworkUrl,
    artworkFinderUrl,
    appleMusicUrl,
    spotifySearchUrl,
    spotifyUri,
    spotifyCodesUrl,
    tracks: tracks.map((t, i) => ({ number: i + 1, title: stripFeatures(t.trackName) }))
  };
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Auth ─────────────────────────────────────────────────────
  if (pathname === '/api/auth-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ required: !!APP_PASSWORD }));
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const password = new URLSearchParams(body).get('password');
    if (password === APP_PASSWORD) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, token: SESSION_TOKEN }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  if (pathname.startsWith('/api/') && !isAuthenticated(req, parsed)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const staticFiles = {
    '/': { file: 'index.html', type: 'text/html' },
    '/index.html': { file: 'index.html', type: 'text/html' },
    '/styles.css': { file: 'styles.css', type: 'text/css' },
    '/app.js': { file: 'app.js', type: 'application/javascript' },
  };

  if (staticFiles[pathname]) {
    const { file, type } = staticFiles[pathname];
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(path.join(__dirname, file)));
    return;
  }

  if (pathname === '/api/search' && req.method === 'GET') {
    const query = parsed.searchParams.get('q');
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No query provided' }));
      return;
    }

    try {
      const album = await searchAppleMusic(query);
      if (!album) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Album not found' }));
        return;
      }
      const result = await buildAlbumResult(album, query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[search error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/album' && req.method === 'GET') {
    const id = parsed.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No id provided' }));
      return;
    }
    try {
      const lookupUrl = `https://itunes.apple.com/lookup?id=${id}`;
      const lookupRes = await fetchUrl(lookupUrl);
      const lookupData = JSON.parse(lookupRes.body);
      const album = lookupData.results && lookupData.results[0];
      if (!album) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Album not found' }));
        return;
      }
      const result = await buildAlbumResult(album, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[album error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/artist' && req.method === 'GET') {
    const query = parsed.searchParams.get('q');
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No query provided' }));
      return;
    }
    try {
      const encoded = encodeURIComponent(query);

      const token = await getSpotifyToken();
      if (!token) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Spotify credentials not configured' }));
        return;
      }

      const spData = await new Promise((resolve, reject) => {
        https.get({
          hostname: 'api.spotify.com',
          path: `/v1/search?q=${encoded}&type=artist`,
          headers: { 'Authorization': `Bearer ${token}` }
        }, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });

if (!spData.artists || spData.artists.items.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No artists found' }));
        return;
      }

      const artists = spData.artists.items.map(a => ({
        spotifyId: a.id,
        name: a.name,
        genre: a.genres && a.genres[0] ? a.genres[0] : null,
        imageUrl: a.images && a.images.length > 0 ? a.images[0].url : null
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artists }));
    } catch (err) {
      console.error('[artist error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/artist-albums' && req.method === 'GET') {
    const artistName = parsed.searchParams.get('name');
    if (!artistName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No name provided' }));
      return;
    }
    try {
      const encoded = encodeURIComponent(artistName);

      // Step 1: find the artist's iTunes ID for an accurate lookup
      const artistSearchRes = await fetchUrl(`https://itunes.apple.com/search?term=${encoded}&media=music&entity=musicArtist&limit=10`);
      const artistSearchData = JSON.parse(artistSearchRes.body);
      const artistMatch = (artistSearchData.results || []).find(r =>
        r.wrapperType === 'artist' &&
        r.artistName.toLowerCase() === artistName.toLowerCase()
      );

      let rawResults = [];
      if (artistMatch) {
        // Step 2a: look up all albums by ID — much more complete than a text search
        const lookupRes = await fetchUrl(`https://itunes.apple.com/lookup?id=${artistMatch.artistId}&entity=album&limit=200`);
        const lookupData = JSON.parse(lookupRes.body);
        rawResults = (lookupData.results || []).filter(r =>
          r.wrapperType === 'collection' && r.collectionType === 'Album'
        );
      } else {
        // Step 2b: fall back to search if no exact artist match found
        const searchRes = await fetchUrl(`https://itunes.apple.com/search?term=${encoded}&media=music&entity=album&attribute=artistTerm&limit=200`);
        const searchData = JSON.parse(searchRes.body);
        rawResults = (searchData.results || []).filter(r =>
          r.wrapperType === 'collection' && r.collectionType === 'Album'
        );
      }

      const seen = new Set();
      const albums = rawResults
        .filter(r => r.trackCount >= 2)
        .filter(r => {
          if (seen.has(r.collectionName)) return false;
          seen.add(r.collectionName);
          return true;
        })
        .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))
        .map(r => ({
          id: r.collectionId,
          name: r.collectionName,
          year: new Date(r.releaseDate).getFullYear(),
          trackCount: r.trackCount,
          artworkUrl: r.artworkUrl100.replace('100x100bb', '600x600bb')
        }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artist: artistName, albums }));
    } catch (err) {
      console.error('[artist-albums error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/proxy-image' && req.method === 'GET') {
    const imageUrl = parsed.searchParams.get('url');
    const downloadName = parsed.searchParams.get('download');
    if (!imageUrl) { res.writeHead(400); res.end('No URL'); return; }
    try {
      const p = new URL(imageUrl);
      const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' };
      https.get({ hostname: p.hostname, path: p.pathname + p.search, headers }, (imgRes) => {
        const contentType = imgRes.headers['content-type'] || 'image/png';
        const respHeaders = { 'Content-Type': contentType, 'Cache-Control': 'no-store' };
        if (downloadName) respHeaders['Content-Disposition'] = `attachment; filename="${downloadName}"`;
        res.writeHead(200, respHeaders);
        imgRes.pipe(res);
      }).on('error', () => { res.writeHead(500); res.end('Error'); });
    } catch { res.writeHead(400); res.end('Invalid URL'); }
    return;
  }

  if (pathname === '/api/download-artwork' && req.method === 'GET') {
    const artworkUrl = parsed.searchParams.get('url');
    const filename = parsed.searchParams.get('filename') || 'artwork';
    if (!artworkUrl) {
      res.writeHead(400);
      res.end('No URL provided');
      return;
    }
    try {
      const parsed2 = new URL(artworkUrl);
       const options = {
        hostname: parsed2.hostname,
        path: parsed2.pathname + parsed2.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'image/*'
        }
      };
      https.get(options, (imgRes) => {
        const contentType = imgRes.headers['content-type'] || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}.${ext}"`,
          'Cache-Control': 'no-store'
        });
        imgRes.pipe(res);
      }).on('error', () => {
        res.writeHead(500);
        res.end('Error fetching artwork');
      });
    } catch (e) {
      res.writeHead(400);
      res.end('Invalid URL');
    }
    return;
  }

  if (pathname === '/api/suggest' && req.method === 'GET') {
    const query = parsed.searchParams.get('q');
    const type = parsed.searchParams.get('type') || 'album';
    if (!query) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [] }));
      return;
    }
    try {
      const encoded = encodeURIComponent(query);
      let results;
      if (type === 'artist') {
        const searchRes = await fetchUrl(`https://itunes.apple.com/search?term=${encoded}&media=music&entity=musicArtist&limit=6`);
        const data = JSON.parse(searchRes.body);
        results = (data.results || [])
          .filter(r => r.wrapperType === 'artist')
          .map(r => ({ name: r.artistName, genre: r.primaryGenreName || null }));
      } else {
        const searchRes = await fetchUrl(`https://itunes.apple.com/search?term=${encoded}&media=music&entity=album&limit=5`);
        const data = JSON.parse(searchRes.body);
        results = (data.results || []).map(r => ({
          albumName: r.collectionName,
          artist: r.artistName,
          artworkUrl: r.artworkUrl100
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [] }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Album Tool running at http://localhost:${PORT}`);
});
