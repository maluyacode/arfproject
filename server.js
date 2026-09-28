// Minimal zero-dependency server for Hello Mewniverse.
// Run:  node server.js [port]   then open http://localhost:3210
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 3006;
const SETTINGS_FILE = path.join(ROOT, 'settings.json');
const LEADERBOARD_FILE = path.join(ROOT, 'leaderboard.json');
const ARCHIVE_FILE = path.join(ROOT, 'leaderboard_archive.json');

const DEFAULT_SETTINGS = {
    primaryColor: '#9ff2c4',
    secondaryColor: '#a98ad6',
    bgColor: '#3b1f5e',
    shipScale: 1.0,
    leaderboardDisplayCount: 5
};
const MAX_STORED_SCORES = 100;
const MAX_NAME_LENGTH = 12;
const DEFAULT_NAME = 'Anonymous';
const MAX_ARCHIVE_NAME_LENGTH = 60;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.css': 'text/css'
};

function readJson(file, defaults) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        // Missing or corrupt file: serve defaults; the file heals on next write.
        return defaults;
    }
}

// Synchronous whole-file write, last-write-wins. Fine for a local
// single-user game; no locking needed.
function writeJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 10 * 1024) {
                req.destroy();
                reject(new Error('body too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(data));
            } catch {
                reject(new Error('invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function sanitizeSettings(body, previous) {
    const s = { ...previous };
    if (isHexColor(body.primaryColor)) s.primaryColor = body.primaryColor;
    if (isHexColor(body.secondaryColor)) s.secondaryColor = body.secondaryColor;
    if (isHexColor(body.bgColor)) s.bgColor = body.bgColor;
    if (typeof body.shipScale === 'number' && isFinite(body.shipScale)) {
        s.shipScale = Math.min(3, Math.max(0.5, body.shipScale));
    }
    if (Number.isInteger(body.leaderboardDisplayCount)) {
        s.leaderboardDisplayCount = Math.min(20, Math.max(1, body.leaderboardDisplayCount));
    }
    return s;
}

function cleanText(v, maxLength) {
    return typeof v === 'string'
        ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
        : '';
}

function sanitizeName(v) {
    return cleanText(v, MAX_NAME_LENGTH) || DEFAULT_NAME;
}

function readArchives() {
    const file = readJson(ARCHIVE_FILE, { archives: [] });
    return Array.isArray(file.archives) ? file.archives : [];
}

// Leaderboard entries are { name, score }. Older files stored bare numbers;
// upgrade those on read so they still show up (and get rewritten on next save).
function readScores() {
    const board = readJson(LEADERBOARD_FILE, { scores: [] });
    if (!Array.isArray(board.scores)) return [];
    return board.scores
        .map(e => (typeof e === 'number' ? { name: DEFAULT_NAME, score: e } : e))
        .filter(e => e && Number.isInteger(e.score))
        .map(e => ({ name: sanitizeName(e.name), score: e.score }));
}

function serveStatic(res, urlPath) {
    const filePath = path.normalize(path.join(ROOT, decodeURIComponent(urlPath)));
    if (!filePath.startsWith(ROOT)) {
        return sendJson(res, 403, { error: 'forbidden' });
    }
    fs.readFile(filePath, (err, data) => {
        if (err) return sendJson(res, 404, { error: 'not found' });
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
    });
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const p = url.pathname;

        if (req.method === 'GET' && (p === '/' || p === '/space_defender.html')) {
            return serveStatic(res, '/space_defender.html');
        }
        if (req.method === 'GET' && p.startsWith('/Assets/')) {
            return serveStatic(res, p);
        }
        if (req.method === 'GET' && p === '/api/settings') {
            const stored = readJson(SETTINGS_FILE, {});
            return sendJson(res, 200, { ...DEFAULT_SETTINGS, ...stored });
        }
        if (req.method === 'POST' && p === '/api/settings') {
            let body;
            try {
                body = await readBody(req);
            } catch (e) {
                return sendJson(res, 400, { error: e.message });
            }
            const previous = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
            const saved = sanitizeSettings(body, previous);
            writeJson(SETTINGS_FILE, saved);
            return sendJson(res, 200, saved);
        }
        if (req.method === 'GET' && p === '/api/leaderboard/archives') {
            return sendJson(res, 200, { archives: readArchives() });
        }
        if (req.method === 'GET' && p === '/api/leaderboard') {
            return sendJson(res, 200, { scores: readScores() });
        }
        if (req.method === 'POST' && p === '/api/score') {
            let body;
            try {
                body = await readBody(req);
            } catch (e) {
                return sendJson(res, 400, { error: e.message });
            }
            const score = body.score;
            if (!Number.isInteger(score) || score <= 0) {
                return sendJson(res, 400, { error: 'score must be a positive integer' });
            }
            const entry = { name: sanitizeName(body.name), score };
            let scores = readScores();
            scores.push(entry);
            scores.sort((a, b) => b.score - a.score);
            scores = scores.slice(0, MAX_STORED_SCORES);
            writeJson(LEADERBOARD_FILE, { scores });
            return sendJson(res, 200, { scores, rank: scores.indexOf(entry) });
        }

        if (req.method === 'POST' && p === '/api/leaderboard/archive') {
            let body;
            try {
                body = await readBody(req);
            } catch (e) {
                return sendJson(res, 400, { error: e.message });
            }
            const name = cleanText(body.name, MAX_ARCHIVE_NAME_LENGTH);
            if (!name) {
                return sendJson(res, 400, { error: 'Archive name is required' });
            }
            const scores = readScores();
            if (scores.length === 0) {
                return sendJson(res, 400, { error: 'The leaderboard is empty, nothing to archive' });
            }
            const archives = readArchives();
            if (archives.some(a => typeof a.name === 'string' && a.name.toLowerCase() === name.toLowerCase())) {
                return sendJson(res, 409, { error: `An archive named "${name}" already exists` });
            }
            const archive = { name, archivedAt: new Date().toISOString(), scores };
            archives.push(archive);
            // Save the archive before clearing, so a failed write never loses scores.
            writeJson(ARCHIVE_FILE, { archives });
            writeJson(LEADERBOARD_FILE, { scores: [] });
            return sendJson(res, 200, { name, archivedAt: archive.archivedAt, count: scores.length, scores: [] });
        }

        return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
        return sendJson(res, 500, { error: 'server error' });
    }
});

server.listen(PORT, () => {
    console.log(`Hello Mewniverse server running at http://localhost:${PORT}`);
});
