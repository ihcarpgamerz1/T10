
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const database = require('./lib/database');
const initialState = require('./data/initial-state.json');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_REQUEST_BYTES = 16 * 1024;
const configuredPassword = process.env.T10_ADMIN_PASSWORD;
const passwordDigest = configuredPassword && configuredPassword.length >= 8
  ? crypto.createHash('sha256').update(configuredPassword).digest()
  : null;
let tournamentState;

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

async function getActiveSession(request) {
  const sessionId = getCookies(request).t10_admin;
  if (!sessionId) return null;
  return await database.refreshAdminSession(sessionStorageKey(sessionId), SESSION_TTL_MS) ? sessionId : null;
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
  if (!passwordDigest || typeof candidate !== 'string' || candidate.length > 256) return false;
  const candidateDigest = crypto.createHash('sha256').update(candidate).digest();
  return crypto.timingSafeEqual(passwordDigest, candidateDigest);
}

function clientAddress(request) {
  const forwardedAddress = process.env.VERCEL && typeof request.headers['x-forwarded-for'] === 'string'
    ? request.headers['x-forwarded-for'].split(',')[0].trim()
    : '';
  const address = forwardedAddress || request.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(address).digest('hex');
}

function sessionStorageKey(sessionId) {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

async function checkLoginLimit(request) {
  const key = clientAddress(request);
  return { key, blocked: await database.isLoginBlocked(key) };
}

async function recordFailedLogin(key) {
  await database.recordFailedLogin(key, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
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

function validateMatchUpdates(body, currentState = tournamentState) {
  if (!body || !Array.isArray(body.matches) || body.matches.length !== currentState.matches.length) {
    return null;
  }
  const updatedMatches = [];
  for (let index = 0; index < currentState.matches.length; index += 1) {
    const current = currentState.matches[index];
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

function validatePlayerUpdates(players, currentState) {
  if (!Array.isArray(players) || players.length !== currentState.players.length) return null;
  const names = new Set();
  const updates = [];
  for (let index = 0; index < currentState.players.length; index += 1) {
    const current = currentState.players[index];
    const update = players[index];
    if (!update || update.id !== current.id || typeof update.name !== 'string') return null;
    const name = update.name.trim();
    const normalizedName = name.toLocaleLowerCase();
    if (!name || name.length > 80 || names.has(normalizedName)) return null;
    names.add(normalizedName);
    updates.push({ id: current.id, oldName: current.name, name });
  }
  return updates;
}

function validateCommitteeUpdates(committee, currentState) {
  if (!Array.isArray(committee) || committee.length !== currentState.committee.length) return null;
  const updates = [];
  for (let index = 0; index < currentState.committee.length; index += 1) {
    const current = currentState.committee[index];
    const update = committee[index];
    if (!update || update.role !== current.role || !Array.isArray(update.names)) return null;
    const names = update.names.map((name) => typeof name === 'string' ? name.trim() : '');
    if (names.some((name) => !name || name.length > 80)) return null;
    if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) return null;
    updates.push({ role: current.role, names });
  }
  const allNames = updates.flatMap(({ names }) => names.map((name) => name.toLocaleLowerCase()));
  if (new Set(allNames).size !== allNames.length) return null;
  return updates;
}

function buildNextState(body, currentState) {
  const matches = validateMatchUpdates(body, currentState);
  if (!matches) {
    const error = new Error('Tournament result data is invalid.');
    error.status = 400;
    throw error;
  }
  const nextState = structuredClone(currentState);
  nextState.matches = matches;
  if (body.players !== undefined || body.committee !== undefined) {
    const players = validatePlayerUpdates(body.players, currentState);
    const committee = validateCommitteeUpdates(body.committee, currentState);
    if (!players || !committee) {
      const error = new Error('Tournament roster data is invalid.');
      error.status = 400;
      throw error;
    }
    const renamedPlayers = new Map(players.map(({ oldName, name }) => [oldName, name]));
    nextState.players = players.map(({ id, name }) => ({ id, name }));
    nextState.committee = committee;
    for (const match of nextState.matches) {
      for (const field of ['player1', 'player2', 'winner']) {
        if (match[field] && renamedPlayers.has(match[field])) {
          match[field] = renamedPlayers.get(match[field]);
        }
      }
      match.resultText = match.winner ? `${match.winner} wins` : 'Result Pending';
    }
  }
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
  return nextState;
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/state' && request.method === 'GET') {
    tournamentState = await database.readTournamentState();
    sendJson(response, 200, tournamentState);
    return;
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    sendJson(response, 200, { authenticated: Boolean(await getActiveSession(request)) });
    return;
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    if (!hasExpectedOrigin(request)) {
      sendError(response, 403, 'Sign-in request origin was rejected.');
      return;
    }
    const limit = await checkLoginLimit(request);
    if (limit.blocked) {
      sendError(response, 429, 'Too many sign-in attempts. Try again in 15 minutes.');
      return;
    }
    const body = await readJson(request);
    if (!isValidPassword(body && body.password)) {
      await recordFailedLogin(limit.key);
      sendError(response, 401, 'Incorrect admin password.');
      return;
    }
    await database.clearLoginAttempt(limit.key);
    const sessionId = crypto.randomBytes(32).toString('base64url');
    await database.createAdminSession(sessionStorageKey(sessionId), SESSION_TTL_MS);
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
    if (sessionId) {
      await database.deleteAdminSession(sessionStorageKey(sessionId));
    }
    clearSessionCookie(request, response);
    sendJson(response, 200, { authenticated: false });
    return;
  }

  if (url.pathname === '/api/state' && request.method === 'PUT') {
    const sessionId = await getActiveSession(request);
    if (!sessionId) {
      sendError(response, 401, 'Sign in to save tournament results.');
      return;
    }
    if (!hasExpectedOrigin(request)) {
      sendError(response, 403, 'Result update origin was rejected.');
      return;
    }
    const body = await readJson(request);
    const nextState = await database.updateTournamentState((currentState) => buildNextState(body, currentState));
    tournamentState = nextState;
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
    await handleApi(request, response, url);
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

async function initializeState() {
  const seed = structuredClone(initialState);
  const storedState = await database.initializeDatabase(seed);
  tournamentState = {
    ...seed,
    ...storedState,
    committee: Array.isArray(storedState.committee) ? storedState.committee : seed.committee
  };
  if (!Array.isArray(storedState.committee)) {
    await database.updateTournamentState(() => tournamentState);
  }
}

let initialization;
async function handleVercelRequest(webRequest) {
  const missingConfiguration = [];
  if (!passwordDigest) missingConfiguration.push('T10_ADMIN_PASSWORD (at least 8 characters)');
  if (!database.isConfigured()) missingConfiguration.push('DATABASE_URL (PostgreSQL connection string)');
  if (missingConfiguration.length) {
    return new Response(JSON.stringify({
      error: `Vercel backend configuration is incomplete. Set ${missingConfiguration.join(' and ')} in the project environment variables.`
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  const requestUrl = new URL(webRequest.url);
  const request = webRequest.body
    ? Readable.fromWeb(webRequest.body)
    : Readable.from([]);
  request.url = `${requestUrl.pathname}${requestUrl.search}`;
  request.method = webRequest.method;
  request.headers = Object.fromEntries(webRequest.headers);
  request.headers.host ||= requestUrl.host;
  request.socket = {
    remoteAddress: request.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown',
    encrypted: requestUrl.protocol === 'https:'
  };

  return new Promise((resolve, reject) => {
    const headers = new Headers();
    let status = 200;
    let headersSent = false;
    const response = {
      get headersSent() {
        return headersSent;
      },
      setHeader(name, value) {
        headers.set(name, value);
      },
      writeHead(statusCode, responseHeaders = {}) {
        status = statusCode;
        for (const [name, value] of Object.entries(responseHeaders)) headers.set(name, value);
        headersSent = true;
      },
      end(body) {
        resolve(new Response(body ?? null, { status, headers }));
      },
      destroy(error) {
        if (error) reject(error);
        else resolve(new Response(null, { status: 500, headers }));
      }
    };

    if (!initialization) {
      initialization = initializeState().catch((error) => {
        initialization = undefined;
        throw error;
      });
    }
    initialization
      .then(() => handleRequest(request, response))
      .catch((error) => {
        console.error('Could not initialize the tournament service:', error);
        if (!response.headersSent) sendError(response, 500, 'The tournament service could not initialize.');
        else response.destroy(error);
      });
  });
}

module.exports = { handleVercelRequest };
