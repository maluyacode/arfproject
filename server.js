// Minimal zero-dependency server for Hello Mewniverse.
// Run:  node server.js [port]   then open http://localhost:3210
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 3006;
const SETTINGS_FILE = path.join(ROOT, 'settings.json');
const LEADERBOARD_FILE = path.join(ROOT, 'leaderboard.json');

const DEFAULT_SETTINGS = {
    primaryColor: '#9ff2c4',
    secondaryColor: '#a98ad6',
    bgColor: '#3b1f5e',
    shipScale: 1.0,
    leaderboardDisplayCount: 5
};
const MAX_STORED_SCORES = 100;

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
        if (req.method === 'GET' && p === '/api/leaderboard') {
            const board = readJson(LEADERBOARD_FILE, { scores: [] });
            if (!Array.isArray(board.scores)) board.scores = [];
            return sendJson(res, 200, { scores: board.scores });
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
            const board = readJson(LEADERBOARD_FILE, { scores: [] });
            if (!Array.isArray(board.scores)) board.scores = [];
            board.scores.push(score);
            board.scores.sort((a, b) => b - a);
            board.scores = board.scores.slice(0, MAX_STORED_SCORES);
            writeJson(LEADERBOARD_FILE, board);
            return sendJson(res, 200, { scores: board.scores, rank: board.scores.indexOf(score) });
        }

        return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
        return sendJson(res, 500, { error: 'server error' });
    }
});

server.listen(PORT, () => {
    console.log(`Hello Mewniverse server running at http://localhost:${PORT}`);
});
