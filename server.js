const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const INITIAL_STATE_PATH = path.join(ROOT, 'data', 'initial-state.json');
const STATE_PATH = path.resolve(process.env.T10_STATE_FILE || path.join(ROOT, 'data', 'state.json'));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_REQUEST_BYTES = 16 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin/', ['admin.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/admin.html', ['admin.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/logo.png', ['logo.png', 'image/png']],
  ['/logo-transparent.png', ['logo-transparent.png', 'image/png']],
  ['/suman1.png', ['suman1.png', 'image/png']],
  ['/sonu.jpg', ['sonu.jpg', 'image/jpeg']],
  ['/suman.jpeg', ['suman.jpeg', 'image/jpeg']],
  ['/sonu.jpeg', ['sonu.jpeg', 'image/jpeg']],
  ['/1st.jpeg', ['1st.jpeg', 'image/jpeg']],
  ['/banner.png', ['banner.png', 'image/png']],
  ['/finale.png', ['finale.png', 'image/png']]
]);

const developmentPassword = process.env.NODE_ENV === 'production' ? undefined : 'T10ADMIN';
const configuredPassword = process.env.T10_ADMIN_PASSWORD || developmentPassword;
if (!configuredPassword || configuredPassword.length < 8) {
  console.error('Set T10_ADMIN_PASSWORD to a password of at least 8 characters before starting the production server.');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const passwordDigest = crypto.createHash('sha256').update(configuredPassword).digest();
const sessions = new Map();
const loginAttempts = new Map();
let tournamentState;
let writeQueue = Promise.resolve();

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(value));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function getCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

function getSession(request) {
  const sessionId = getCookies(request).t10_admin;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return sessionId;
}

function hasExpectedOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || typeof request.headers.host !== 'string') return false;
  try {
    const parsedOrigin = new URL(origin);
    return ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.host === request.headers.host;
  } catch {
    return false;
  }
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function isValidPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 256) return false;
  const candidateDigest = crypto.createHash('sha256').update(candidate).digest();
  return crypto.timingSafeEqual(passwordDigest, candidateDigest);
}

function clientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function checkLoginLimit(request) {
  const key = clientAddress(request);
  const attempt = loginAttempts.get(key);
  if (!attempt) return { key, blocked: false };
  if (attempt.lockedUntil > Date.now()) return { key, blocked: true };
  if (attempt.lockedUntil) loginAttempts.delete(key);
  return { key, blocked: false };
}

function recordFailedLogin(key) {
  const attempt = loginAttempts.get(key) || { failures: 0, lockedUntil: 0 };
  attempt.failures += 1;
  if (attempt.failures >= MAX_LOGIN_ATTEMPTS) {
    attempt.lockedUntil = Date.now() + LOGIN_WINDOW_MS;
    attempt.failures = 0;
  }
  loginAttempts.set(key, attempt);
}

function setSessionCookie(request, response, sessionId) {
  const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
  response.setHeader('Set-Cookie', [
    `t10_admin=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ...(secure ? ['Secure'] : [])
  ].join('; '));
}

function clearSessionCookie(request, response) {
  const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
  response.setHeader('Set-Cookie', [
    't10_admin=',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    ...(secure ? ['Secure'] : [])
  ].join('; '));
}

function validateMatchUpdates(body) {
  if (!body || !Array.isArray(body.matches) || body.matches.length !== tournamentState.matches.length) {
    return null;
  }
  const updatedMatches = [];
  for (let index = 0; index < tournamentState.matches.length; index += 1) {
    const current = tournamentState.matches[index];
    const update = body.matches[index];
    if (!update || update.id !== current.id || !['PENDING', 'COMPLETED'].includes(update.status)) {
      return null;
    }
    if (update.winner !== null && update.winner !== current.player1 && update.winner !== current.player2) {
      return null;
    }
    if (update.status === 'COMPLETED' && !update.winner) return null;
    if (update.status === 'PENDING' && update.winner !== null) return null;
    updatedMatches.push({
      ...current,
      winner: update.winner,
      status: update.status,
      completed: update.status === 'COMPLETED',
      resultText: update.winner ? `${update.winner} wins` : 'Result Pending'
    });
  }

  const matchesById = new Map(updatedMatches.map((match) => [match.id, match]));
  for (const source of updatedMatches) {
    const winnerTarget = source.target || source.nextMatchId;
    const loserTarget = source.loserTarget;
    const routes = [
      { targetId: winnerTarget, slot: source.slot, player: source.winner },
      {
        targetId: loserTarget,
        slot: source.loserSlot,
        player: source.status === 'COMPLETED' && source.winner
          ? (source.winner === source.player1 ? source.player2 : source.player1)
          : null
      }
    ];

    for (const route of routes) {
      if (!route.targetId || !route.slot) continue;
      const target = matchesById.get(route.targetId);
      if (!target || !['slot1', 'slot2'].includes(route.slot)) continue;
      const field = route.slot === 'slot1' ? 'player1' : 'player2';
      if (target[field] !== route.player) {
        target[field] = route.player;
        target.winner = null;
        target.status = 'PENDING';
        target.completed = false;
        target.resultText = 'Result Pending';
      }
    }
  }
  return updatedMatches;
}

async function persistTournamentState(nextState) {
  const operation = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    const temporaryPath = `${STATE_PATH}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryPath, STATE_PATH);
      tournamentState = nextState;
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  });
  writeQueue = operation.catch(() => {});
  await operation;
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/state' && request.method === 'GET') {
    sendJson(response, 200, tournamentState);
    return;
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    sendJson(response, 200, { authenticated: Boolean(getSession(request)) });
    return;
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    if (!hasExpectedOrigin(request)) {
      sendError(response, 403, 'Sign-in request origin was rejected.');
      return;
    }
    const limit = checkLoginLimit(request);
    if (limit.blocked) {
      sendError(response, 429, 'Too many sign-in attempts. Try again in 15 minutes.');
      return;
    }
    const body = await readJson(request);
    if (!isValidPassword(body && body.password)) {
      recordFailedLogin(limit.key);
      sendError(response, 401, 'Incorrect admin password.');
      return;
    }
    loginAttempts.delete(limit.key);
    const sessionId = crypto.randomBytes(32).toString('base64url');
    sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(request, response, sessionId);
    sendJson(response, 200, { authenticated: true });
    return;
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    if (!hasExpectedOrigin(request)) {
      sendError(response, 403, 'Sign-out request origin was rejected.');
      return;
    }
    const sessionId = getCookies(request).t10_admin;
    if (sessionId) sessions.delete(sessionId);
    clearSessionCookie(request, response);
    sendJson(response, 200, { authenticated: false });
    return;
  }

  if (url.pathname === '/api/state' && request.method === 'PUT') {
    const sessionId = getSession(request);
    if (!sessionId) {
      sendError(response, 401, 'Sign in to save tournament results.');
      return;
    }
    if (!hasExpectedOrigin(request)) {
      sendError(response, 403, 'Result update origin was rejected.');
      return;
    }
    const body = await readJson(request);
    const matches = validateMatchUpdates(body);
    if (!matches) {
      sendError(response, 400, 'Tournament result data is invalid.');
      return;
    }
    const nextState = structuredClone(tournamentState);
    nextState.matches = matches;
    const finalMatch = matches.find((match) => match.id === 'm7');
    const thirdPlaceMatch = matches.find((match) => match.id === 'm8');
    nextState.champion = {
      winner: finalMatch.winner,
      runnerUp: finalMatch.winner
        ? (finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1)
        : null,
      finalConfirmed: Boolean(finalMatch.winner && finalMatch.status === 'COMPLETED')
    };
    if (thirdPlaceMatch) {
      const thirdPlaceConfirmed = Boolean(thirdPlaceMatch.winner && thirdPlaceMatch.status === 'COMPLETED');
      nextState.thirdPlace = {
        winner: thirdPlaceConfirmed ? thirdPlaceMatch.winner : null,
        runnerUp: thirdPlaceConfirmed
          ? (thirdPlaceMatch.player1 === thirdPlaceMatch.winner ? thirdPlaceMatch.player2 : thirdPlaceMatch.player1)
          : null,
        label: 'Official third-place result'
      };
    }
    await persistTournamentState(nextState);
    sendJson(response, 200, { saved: true });
    return;
  }

  sendError(response, 404, 'API endpoint not found.');
}

async function handleRequest(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendError(response, 400, 'Request URL is invalid.');
    return;
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendError(response, 405, 'Method not allowed.');
      return;
    }
    const asset = STATIC_FILES.get(url.pathname);
    if (!asset) {
      sendError(response, 404, 'Page not found.');
      return;
    }
    const [fileName, contentType] = asset;
    const body = await fs.readFile(path.join(ROOT, fileName));
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': contentType.startsWith('text/html') ? 'no-store' : 'public, max-age=300'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.status) {
      sendError(response, error.status, error.message);
      return;
    }
    console.error('Request failed:', error);
    if (!response.headersSent) sendError(response, 500, 'The server could not complete the request.');
    else response.destroy();
  }
}

async function start() {
  const seed = JSON.parse(await fs.readFile(INITIAL_STATE_PATH, 'utf8'));
  tournamentState = seed;
  try {
    const savedState = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
    if (!Array.isArray(savedState.matches) || savedState.matches.length !== seed.matches.length) {
      throw new Error('Saved tournament state has an invalid match list.');
    }
    tournamentState = {
      ...seed,
      ...savedState,
      matches: seed.matches.map((seedMatch, index) => {
        const savedMatch = savedState.matches[index];
        if (!savedMatch || savedMatch.id !== seedMatch.id) {
          throw new Error('Saved tournament state has an invalid match list.');
        }
        return { ...seedMatch, ...savedMatch };
      })
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });
  server.listen(PORT, HOST, () => {
    console.log(`T10 Showdown is running at http://localhost:${PORT}`);
    console.log(`Admin sign-in: http://localhost:${PORT}/admin`);
    if (!process.env.T10_ADMIN_PASSWORD) {
      console.warn('Using the local-development admin password. Set T10_ADMIN_PASSWORD before production use.');
    }
  });
}

start().catch((error) => {
  console.error('Could not start the T10 Showdown server:', error);
  process.exitCode = 1;
});
