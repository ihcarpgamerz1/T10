const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    })
  : null;

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS t10_tournament_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS t10_admin_sessions (
      id text PRIMARY KEY,
      expires_at timestamptz NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS t10_admin_login_attempts (
      client_key text PRIMARY KEY,
      failures integer NOT NULL DEFAULT 0,
      locked_until timestamptz
    )
  `);
}

async function initializeDatabase(seedState) {
  await ensureSchema();
  await pool.query(
    'INSERT INTO t10_tournament_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(seedState)]
  );
  const result = await pool.query('SELECT state FROM t10_tournament_state WHERE id = 1');
  if (!result.rows[0]) throw new Error('Tournament state is missing from the database.');
  return result.rows[0].state;
}

async function readTournamentState() {
  const result = await pool.query('SELECT state FROM t10_tournament_state WHERE id = 1');
  if (!result.rows[0]) throw new Error('Tournament state is missing from the database.');
  return result.rows[0].state;
}

async function updateTournamentState(update) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT state FROM t10_tournament_state WHERE id = 1 FOR UPDATE');
    if (!result.rows[0]) throw new Error('Tournament state is missing from the database.');
    const state = update(result.rows[0].state);
    await client.query(
      'UPDATE t10_tournament_state SET state = $1::jsonb, updated_at = now() WHERE id = 1',
      [JSON.stringify(state)]
    );
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function refreshAdminSession(sessionId, ttlMs) {
  const result = await pool.query(
    `UPDATE t10_admin_sessions
     SET expires_at = now() + ($2::bigint * interval '1 millisecond')
     WHERE id = $1 AND expires_at > now()
     RETURNING id`,
    [sessionId, ttlMs]
  );
  return result.rowCount === 1;
}

async function createAdminSession(sessionId, ttlMs) {
  await pool.query('DELETE FROM t10_admin_sessions WHERE expires_at <= now()');
  await pool.query(
    `INSERT INTO t10_admin_sessions (id, expires_at)
     VALUES ($1, now() + ($2::bigint * interval '1 millisecond'))`,
    [sessionId, ttlMs]
  );
}

async function deleteAdminSession(sessionId) {
  await pool.query('DELETE FROM t10_admin_sessions WHERE id = $1', [sessionId]);
}

async function isLoginBlocked(clientKey) {
  const result = await pool.query(
    'SELECT locked_until > now() AS blocked FROM t10_admin_login_attempts WHERE client_key = $1',
    [clientKey]
  );
  return Boolean(result.rows[0] && result.rows[0].blocked);
}

async function recordFailedLogin(clientKey, maxAttempts, windowMs) {
  await pool.query(
    `INSERT INTO t10_admin_login_attempts (client_key, failures)
     VALUES ($1, 1)
     ON CONFLICT (client_key) DO UPDATE SET
       failures = CASE
         WHEN t10_admin_login_attempts.locked_until > now() THEN t10_admin_login_attempts.failures
         WHEN t10_admin_login_attempts.locked_until IS NOT NULL THEN 1
         WHEN t10_admin_login_attempts.failures + 1 >= $2 THEN 0
         ELSE t10_admin_login_attempts.failures + 1
       END,
       locked_until = CASE
         WHEN t10_admin_login_attempts.locked_until > now() THEN t10_admin_login_attempts.locked_until
         WHEN t10_admin_login_attempts.locked_until IS NOT NULL THEN NULL
         WHEN t10_admin_login_attempts.failures + 1 >= $2
           THEN now() + ($3::bigint * interval '1 millisecond')
         ELSE NULL
       END`,
    [clientKey, maxAttempts, windowMs]
  );
}

async function clearLoginAttempt(clientKey) {
  await pool.query('DELETE FROM t10_admin_login_attempts WHERE client_key = $1', [clientKey]);
}

async function importExistingState(state, seedState) {
  await ensureSchema();
  const serializedState = JSON.stringify(state);
  const serializedSeed = JSON.stringify(seedState);
  const inserted = await pool.query(
    `INSERT INTO t10_tournament_state (id, state)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [serializedState]
  );
  if (inserted.rowCount === 1) return 'imported';

  const updated = await pool.query(
    `UPDATE t10_tournament_state
     SET state = $1::jsonb, updated_at = now()
     WHERE id = 1 AND state = $2::jsonb
     RETURNING id`,
    [serializedState, serializedSeed]
  );
  if (updated.rowCount === 1) return 'imported';

  const existing = await pool.query(
    'SELECT state = $1::jsonb AS matches FROM t10_tournament_state WHERE id = 1',
    [serializedState]
  );
  if (existing.rows[0] && existing.rows[0].matches) return 'already-imported';
  throw new Error('The database already contains different tournament results; refusing to overwrite them.');
}

async function closeDatabase() {
  if (pool) await pool.end();
}

module.exports = {
  closeDatabase,
  clearLoginAttempt,
  createAdminSession,
  deleteAdminSession,
  importExistingState,
  initializeDatabase,
  isConfigured: () => Boolean(pool),
  isLoginBlocked,
  readTournamentState,
  recordFailedLogin,
  refreshAdminSession,
  updateTournamentState
};
