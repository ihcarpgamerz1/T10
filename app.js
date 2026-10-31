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
    { id:'m1', number:1, round:'Opening Round', category:'Opening Round', player1:'Sahaj Shrestha', player2:'Ridhi Byahut', winner:'Sahaj Shrestha', status:'COMPLETED', resultText:'Sahaj Shrestha defeats Ridhi Byahut', completed:true, target:'m5', slot:'slot1' },
    { id:'m2', number:2, round:'Opening Round', category:'Opening Round', player1:'Shubham Karn', player2:'Elvish Yadav', winner:'Elvish Yadav', status:'COMPLETED', resultText:'Elvish Yadav defeats Shubham Karn', completed:true, target:'m5', slot:'slot2' },
    { id:'m3', number:3, round:'Opening Round', category:'Opening Round', player1:'Sajan Baitha', player2:'Raiyan Hussain', winner:'Sajan Baitha', status:'COMPLETED', resultText:'Sajan Baitha defeats Raiyan Hussain', completed:true, target:'m6', slot:'slot1' },
    { id:'m4', number:4, round:'Opening Round', category:'Opening Round', player1:'Shubham Yadav', player2:'Sumit Gupta', winner:'Shubham Yadav', status:'COMPLETED', resultText:'Shubham Yadav defeats Sumit Gupta', completed:true, target:'m6', slot:'slot2' },
    { id:'m5', number:5, round:'Semifinal 1', category:'Semifinal', player1:'Sahaj Shrestha', player2:'Elvish Yadav', winner:'Sahaj Shrestha', status:'COMPLETED', resultText:'Sahaj Shrestha defeats Elvish Yadav', completed:true, target:'m7', slot:'slot1' },
    { id:'m6', number:6, round:'Semifinal 2', category:'Semifinal', player1:'Sajan Baitha', player2:'Shubham Yadav', winner:'Sajan Baitha', status:'COMPLETED', resultText:'Sajan Baitha defeats Shubham Yadav', completed:true, target:'m7', slot:'slot2' },
    { id:'m7', number:7, round:'Grand Final', category:'Final', player1:'Sajan Baitha', player2:'Sahaj Shrestha', winner:null, status:'PENDING', resultText:'Result Pending', completed:false, target:null, slot:'final' },
    { id:'m8', number:8, round:'Third-Place Playoff', category:'Third-Place Playoff', player1:'Elvish Yadav', player2:'Shubham Yadav', winner:'Elvish Yadav', status:'COMPLETED', resultText:'Elvish Yadav defeats Shubham Yadav', completed:true, target:null, slot:'third' }
  ],
  history: [{ name:'Sahasrishta', position:'Champion', tournamentDate:'Previous Edition', edition:'Historical Record', photo:'', achievements:'Historic previous champion entry as supplied.' }],
  champion: { winner:null, runnerUp:null, finalConfirmed:false },
  settings: { presentationMode:false, reducedMotion:false },
  selectedAdminMatch:'m7'
};

const $ = (selector) => document.querySelector(selector);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
      return structuredClone(initialData);
    }
    return {
      ...structuredClone(initialData),
      ...saved,
      eventInfo: { ...structuredClone(initialData.eventInfo), ...(saved.eventInfo || {}) },
      champion: { ...structuredClone(initialData.champion), ...(saved.champion || {}) },
      settings: { ...structuredClone(initialData.settings), ...(saved.settings || {}) },
      matches: saved.matches || structuredClone(initialData.matches),
      players: saved.players || structuredClone(initialData.players),
      history: saved.history || structuredClone(initialData.history),
      selectedAdminMatch: saved.selectedAdminMatch || 'm7'
    };
  } catch (error) {
    console.error('Could not restore saved state; resetting.', error);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
    return structuredClone(initialData);
  }
}

const state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getMatchById(id) {
  return state.matches.find((match) => match.id === id) || null;
}

function updateFinalStandings() {
  const finalMatch = getMatchById('m7');
  const thirdMatch = getMatchById('m8');
  if (finalMatch) {
    state.champion.winner = finalMatch.winner;
    state.champion.runnerUp = finalMatch.winner ? (finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1) : null;
    state.champion.finalConfirmed = Boolean(finalMatch.winner);
  }
  if (thirdMatch) {
    state.thirdPlace = {
      winner: thirdMatch.winner,
      runnerUp: thirdMatch.player1 === thirdMatch.winner ? thirdMatch.player2 : thirdMatch.player1,
      label: 'Official third-place result'
    };
  }
  saveState();
}

function renderBracket() {
  const container = $('#bracket-container');
  if (!container) return;

  const rounds = [
    { label: 'Opening Round', matches: state.matches.filter((m) => m.category === 'Opening Round') },
    { label: 'Semifinals', matches: state.matches.filter((m) => m.category === 'Semifinal') },
    { label: 'Championship Final', matches: state.matches.filter((m) => m.category === 'Final') },
    { label: 'Third-Place Playoff', matches: state.matches.filter((m) => m.category === 'Third-Place Playoff') }
  ];

  container.innerHTML = rounds.map((round) => `
    <div class="round-column">
      <div class="round-label">${round.label}</div>
      ${round.matches.map((match) => {
        const p1Win = match.winner === match.player1;
        const p2Win = match.winner === match.player2;
        return `
          <article class="match-card ${match.completed ? 'completed' : 'pending'} ${match.category === 'Final' ? 'final-match' : ''}">
            <div class="match-header">
              <span>Match ${match.number}</span>
              <span>${match.round}</span>
            </div>
            <div class="match-body">
              <div class="player-row ${p1Win ? 'winner' : ''}">
                <span class="player-name">${match.player1}</span>
                ${p1Win ? '<span class="player-tag">W</span>' : ''}
              </div>
              <div class="player-row ${p2Win ? 'winner' : ''}">
                <span class="player-name">${match.player2}</span>
                ${p2Win ? '<span class="player-tag">W</span>' : ''}
              </div>
            </div>
            <div class="match-result"><strong>${match.status}</strong> · ${match.resultText}</div>
          </article>
        `;
      }).join('')}
    </div>
  `).join('');
}

function renderFinalStage() {
  const finalStage = $('#final-stage');
  if (!finalStage) return;

  const finalMatch = getMatchById('m7');
  if (!finalMatch) return;

  if (finalMatch.winner) {
    finalStage.innerHTML = `
      <article class="feature-card">
        <h3>Champion</h3>
        <div class="big-name">${finalMatch.winner}</div>
        <div class="small-label">T10 SHOWDOWN CHAMPION</div>
      </article>
      <article class="feature-card">
        <h3>Runner-Up</h3>
        <div class="big-name">${finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1}</div>
        <div class="small-label">GRAND FINAL</div>
      </article>
    `;
  } else {
    finalStage.innerHTML = `
      <article class="feature-card">
        <h3>Grand Final</h3>
        <div class="big-name">SAJAN BAITHA</div>
        <div class="small-label">VS</div>
        <div class="big-name">SAHAJ SHRESTHA</div>
      </article>
      <article class="feature-card">
        <h3>Status</h3>
        <div class="big-name">RESULT PENDING</div>
        <div class="small-label">Awaiting official referee confirmation</div>
      </article>
    `;
  }
}

function renderThirdPlaceStage() {
  const thirdStage = $('#third-place-stage');
  if (!thirdStage) return;
  const match = getMatchById('m8');
  if (!match) return;
  const loser = match.player1 === match.winner ? match.player2 : match.player1;
  thirdStage.innerHTML = `
    <article class="feature-card">
      <h3>3rd Place</h3>
      <div class="big-name">${match.winner}</div>
      <div class="small-label">ELVISH YADAV</div>
    </article>
    <article class="feature-card">
      <h3>4th Place</h3>
      <div class="big-name">${loser}</div>
      <div class="small-label">SHUBHAM YADAV</div>
    </article>
  `;
}

function renderHistory() {
  const target = $('#history-container');
  if (!target) return;
  target.innerHTML = state.history.map((entry) => `
    <article class="history-item">
      <div class="history-name">${entry.name}</div>
      <div class="small-label">${entry.position}</div>
      <p>${entry.tournamentDate}</p>
      <p>${entry.edition}</p>
      <p>${entry.achievements || ''}</p>
    </article>
  `).join('');
}

function renderAdminList() {
  const list = $('#admin-list');
  if (!list) return;
  list.innerHTML = state.matches.map((match) => `
    <button class="admin-item ${state.selectedAdminMatch === match.id ? 'active' : ''}" data-match-id="${match.id}">
      <strong>Match ${match.number}</strong>
      <span>${match.status}</span>
    </button>
  `).join('');

  list.querySelectorAll('.admin-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedAdminMatch = button.dataset.matchId;
      renderAdminList();
      renderAdminEditor();
      saveState();
    });
  });
}

function renderAdminEditor() {
  const editor = $('#admin-editor');
  if (!editor) return;
  const match = getMatchById(state.selectedAdminMatch) || getMatchById('m7');
  if (!match) return;

  editor.innerHTML = `
    <div class="admin-editor">
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
        <button id="save-result" type="button">Save Result</button>
        <button id="preview-winner" type="button">Preview Winner Reveal</button>
        <button id="confirm-result" type="button">Confirm Final</button>
      </div>
    </div>
  `;

  $('#save-result').addEventListener('click', () => {
    const winner = $('#winner-select').value;
    const status = $('#status-select').value;
    match.winner = winner || null;
    match.status = status;
    match.completed = status === 'COMPLETED';
    match.resultText = winner ? `${winner} wins` : 'Result Pending';
    state.selectedAdminMatch = match.id;
    updateFinalStandings();
    renderEverything();
  });

  $('#preview-winner').addEventListener('click', () => {
    const winner = $('#winner-select').value || match.winner;
    if (!winner) {
      alert('Choose a confirmed winner before previewing the animation.');
      return;
    }
    showWinnerReveal(winner, match.player1 === winner ? match.player2 : match.player1);
  });

  $('#confirm-result').addEventListener('click', () => {
    const winner = $('#winner-select').value;
    if (!winner) {
      alert('A winner must be selected before confirmation.');
      return;
    }
    match.winner = winner;
    match.status = 'COMPLETED';
    match.completed = true;
    match.resultText = `${winner} wins`;
    updateFinalStandings();
    renderEverything();
    showWinnerReveal(winner, match.player1 === winner ? match.player2 : match.player1);
  });
}

function renderCertificates() {
  const panel = $('#certificate-panel');
  if (!panel) return;
  const awards = ['Champion', 'Runner-up', 'Third Place', 'Fourth Place'];
  panel.innerHTML = awards.map((award) => `
    <article class="certificate-card">
      <h3>${award}</h3>
      <div class="small-label">T10 SHOWDOWN</div>
      <button type="button">Generate Certificate</button>
    </article>
  `).join('');
}

function renderClockDemo() {
  const clockDemo = $('#clock-demo');
  if (!clockDemo) return;
  clockDemo.innerHTML = `
    <article class="clock-card">
      <div class="clock-display active">
        <div>
          <div class="clock-player">White</div>
          <div class="clock-time">10:00</div>
        </div>
        <div class="clock-player">Player A</div>
      </div>
      <div class="clock-controls">
        <button type="button">Switch to White</button>
        <button type="button">Switch to Black</button>
        <button type="button">Pause</button>
        <button type="button">Reset</button>
      </div>
    </article>
    <article class="clock-card">
      <div class="clock-display">
        <div>
          <div class="clock-player">Black</div>
          <div class="clock-time">10:00</div>
        </div>
        <div class="clock-player">Player B</div>
      </div>
      <div class="clock-controls">
        <button type="button">Switch to White</button>
        <button type="button">Switch to Black</button>
        <button type="button">Pause</button>
        <button type="button">Reset</button>
      </div>
    </article>
  `;
}

function showWinnerReveal(winner, loser) {
  const reveal = document.getElementById('winner-reveal');
  if (!reveal) return;

  reveal.innerHTML = `
    <div class="winner-scene">
      <div class="scene-overlay"></div>
      <div class="chess-floor"></div>
      <div class="winner-king king gold-king"></div>
      <div class="loser-king king black-king"></div>
      <div class="warrior-char">
        <div class="warrior-head"></div>
        <div class="warrior-body"></div>
        <div class="warrior-arm left"></div>
        <div class="warrior-arm right"></div>
      </div>
      <div class="winner-tile">
        <div class="winner-name">${winner}</div>
      </div>
      <div class="t10-mark">T10 SHOWDOWN</div>
      <button class="skip-reveal" type="button">Skip</button>
    </div>
  `;

  reveal.classList.remove('hidden');
  document.body.classList.add('reveal-open');

  const skipButton = reveal.querySelector('.skip-reveal');
  skipButton.addEventListener('click', () => hideWinnerReveal());

  setTimeout(() => {
    reveal.classList.add('finished');
  }, 2600);

  setTimeout(() => {
    hideWinnerReveal();
  }, 5600);
}

function hideWinnerReveal() {
  const reveal = document.getElementById('winner-reveal');
  if (!reveal) return;
  reveal.classList.add('hidden');
  reveal.classList.remove('finished');
  document.body.classList.remove('reveal-open');
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
  saveState();
}

function init() {
  renderEverything();
  const toggleButton = document.getElementById('toggle-presentation-mode');
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      state.settings.presentationMode = !state.settings.presentationMode;
      saveState();
      document.body.classList.toggle('presentation-mode', state.settings.presentationMode);
      toggleButton.textContent = state.settings.presentationMode ? 'Exit Presentation Mode' : 'Presentation Mode';
    });
  }
  document.body.classList.toggle('presentation-mode', state.settings.presentationMode);
}

init();
window.addEventListener('beforeunload', saveState);
