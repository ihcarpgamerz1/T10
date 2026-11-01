const fs = require('node:fs/promises');
const path = require('node:path');
const database = require('../lib/database');

async function importState() {
  if (!database.isConfigured()) {
    throw new Error('Set DATABASE_URL before importing tournament state.');
  }

  const root = path.resolve(__dirname, '..');
  const statePath = path.resolve(process.env.T10_STATE_FILE || path.join(root, 'data', 'state.json'));
  const initialStatePath = path.join(root, 'data', 'initial-state.json');
  const [stateText, seedText] = await Promise.all([
    fs.readFile(statePath, 'utf8'),
    fs.readFile(initialStatePath, 'utf8')
  ]);
  const state = JSON.parse(stateText);
  const seedState = JSON.parse(seedText);
  if (!Array.isArray(state.matches)
      || state.matches.length !== seedState.matches.length
      || state.matches.some((match, index) => !match || match.id !== seedState.matches[index].id)) {
    throw new Error('The local state file has an invalid match list.');
  }

  const result = await database.importExistingState(state, seedState);
  console.log(result === 'imported'
    ? 'Tournament state imported successfully.'
    : 'This tournament state is already present; no changes were made.');
}

importState()
  .catch((error) => {
    console.error('Could not import tournament state:', error.message);
    process.exitCode = 1;
  })
  .finally(() => database.closeDatabase());
