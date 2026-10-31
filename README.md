const STORAGE_KEY = 't10-showdown-state-v1';

const initialData = {
  eventInfo: {
    name: 'T10 SHOWDOWN',
    organizer: 'TREMENDOUS 10',
    slogan: 'THINK • MOVE • WIN',
    chiefGuest: 'Mr. Suman Shrestha',
    chiefReferee: 'Sonu Das',
    status: 'Grand Final Pending'
  },
  players: [
    { id: 'p1', name: 'Sahaj Shrestha' },
    { id: 'p2', name: 'Ridhi Byahut' },
    { id: 'p3', name: 'Shubham Karn' },
    { id: 'p4', name: 'Elvish Yadav' },
    { id: 'p5', name: 'Sajan Baitha' },
    { id: 'p6', name: 'Raiyan Hussain' },
    { id: 'p7', name: 'Shubham Yadav' },
    { id: 'p8', name: 'Sumit Gupta' }
  ],
  matches: [
    {
      id: 'm1',
      number: 1,
      round: 'Opening Round',
      category: 'Opening Round',
      player1: 'Sahaj Shrestha',
      player2: 'Ridhi Byahut',
      winner: 'Sahaj Shrestha',
      status: 'COMPLETED',
      resultText: 'Sahaj Shrestha defeats Ridhi Byahut',
      nextMatchId: 'm5',
      nextSlot: 'slot1',
      completed: true,
      championEligible: false,
      isFinal: false,
      isThirdPlace: false
    },
    {
      id: 'm2',
      number: 2,
      round: 'Opening Round',
      category: 'Opening Round',
      player1: 'Shubham Karn',
      player2: 'Elvish Yadav',
      winner: 'Elvish Yadav',
      status: 'COMPLETED',
      resultText: 'Elvish Yadav defeats Shubham Karn',
      nextMatchId: 'm5',
      nextSlot: 'slot2',
      completed: true,
      championEligible: false,
      isFinal: false,
      isThirdPlace: false
    },
    {
      id: 'm3',
      round: 'Opening Round',
      category: 'Opening Round',
      number: 3,
      player1: 'Sajan Baitha',
      player2: 'Raiyan Hussain',
      winner: 'Sajan Baitha',
      status: 'COMPLETED',
      resultText: 'Sajan Baitha defeats Raiyan Hussain',
      nextMatchId: 'm6',
      nextSlot: 'slot1',
      completed: true,
      championEligible: false,
      isFinal: false,
      isThirdPlace: false
    },
    {
      id: 'm4',
      round: 'Opening Round',
      category: 'Opening Round',
      number: 4,
      player1: 'Shubham Yadav',
      player2: 'Sumit Gupta',
      winner: 'Shubham Yadav',
      status: 'COMPLETED',
      resultText: 'Shubham Yadav defeats Sumit Gupta',
      nextMatchId: 'm6',
      nextSlot: 'slot2',
      completed: true,
      championEligible: false,
      isFinal: false,
      isThirdPlace: false
    },
    {
      id: 'm5',
      round: 'Semifinal 1',
      category: 'Semifinal',
      number: 5,
      player1: 'Sahaj Shrestha',
      player2: 'Elvish Yadav',
      winner: 'Sahaj Shrestha',
      status: 'COMPLETED',
      resultText: 'Sahaj Shrestha defeats Elvish Yadav',
      nextMatchId: 'm7',
      nextSlot: 'slot1',
      completed: true,
      championEligible: true,
      isFinal: false,
      isThirdPlace: false
    },
    {
      id: 'm6',
      round: 'Semifinal 2',
      category: 'Semifinal',
      number: 6,
      player1: 'Sajan Baitha',
      player2: 'Shubham Yadav',
      winner: 'Sajan Baitha',
      status: 'COMPLETED',
      resultText: 'Sajan Baitha defeats Shubham Yadav',
      nextMatchId: 'm7',
      nextSlot: 'slot2',
      completed: true,
      championEligible: true,
      isFinal: false,
      isThirdPlace: false
    },
    {
      id: 'm7',
      round: 'Grand Final',
      category: 'Final',
      number: 7,
      player1: 'Sajan Baitha',
      player2: 'Sahaj Shrestha',
      winner: null,
      status: 'PENDING',
      resultText: 'Result Pending',
      nextMatchId: null,
      completed: false,
      championEligible: true,
      isFinal: true,
      isThirdPlace: false
    },
    {
      id: 'm8',
      round: 'Third-Place Playoff',
      category: 'Third-Place Playoff',
      number: 8,
      player1: 'Elvish Yadav',
      player2: 'Shubham Yadav',
      winner: 'Elvish Yadav',
      status: 'COMPLETED',
      resultText: 'Elvish Yadav defeats Shubham Yadav',
      nextMatchId: null,
      completed: true,
      championEligible: false,
      isFinal: false,
      isThirdPlace: true
    }
  ],
  history: [
    {
      name: 'Sahasrishta',
      position: 'Champion',
      tournamentDate: 'Previous Edition',
      edition: 'Historical Record',
      photo: '',
      achievements: 'Historic previous champion entry as supplied.'
    }
  ],
  champion: {
    winner: null,
    runnerUp: null,
    finalConfirmed: false
  },
  settings: {
    reducedMotion: false,
    presentationMode: false
  }
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
      return structuredClone(initialData);
    }
    const parsed = JSON.parse(raw);
    const merged = {
      ...structuredClone(initialData),
      ...parsed,
      players: parsed.players || structuredClone(initialData.players),
      matches: parsed.matches || structuredClone(initialData.matches),
      history: parsed.history || structuredClone(initialData.history),
      eventInfo: { ...structuredClone(initialData.eventInfo), ...(parsed.eventInfo || {}) },
      champion: { ...structuredClone(initialData.champion), ...(parsed.champion || {}) },
      settings: { ...structuredClone(initialData.settings), ...(parsed.settings || {}) }
    };
    return merged;
  } catch (error) {
    console.error('Failed to load saved state; resetting to initial data.', error);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
    return structuredClone(initialData);
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadState();

function getMatchById(matchId) {
  return state.matches.find((match) => match.id === matchId);
}

function getWinnerByMatch(match) {
  if (!match || !match.winner) return null;
  return match.winner;
}

function updateFinalStandings() {
  const finalMatch = getMatchById('m7');
  const thirdPlaceMatch = getMatchById('m8');
  const winner = finalMatch?.winner || null;
  const runnerUp = winner ? (winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1) : null;

  state.champion = {
    winner,
    runnerUp,
    finalConfirmed: Boolean(winner)
  };

  if (thirdPlaceMatch) {
    state.thirdPlace = {
      winner: thirdPlaceMatch.winner,
      runnerUp: thirdPlaceMatch.player1 === thirdPlaceMatch.winner ? thirdPlaceMatch.player2 : thirdPlaceMatch.player1
    };
  }

  saveState(state);
}

function renderBracket() {
  const container = document.getElementById('bracket-container');
  if (!container) return;

  const rounds = [
    { label: 'Opening Round', matches: state.matches.filter((m) => m.category === 'Opening Round') },
    { label: 'Semifinals', matches: state.matches.filter((m) => m.category === 'Semifinal') },
    { label: 'Championship Final', matches: state.matches.filter((m) => m.category === 'Final') },
    { label: 'Third-Place Playoff', matches: state.matches.filter((m) => m.category === 'Third-Place Playoff') }
  ];

  container.innerHTML = rounds
    .map((round) => {
      const cards = round.matches
        .map((match) => {
          const player1Winner = match.winner === match.player1;
          const player2Winner = match.winner === match.player2;
          return `
            <article class="match-card ${match.completed ? 'completed' : 'pending'} ${match.isFinal ? 'final-match' : ''}">
              <div class="match-header">
                <span>Match ${match.number}</span>
                <span>${match.round}</span>
              </div>
              <div class="match-body">
                <div class="player-row ${player1Winner ? 'winner' : ''}">
                  <span class="player-name">${match.player1}</span>
                  ${player1Winner ? '<span class="player-tag">W</span>' : ''}
                </div>
                <div class="player-row ${player2Winner ? 'winner' : ''}">
                  <span class="player-name">${match.player2}</span>
                  ${player2Winner ? '<span class="player-tag">W</span>' : ''}
                </div>
              </div>
              <div class="match-result">
                ${match.completed ? `<strong>${match.status}</strong> · ${match.resultText}` : `<strong>${match.status}</strong>`}
              </div>
            </article>
          `;
        })
        .join('');

      return `
        <div class="round-column">
          <div class="round-label">${round.label}</div>
          ${cards}
        </div>
      `;
    })
    .join('');
}

function renderFinalStage() {
  const finalStage = document.getElementById('final-stage');
  const finalMatch = getMatchById('m7');
  if (!finalStage || !finalMatch) return;

  const winner = finalMatch.winner;
  const runnerUp = winner ? (winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1) : null;

  if (winner) {
    finalStage.innerHTML = `
      <article class="feature-card">
        <h3>Champion</h3>
        <div class="big-name">${winner}</div>
        <div class="small-label">T10 SHOWDOWN CHAMPION</div>
      </article>
      <article class="feature-card">
        <h3>Runner-Up</h3>
        <div class="big-name">${runnerUp}</div>
        <div class="small-label">GRAND FINAL</div>
      </article>
    `;
  } else {
    finalStage.innerHTML = `
      <article class="feature-card">
        <h3>Grand Final</h3>
        <div class="big-name">SAJAN BAITHA</div>
        <div class="small-label">VS</div>
        <div class="big-name" style="margin-top: 6px;">SAHAJ SHRESTHA</div>
      </article>
      <article class="feature-card">
        <h3>Status</h3>
        <div class="big-name">Result Pending</div>
        <div class="small-label">Awaiting official referee confirmation</div>
      </article>
    `;
  }
}

function renderThirdPlaceStage() {
  const thirdStage = document.getElementById('third-place-stage');
  const thirdMatch = getMatchById('m8');
  if (!thirdStage || !thirdMatch) return;

  thirdStage.innerHTML = `
    <article class="feature-card">
      <h3>3rd Place</h3>
      <div class="big-name">${thirdMatch.winner}</div>
      <div class="small-label">Official Third-Place Finisher</div>
    </article>
    <article class="feature-card">
      <h3>4th Place</h3>
      <div class="big-name">${thirdMatch.player1 === thirdMatch.winner ? thirdMatch.player2 : thirdMatch.player1}</div>
      <div class="small-label">Official Fourth-Place Finisher</div>
    </article>
  `;
}

function renderHistory() {
  const container = document.getElementById('history-container');
  if (!container) return;

  container.innerHTML = state.history
    .map((item) => `
      <article class="history-item">
        <div class="history-name">${item.name}</div>
        <div class="small-label">${item.position}</div>
        <p>${item.tournamentDate}</p>
        <p>${item.edition}</p>
        <p>${item.achievements || ''}</p>
      </article>
    `)
    .join('');
}

function renderAdminList() {
  const list = document.getElementById('admin-list');
  if (!list) return;

  const selectedMatch = state.selectedAdminMatch || 'm7';
  list.innerHTML = state.matches
    .map((match) => `
      <button class="admin-item ${selectedMatch === match.id ? 'active' : ''}" data-match-id="${match.id}">
        <strong>Match ${match.number}</strong>
        <span>${match.status}</span>
      </button>
    `)
    .join('');

  list.querySelectorAll('.admin-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedAdminMatch = button.dataset.matchId;
      renderAdminEditor();
      renderAdminList();
    });
  });
}

function renderAdminEditor() {
  const editor = document.getElementById('admin-editor');
  if (!editor) return;

  const selectedId = state.selectedAdminMatch || 'm7';
  const match = getMatchById(selectedId) || getMatchById('m7');

  if (!match) return;

  editor.className = 'admin-editor';
  editor.innerHTML = `
    <div class="field-group">
      <label>Match</label>
      <input value="Match ${match.number} — ${match.round}" readonly />
    </div>
    <div class="field-group">
      <label>Player 1</label>
      <input value="${match.player1}" readonly />
    </div>
    <div class="field-group">
      <label>Player 2</label>
      <input value="${match.player2}" readonly />
    </div>
    <div class="field-group">
      <label>Winner</label>
      <select id="winner-select">
        <option value="">Pending</option>
        <option value="${match.player1}" ${match.winner === match.player1 ? 'selected' : ''}>${match.player1}</option>
        <option value="${match.player2}" ${match.winner === match.player2 ? 'selected' : ''}>${match.player2}</option>
      </select>
    </div>
    <div class="field-group">
      <label>Status</label>
      <select id="status-select">
        <option value="COMPLETED" ${match.status === 'COMPLETED' ? 'selected' : ''}>COMPLETED</option>
        <option value="PENDING" ${match.status === 'PENDING' ? 'selected' : ''}>PENDING</option>
      </select>
    </div>
    <div class="editor-actions">
      <button id="save-result">Save Result</button>
      <button id="confirm-result">Confirm & Finalize</button>
    </div>
  `;

  document.getElementById('save-result').addEventListener('click', () => {
    const winner = document.getElementById('winner-select').value;
    const status = document.getElementById('status-select').value;
    match.winner = winner || null;
    match.status = status;
    match.completed = status === 'COMPLETED';
    match.resultText = winner ? `${winner} wins` : 'Result Pending';
    updateFinalStandings();
    renderEverything();
  });

  document.getElementById('confirm-result').addEventListener('click', () => {
    const winner = document.getElementById('winner-select').value;
    if (!winner && match.id === 'm7') {
      alert('The grand final cannot be confirmed without a winner.');
      return;
    }

    match.winner = winner || null;
    match.status = 'COMPLETED';
    match.completed = true;
    match.resultText = winner ? `${winner} wins` : 'Result Pending';

    if (match.id === 'm7') {
      state.champion.finalConfirmed = true;
      state.champion.winner = winner;
      state.champion.runnerUp = winner === match.player1 ? match.player2 : match.player1;
    }

    updateFinalStandings();
    renderEverything();
  });
}

function renderCertificates() {
  const panel = document.getElementById('certificate-panel');
  if (!panel) return;

  const certs = [
    'Champion',
    'Runner-up',
    'Third Place',
    'Fourth Place'
  ];

  panel.innerHTML = certs
    .map((title) => `
      <article class="certificate-card">
        <h3>${title}</h3>
        <div class="small-label">${state.eventInfo.name}</div>
        <button>Generate Certificate</button>
      </article>
    `)
    .join('');
}

function renderClockDemo() {
  const clockDemo = document.getElementById('clock-demo');
  if (!clockDemo) return;

  const clockState = {
    white: 600,
    black: 600,
    active: 'white'
  };

  clockDemo.innerHTML = `
    <article class="clock-card">
      <div class="clock-display ${clockState.active === 'white' ? 'active' : ''}">
        <div>
          <div class="clock-player">White</div>
          <div class="clock-time">10:00</div>
        </div>
        <div class="clock-player">Player 1</div>
      </div>
      <div class="clock-controls">
        <button data-clock-action="switch-white">White to Move</button>
        <button data-clock-action="switch-black">Black to Move</button>
        <button data-clock-action="start">Start</button>
        <button data-clock-action="pause">Pause</button>
        <button data-clock-action="reset">Reset</button>
      </div>
    </article>
    <article class="clock-card">
      <div class="clock-display ${clockState.active === 'black' ? 'active' : ''}">
        <div>
          <div class="clock-player">Black</div>
          <div class="clock-time">10:00</div>
        </div>
        <div class="clock-player">Player 2</div>
      </div>
      <div class="clock-controls">
        <button data-clock-action="switch-white">White</button>
        <button data-clock-action="switch-black">Black</button>
        <button data-clock-action="reset">Reset</button>
      </div>
    </article>
  `;
}

function togglePresentationMode() {
  state.settings.presentationMode = !state.settings.presentationMode;
  saveState(state);
  const toggleButton = document.getElementById('toggle-presentation-mode');
  if (toggleButton) {
    toggleButton.textContent = state.settings.presentationMode ? 'Exit Presentation Mode' : 'Presentation Mode';
  }

  document.body.classList.toggle('presentation-mode', state.settings.presentationMode);
}

function renderEverything() {
  renderBracket();
  renderFinalStage();
  renderThirdPlaceStage();
  renderHistory();
  renderAdminList();
  renderAdminEditor();
  renderCertificates();
  renderClockDemo();

  const toggleButton = document.getElementById('toggle-presentation-mode');
  if (toggleButton) {
    toggleButton.textContent = state.settings.presentationMode ? 'Exit Presentation Mode' : 'Presentation Mode';
  }
}

function initialize() {
  state.selectedAdminMatch = 'm7';
  renderEverything();

  const toggleButton = document.getElementById('toggle-presentation-mode');
  if (toggleButton) {
    toggleButton.addEventListener('click', togglePresentationMode);
  }

  document.body.classList.toggle('presentation-mode', state.settings.presentationMode);
}

initialize();

window.addEventListener('beforeunload', () => saveState(state));
