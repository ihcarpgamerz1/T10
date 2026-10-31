const $ = (selector) => document.querySelector(selector);
const isAdminPage = document.body.dataset.page === 'admin';
const PRESENTATION_KEY = 't10-showdown-presentation-mode';
const BANNER_KEY = 't10-showdown-featured-banner';
const ORGANIZING_COMMITTEE = [
  { role: 'Chief Organizer', names: ['Sajan Baitha'] },
  { role: 'Host', names: ['Ridhi Byahut'] },
  { role: 'Members', names: ['Shubham Yadav', 'Sahaj Shrestha', 'Sumit Gupta'] }
];
let state = null;
let adminAuthenticated = false;
let replayWaitCancel = null;
let bracketResizeObserver = null;
let tournamentReplayRunning = false;
let presentationSequenceRunning = false;
let presentationSequenceId = 0;
let presentationWaitCancel = null;
let activeReplayMatchId = null;
let revealTimers = [];
let clockState = { whiteSeconds: 600, blackSeconds: 600, activeSide: null, running: false, intervalId: null };
let entranceObserver = null;
let certificateReturnFocus = null;
let activeGeneratedCertificate = null;

async function requestJSON(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options
    });
  } catch {
    throw new Error('The tournament server is not running. Start it with `npm start` and open the address on port 3000 (not Live Server).');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('This page is being served without the tournament backend. Start it with `npm start` and use the address on port 3000 (not Live Server).');
  }
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

async function loadState() {
  const result = await requestJSON('/api/state');
  result.settings = {
    ...result.settings,
    presentationMode: localStorage.getItem(PRESENTATION_KEY) === 'true'
  };
  return result;
}

async function saveState() {
  try {
    await requestJSON('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ matches: state.matches.map(({ id, winner, status }) => ({ id, winner, status })) })
    });
    showAdminMessage('Results saved successfully.', 'success');
    return true;
  } catch (error) {
    if (error.status === 401) {
      adminAuthenticated = false;
      setAdminView(false);
    }
    showAdminMessage(error.message, 'error');
    return false;
  }
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
    state.champion.finalConfirmed = Boolean(finalMatch.winner && finalMatch.status === 'COMPLETED');
  }
  if (thirdMatch) {
    const confirmed = Boolean(thirdMatch.winner && thirdMatch.status === 'COMPLETED');
    state.thirdPlace = {
      winner: confirmed ? thirdMatch.winner : null,
      runnerUp: confirmed ? (thirdMatch.player1 === thirdMatch.winner ? thirdMatch.player2 : thirdMatch.player1) : null,
      label: 'Official third-place result'
    };
  }
}

function synchronizeBracketFromResults() {
  const matchesById = new Map(state.matches.map((match) => [match.id, match]));
  for (const source of state.matches) {
    const winnerTarget = source.target || source.nextMatchId;
    const routes = [
      { targetId: winnerTarget, slot: source.slot, player: source.status === 'COMPLETED' ? source.winner : null },
      {
        targetId: source.loserTarget,
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
  updateFinalStandings();
}

function getNextMatchId(match) {
  return match.nextMatchId || match.target || null;
}

function renderMatchCard(match, { bracket = false } = {}) {
  const playerOneWon = match.winner === match.player1;
  const playerTwoWon = match.winner === match.player2;
  const isComplete = match.status === 'COMPLETED';
  return `
    <article
      class="${bracket ? 'match-card bracket-match' : 'match-card playoff-match'} ${isComplete ? 'completed' : 'pending'} ${match.category === 'Final' ? 'final-match' : ''}"
      data-match-id="${match.id}"
    >
      <div class="match-header">
        <span>Match ${match.number}</span>
        <span>${match.round}</span>
      </div>
      <div class="match-body">
        <div class="player-row ${playerOneWon ? 'winner' : ''}">
          <span class="player-name">${match.player1 || 'TBD'}</span>
          ${playerOneWon ? '<span class="player-tag">Winner</span>' : ''}
        </div>
        <div class="player-row ${playerTwoWon ? 'winner' : ''}">
          <span class="player-name">${match.player2 || 'TBD'}</span>
          ${playerTwoWon ? '<span class="player-tag">Winner</span>' : ''}
        </div>
      </div>
      <div class="match-result"><strong>${match.status}</strong><span>${match.resultText}</span></div>
    </article>
  `;
}

function drawBracketConnectors() {
  const tree = $('[data-bracket-tree]');
  const svg = tree?.querySelector('.bracket-connectors');
  if (!tree || !svg || !state) return;

  const bounds = tree.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  svg.setAttribute('width', String(bounds.width));
  svg.setAttribute('height', String(bounds.height));

  const paths = [];
  for (const target of state.matches) {
    const sources = state.matches.filter((match) => getNextMatchId(match) === target.id);
    if (sources.length !== 2) continue;

    const sourceNodes = sources.map((match) => tree.querySelector(`[data-match-id="${match.id}"]`));
    const targetNode = tree.querySelector(`[data-match-id="${target.id}"]`);
    if (sourceNodes.some((node) => !node) || !targetNode) continue;

    const sourcePoints = sources.map((match, index) => {
      const rect = sourceNodes[index].getBoundingClientRect();
      const advances = match.winner && [target.player1, target.player2].includes(match.winner);
      return {
        x: rect.right - bounds.left,
        y: rect.top + rect.height / 2 - bounds.top,
        advances
      };
    }).sort((a, b) => a.y - b.y);
    const targetRect = targetNode.getBoundingClientRect();
    const targetPoint = {
      x: targetRect.left - bounds.left,
      y: targetRect.top + targetRect.height / 2 - bounds.top
    };
    const joinX = sourcePoints[0].x + (targetPoint.x - sourcePoints[0].x) / 2;
    const classes = sourcePoints.every((point) => point.advances)
      ? 'bracket-link bracket-link-advance'
      : 'bracket-link';
    const sourceMatchIds = sources.map((match) => match.id).join(' ');
    paths.push(
      `<path class="${classes}" data-target-match-id="${target.id}" data-source-match-ids="${sourceMatchIds}" d="M ${sourcePoints[0].x} ${sourcePoints[0].y} H ${joinX} V ${sourcePoints[1].y} M ${sourcePoints[1].x} ${sourcePoints[1].y} H ${joinX} M ${joinX} ${targetPoint.y} H ${targetPoint.x}" />`
    );
  }
  svg.innerHTML = paths.join('');
}

function renderBracket() {
  const container = $('#bracket-container');
  if (!container) return;

  const rounds = [
    { key: 'opening', label: 'Opening Round', category: 'Opening Round', className: 'bracket-round-opening' },
    { key: 'semifinal', label: 'Semi-finals', category: 'Semifinal', className: 'bracket-round-semifinal' },
    { key: 'final', label: 'Championship Final', category: 'Final', className: 'bracket-round-final' }
  ];
  const thirdPlaceMatch = state.matches.find((match) => match.isThirdPlace || match.category === 'Third-Place Playoff');

  container.innerHTML = `
    <div class="bracket-viewport">
      <div class="bracket-tree" data-bracket-tree role="group" aria-label="Tournament advancement bracket">
        <svg class="bracket-connectors" aria-hidden="true" focusable="false"></svg>
        ${rounds.map((round) => {
          const matches = state.matches.filter((match) => match.category === round.category);
          return `
            <section class="bracket-round ${round.className}" aria-label="${round.label}">
              <h3 class="round-label">${round.label}</h3>
              <div class="bracket-lane">
                ${matches.map((match) => renderMatchCard(match, { bracket: true })).join('')}
              </div>
            </section>
          `;
        }).join('')}
      </div>
      ${thirdPlaceMatch ? `
        <section class="bracket-playoff" aria-label="Third-place classification match">
          <div class="playoff-heading">
            <p class="eyebrow">Classification Match</p>
            <h3>Third-Place Playoff</h3>
            <p>Semifinalists compete for the bronze finish.</p>
          </div>
          ${renderMatchCard(thirdPlaceMatch)}
        </section>
      ` : ''}
    </div>
  `;

  drawBracketConnectors();
  setActiveBracketMatch(activeReplayMatchId);
  if (!bracketResizeObserver && 'ResizeObserver' in window) {
    bracketResizeObserver = new ResizeObserver(drawBracketConnectors);
    bracketResizeObserver.observe(container);
  }
}

function renderFinalStage() {
  const finalStage = $('#final-stage');
  if (!finalStage) return;

  const finalMatch = getMatchById('m7');
  if (!finalMatch) return;

  const confirmed = finalMatch.winner && finalMatch.status === 'COMPLETED';
  const posterPlayers = ['Sahaj Shrestha', 'Sajan Baitha'].sort().join('|');
  const currentFinalists = [finalMatch.player1, finalMatch.player2].filter(Boolean).sort().join('|');
  const showSuppliedPoster = currentFinalists === posterPlayers;
  const runnerUp = confirmed
    ? (finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1)
    : null;
  finalStage.innerHTML = `
      ${showSuppliedPoster ? `<figure class="finale-banner ${confirmed ? 'finale-banner-confirmed' : 'finale-banner-pending'}">
        <img src="/finale.png" alt="T10 Showdown Grand Final poster featuring Sajan Baitha and Sahaj Shrestha" width="1664" height="936" loading="lazy" />
        <figcaption class="finale-banner-caption">
          <span>${confirmed ? 'OFFICIAL RESULT' : 'GRAND FINAL · RESULT PENDING'}</span>
          <strong>${confirmed ? finalMatch.winner : `${finalMatch.player1 || 'TBD'} vs ${finalMatch.player2 || 'TBD'}`}</strong>
          <small>${confirmed ? `RUNNER-UP · ${runnerUp}` : 'Awaiting the referee’s official result'}</small>
        </figcaption>
      </figure>` : `
      <article class="finale-dynamic-card ${confirmed ? 'finale-banner-confirmed' : 'finale-banner-pending'}">
        <p class="eyebrow">T10 SHOWDOWN · GRAND FINAL</p>
        <div class="finale-dynamic-players">
          <strong>${finalMatch.player1 || 'TBD'}</strong>
          <span>VS</span>
          <strong>${finalMatch.player2 || 'TBD'}</strong>
        </div>
        <p>${confirmed ? `Champion: ${finalMatch.winner} · Runner-up: ${runnerUp}` : 'Awaiting the referee’s official result'}</p>
      </article>`}
      <div class="final-stage-results">
      ${confirmed ? `
      <article class="feature-card">
        <h3>Champion</h3>
        <div class="big-name">${finalMatch.winner}</div>
        <div class="small-label">T10 SHOWDOWN CHAMPION</div>
      </article>
      <article class="feature-card">
        <h3>Runner-Up</h3>
        <div class="big-name">${runnerUp}</div>
        <div class="small-label">GRAND FINAL</div>
      </article>
      ` : `
      <article class="feature-card">
        <h3>Grand Final</h3>
        <div class="big-name">${finalMatch.player1 || 'TBD'}</div>
        <div class="small-label">VS</div>
        <div class="big-name">${finalMatch.player2 || 'TBD'}</div>
      </article>
      <article class="feature-card">
        <h3>Status</h3>
        <div class="big-name">RESULT PENDING</div>
        <div class="small-label">Awaiting official referee confirmation</div>
      </article>
      `}
      </div>
    `;
}

function renderThirdPlaceStage() {
  const thirdStage = $('#third-place-stage');
  if (!thirdStage) return;
  const match = getMatchById('m8');
  if (!match) return;
  const confirmed = match.status === 'COMPLETED' && Boolean(match.winner);
  const loser = confirmed ? (match.player1 === match.winner ? match.player2 : match.player1) : null;
  thirdStage.innerHTML = `
    <article class="feature-card">
      <h3>3rd Place</h3>
      <div class="big-name">${confirmed ? match.winner : 'RESULT PENDING'}</div>
      <div class="small-label">${confirmed ? 'THIRD-PLACE PLAYOFF WINNER' : 'Awaiting official result'}</div>
    </article>
    <article class="feature-card">
      <h3>4th Place</h3>
      <div class="big-name">${loser || 'RESULT PENDING'}</div>
      <div class="small-label">${confirmed ? 'THIRD-PLACE PLAYOFF RUNNER-UP' : 'Awaiting official result'}</div>
    </article>
  `;
}

function renderHistory() {
  const target = $('#history-container');
  if (!target) return;
  target.innerHTML = state.history.map((entry) => `
    <article class="history-item">
      <div class="history-edition">${entry.edition}</div>
      <div class="history-name">${entry.name}</div>
      <div class="small-label">${entry.position} · PREVIOUS CHAMPION</div>
      <p>${entry.tournamentDate}</p>
      <p>${entry.achievements || ''}</p>
    </article>
  `).join('');
}

function initializeBannerSelector() {
  const viewer = $('#banner-viewer');
  const image = $('#banner-viewer-image');
  const title = $('#banner-viewer-title');
  const openButton = $('#open-banner-viewer');
  const closeButton = $('#close-banner-viewer');
  const fullscreenButton = $('#toggle-banner-fullscreen');
  const downloadButton = $('#download-banner-image');
  const status = $('#banner-viewer-status');
  const buttons = [...document.querySelectorAll('[data-banner-choice]')];
  if (!viewer || !image || !title || !openButton || !closeButton || !fullscreenButton || !downloadButton || !buttons.length) return;

  const banners = {
    banner: { src: '/banner.png', alt: 'T10 Showdown Class 10 Chess Tournament banner', title: 'Tournament banner' },
    finale: { src: '/finale.png', alt: 'T10 Showdown Grand Final poster featuring Sajan Baitha and Sahaj Shrestha', title: 'Grand Final banner' }
  };
  const savedChoice = localStorage.getItem(BANNER_KEY);
  const initialChoice = Object.hasOwn(banners, savedChoice) ? savedChoice : 'banner';
  let returnFocus = null;

  function selectBanner(choice) {
    const banner = banners[choice];
    if (!banner) return;
    image.src = banner.src;
    image.classList.remove('banner-image-changing');
    void image.offsetWidth;
    image.classList.add('banner-image-changing');
    image.alt = banner.alt;
    title.textContent = banner.title;
    downloadButton.href = banner.src;
    downloadButton.download = `${choice === 'finale' ? 't10-showdown-grand-final' : 't10-showdown-banner'}.png`;
    for (const button of buttons) {
      const selected = button.dataset.bannerChoice === choice;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    image.addEventListener('error', () => {
      if (status) status.textContent = 'This banner image could not be loaded. Check that the tournament server is running.';
    });
    image.addEventListener('load', () => {
      if (status) status.textContent = '';
    });
    localStorage.setItem(BANNER_KEY, choice);
  }

  async function closeViewer() {
    if (document.fullscreenElement === viewer) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        if (status) status.textContent = `Fullscreen could not be exited: ${error.message}`;
        return;
      }
    }
    viewer.hidden = true;
    viewer.setAttribute('aria-hidden', 'true');
    openButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('banner-view-open');
    returnFocus?.focus();
    returnFocus = null;
  }

  openButton.addEventListener('click', () => {
    returnFocus = openButton;
    if (status) status.textContent = '';
    viewer.hidden = false;
    viewer.setAttribute('aria-hidden', 'false');
    openButton.setAttribute('aria-expanded', 'true');
    document.body.classList.add('banner-view-open');
    closeButton.focus();
  });
  closeButton.addEventListener('click', closeViewer);
  fullscreenButton.addEventListener('click', async () => {
    if (document.fullscreenElement === viewer) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        if (status) status.textContent = `Fullscreen could not be exited: ${error.message}`;
      }
      return;
    }
    if (!viewer.requestFullscreen) {
      if (status) status.textContent = 'Fullscreen is not supported by this browser.';
      return;
    }
    try {
      await viewer.requestFullscreen();
      if (status) status.textContent = '';
    } catch (error) {
      if (status) status.textContent = `Fullscreen could not be opened: ${error.message}`;
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const fullscreen = document.fullscreenElement === viewer;
    fullscreenButton.textContent = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
    if (status) status.textContent = '';
  });
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer) closeViewer();
  });
  document.addEventListener('keydown', (event) => {
    if (viewer.hidden) return;
    if (event.key === 'Escape') {
      closeViewer();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...viewer.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  for (const button of buttons) {
    button.addEventListener('click', () => selectBanner(button.dataset.bannerChoice));
  }
  selectBanner(initialChoice);
}

function initializeCertificateViewer() {
  const viewer = $('#certificate-viewer');
  const closeButton = $('#close-certificate-preview');
  const printButton = $('#print-certificate');
  const downloadButton = $('#download-certificate');
  const guestCard = $('#chief-guest-card');
  const refereeCard = $('#chief-referee-card');
  if (!viewer || !closeButton || !printButton || !downloadButton || !guestCard || !refereeCard) return;

  closeButton.addEventListener('click', closeCertificatePreview);
  printButton.addEventListener('click', printCertificatePreview);
  downloadButton.addEventListener('click', async () => {
    const status = $('#certificate-download-status');
    downloadButton.disabled = true;
    if (status) status.textContent = 'Preparing certificate download…';
    try {
      await downloadCertificatePreview();
      if (status) status.textContent = 'Certificate file downloaded.';
    } catch (error) {
      console.error('Unable to download certificate.', error);
      if (status) status.textContent = `Certificate download failed: ${error.message}`;
    } finally {
      downloadButton.disabled = false;
    }
  });

  const certificateCards = [
    { card: guestCard, recipient: 'MR. SUMAN SHRESTHA', artwork: '/suman.jpeg' },
    { card: refereeCard, recipient: 'MR. SONU DAS', artwork: '/sonu.jpeg' }
  ];
  for (const { card, recipient, artwork } of certificateCards) {
    const openTokenOfLove = () => openCertificatePreview({
      award: 'TOKEN OF LOVE & APPRECIATION',
      recipient,
      artwork
    }, card);
    card.addEventListener('click', openTokenOfLove);
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openTokenOfLove();
    });
  }
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer) closeCertificatePreview();
  });
  document.addEventListener('keydown', (event) => {
    if (viewer.hidden) return;
    if (event.key === 'Escape') {
      closeCertificatePreview();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...viewer.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function initializeScrollProgress() {
  const progress = $('#page-scroll-progress');
  if (!progress) return;
  let updatePending = false;

  function updateProgress() {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    const amount = scrollableHeight > 0 ? window.scrollY / scrollableHeight : 0;
    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, amount))})`;
    updatePending = false;
  }

  function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    window.requestAnimationFrame(updateProgress);
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  updateProgress();
}

function renderAdminList() {
  const list = $('#admin-list');
  if (!list) return;
  const summary = $('#admin-summary');
  if (summary) {
    const completed = state.matches.filter((match) => match.status === 'COMPLETED' && match.winner).length;
    const pending = state.matches.length - completed;
    summary.innerHTML = `
      <article class="admin-summary-card">
        <span class="admin-summary-label">Total matches</span>
        <strong>${state.matches.length}</strong>
        <span class="admin-summary-note">Across the tournament</span>
      </article>
      <article class="admin-summary-card admin-summary-complete">
        <span class="admin-summary-label">Confirmed</span>
        <strong>${completed}</strong>
        <span class="admin-summary-note">Official results saved</span>
      </article>
      <article class="admin-summary-card admin-summary-pending">
        <span class="admin-summary-label">Pending</span>
        <strong>${pending}</strong>
        <span class="admin-summary-note">Awaiting a result</span>
      </article>
    `;
  }
  list.innerHTML = state.matches.map((match) => `
    <button class="admin-item ${state.selectedAdminMatch === match.id ? 'active' : ''}" data-match-id="${match.id}" aria-pressed="${state.selectedAdminMatch === match.id}">
      <span class="admin-item-copy">
        <strong>${escapeHTML(match.round)} · Match ${escapeHTML(String(match.number))}</strong>
        <span class="admin-item-players">${escapeHTML(match.player1 || 'TBD')} <i aria-hidden="true">vs</i> ${escapeHTML(match.player2 || 'TBD')}</span>
      </span>
      <span class="admin-item-status ${match.status === 'COMPLETED' && match.winner ? 'is-complete' : 'is-pending'}">${match.status === 'COMPLETED' && match.winner ? 'Confirmed' : 'Pending'}</span>
    </button>
  `).join('');

  list.querySelectorAll('.admin-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedAdminMatch = button.dataset.matchId;
      renderAdminList();
      renderAdminEditor();
    });
  });
}

function renderAdminEditor() {
  const editor = $('#admin-editor');
  if (!editor) return;
  const match = getMatchById(state.selectedAdminMatch) || getMatchById('m7');
  if (!match) return;
  const playersReady = Boolean(match.player1 && match.player2);

  editor.innerHTML = `
    <div class="admin-editor">
      <div class="field-group">
        <label>Match</label>
        <input value="Match ${match.number} — ${match.round}" readonly />
      </div>
      <div class="field-group">
        <label>Player 1</label>
        <input value="${escapeHTML(match.player1 || 'TBD')}" readonly />
      </div>
      <div class="field-group">
        <label>Player 2</label>
        <input value="${escapeHTML(match.player2 || 'TBD')}" readonly />
      </div>
      <div class="field-group">
        <label>Winner</label>
        <select id="winner-select" ${playersReady ? '' : 'disabled'}>
          <option value="">Pending</option>
          ${match.player1 ? `<option value="${escapeHTML(match.player1)}" ${match.winner === match.player1 ? 'selected' : ''}>${escapeHTML(match.player1)}</option>` : ''}
          ${match.player2 ? `<option value="${escapeHTML(match.player2)}" ${match.winner === match.player2 ? 'selected' : ''}>${escapeHTML(match.player2)}</option>` : ''}
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
        <button id="confirm-result" type="button" ${playersReady ? '' : 'disabled'}>Confirm Result</button>
      </div>
    </div>
  `;

  $('#save-result').addEventListener('click', async () => {
    const winner = $('#winner-select').value;
    const status = $('#status-select').value;
    if (status === 'COMPLETED' && !winner) {
      showAdminMessage('Select a winner before marking this match completed.', 'error');
      return;
    }
    const previousState = structuredClone(state);
    match.winner = status === 'COMPLETED' ? (winner || null) : null;
    match.status = status;
    match.completed = status === 'COMPLETED';
    match.resultText = match.winner ? `${match.winner} wins` : 'Result Pending';
    state.selectedAdminMatch = match.id;
    synchronizeBracketFromResults();
    if (await saveState()) renderEverything();
    else {
      state = previousState;
      renderEverything();
    }
  });

  $('#preview-winner').addEventListener('click', () => {
    const winner = $('#winner-select').value || match.winner;
    if (!winner) {
      alert('Choose a confirmed winner before previewing the animation.');
      return;
    }
    showWinnerReveal(winner, match.player1 === winner ? match.player2 : match.player1, match.category === 'Final');
  });

  $('#confirm-result').addEventListener('click', async () => {
    const winner = $('#winner-select').value;
    if (!winner) {
      showAdminMessage('A winner must be selected before confirmation.', 'error');
      return;
    }
    const previousState = structuredClone(state);
    match.winner = winner;
    match.status = 'COMPLETED';
    match.completed = true;
    match.resultText = `${winner} wins`;
    synchronizeBracketFromResults();
    if (await saveState()) {
      renderEverything();
      showWinnerReveal(winner, match.player1 === winner ? match.player2 : match.player1, match.category === 'Final');
    } else {
      state = previousState;
      renderEverything();
    }
  });
}

function renderCertificates() {
  const panel = $('#certificate-panel');
  if (!panel) return;
  const finalMatch = getMatchById('m7');
  const thirdMatch = getMatchById('m8');
  const finalConfirmed = finalMatch?.status === 'COMPLETED' && Boolean(finalMatch.winner);
  const thirdConfirmed = thirdMatch?.status === 'COMPLETED' && Boolean(thirdMatch.winner);
  const runnerUp = finalConfirmed
    ? (finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1)
    : null;
  const fourthPlace = thirdConfirmed
    ? (thirdMatch.winner === thirdMatch.player1 ? thirdMatch.player2 : thirdMatch.player1)
    : null;
  const awards = [
    { title: 'Winner', rank: '1ST', key: 'Champion', recipient: finalConfirmed ? finalMatch.winner : null },
    { title: 'Runner-up', rank: '2ND', key: 'Runner-up', recipient: runnerUp },
    { title: 'Third Place', rank: '3RD', key: 'Third Place', recipient: thirdConfirmed ? thirdMatch.winner : null },
    { title: 'Fourth Place', rank: '4TH', key: 'Fourth Place', recipient: fourthPlace }
  ];
  panel.innerHTML = `${awards.map(({ title, rank, key, recipient }) => `
    <article class="certificate-card">
      <h3>${rank} · ${title}</h3>
      <p class="certificate-recipient">${recipient || 'Result pending'}</p>
      <div class="small-label">T10 SHOWDOWN</div>
      <button type="button" data-certificate-award="${key}" ${recipient ? '' : 'disabled'}>
        ${recipient ? 'Generate certificate' : 'Awaiting result'}
      </button>
    </article>
  `).join('')}<p class="certificate-feedback" id="certificate-feedback" role="status" aria-live="polite"></p>`;
  panel.querySelectorAll('[data-certificate-award]').forEach((button) => {
    button.addEventListener('click', async () => {
      const buttonLabel = button.textContent;
      button.disabled = true;
      button.classList.add('is-generating');
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Creating certificate…';
      const feedback = $('#certificate-feedback');
      if (feedback) feedback.textContent = 'Designing your official T10 certificate…';
      try {
        await openAwardCertificate(button.dataset.certificateAward, button);
        if (feedback) feedback.textContent = 'Certificate generated. Download or print your copy below.';
      } catch (error) {
        console.error('Unable to generate certificate preview.', error);
        if (feedback) feedback.textContent = `Certificate generation failed: ${error.message}`;
      } finally {
        button.disabled = false;
        button.classList.remove('is-generating');
        button.removeAttribute('aria-busy');
        button.textContent = buttonLabel;
      }
    });
  });
}

function renderOrganizationCommittee() {
  const markup = ORGANIZING_COMMITTEE.map(({ role, names }) => `
    <article class="committee-card">
      <p class="committee-role">${escapeHTML(role)}</p>
      <p class="committee-names">${names.map((name) => `<span class="committee-member">${escapeHTML(name)}</span>`).join('')}</p>
    </article>
  `).join('');
  for (const selector of ['#public-committee-list', '#admin-committee-list']) {
    const container = $(selector);
    if (container) container.innerHTML = markup;
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getAwardRecipient(award) {
  const finalMatch = getMatchById('m7');
  const thirdPlaceMatch = getMatchById('m8');
  const finalConfirmed = finalMatch?.status === 'COMPLETED' && Boolean(finalMatch.winner);
  const thirdPlaceConfirmed = thirdPlaceMatch?.status === 'COMPLETED' && Boolean(thirdPlaceMatch.winner);
  if (award === 'Champion') return finalConfirmed ? finalMatch.winner : null;
  if (award === 'Runner-up') {
    return finalConfirmed
      ? (finalMatch.winner === finalMatch.player1 ? finalMatch.player2 : finalMatch.player1)
      : null;
  }
  if (award === 'Third Place') return thirdPlaceConfirmed ? thirdPlaceMatch.winner : null;
  if (award === 'Fourth Place') {
    return thirdPlaceConfirmed
      ? (thirdPlaceMatch.winner === thirdPlaceMatch.player1 ? thirdPlaceMatch.player2 : thirdPlaceMatch.player1)
      : null;
  }
  return null;
}

function createCertificateMarkup({ award, recipient, description, artwork, rank }) {
  if (artwork) {
    return `
      <figure class="certificate-artwork-sheet">
        <img data-certificate-download="${escapeHTML(artwork)}" src="${escapeHTML(artwork)}" alt="${escapeHTML(award)} presented to ${escapeHTML(recipient)}" />
      </figure>
    `;
  }
  return `
    <article class="certificate-sheet">
      <div class="certificate-frame" aria-hidden="true"></div>
      <div class="certificate-laurel certificate-laurel-left" aria-hidden="true">❧</div>
      <div class="certificate-laurel certificate-laurel-right" aria-hidden="true">❧</div>
      <img src="/logo-transparent.png" alt="" />
      <p class="certificate-kicker">T10 SHOWDOWN · CLASS 10 CHESS TOURNAMENT</p>
      <p class="certificate-heading">CERTIFICATE OF ACHIEVEMENT</p>
      <span class="certificate-divider" aria-hidden="true"></span>
      <p class="certificate-rank-line">
        <span>${escapeHTML(rank || '')}</span>
        <span>RANK / POSITION</span>
        <span>${escapeHTML(award)}</span>
      </p>
      <p class="certificate-copy">This certificate is proudly presented to</p>
      <p class="certificate-print-recipient">${escapeHTML(recipient)}</p>
      <p class="certificate-copy certificate-description">${escapeHTML(description)}</p>
      <p class="certificate-motto">SMALL MOVES · BIG RESULTS</p>
      <div class="certificate-signatures">
        <span><strong>SUMAN SHRESTHA</strong>CHIEF GUEST</span>
        <span class="certificate-organizer"><strong>SAJAN BAITHA</strong>CHIEF ORGANIZER</span>
        <span><strong>SONU DAS</strong>CHIEF REFEREE</span>
      </div>
      <p class="certificate-token">A TOKEN OF LOVE</p>
    </article>
  `;
}

async function openAwardCertificate(award, trigger = document.activeElement) {
  const recipient = getAwardRecipient(award);
  const feedback = $('#certificate-feedback');
  if (!recipient) {
    if (feedback) feedback.textContent = 'This certificate is unavailable until the official match result is confirmed.';
    throw new Error('This certificate is unavailable until the official match result is confirmed.');
  }
  const certificate = {
    award: ({
      Champion: 'WINNER',
      'Runner-up': 'RUNNER-UP',
      'Third Place': 'THIRD PLACE',
      'Fourth Place': 'FOURTH PLACE'
    })[award],
    recipient,
    description: 'For exceptional skill, strategy, and sportsmanship in the T10 Showdown Class 10 Chess Tournament.'
  };
  certificate.rank = ({
    Champion: '1ST',
    'Runner-up': '2ND',
    'Third Place': '3RD',
    'Fourth Place': '4TH'
  })[award];
  const generatedFile = await createAwardCertificateFile(certificate);
  openCertificatePreview(certificate, trigger, generatedFile);
}

function openCertificatePreview(certificate, returnFocus = document.activeElement, generatedFile = null) {
  const viewer = $('#certificate-viewer');
  const preview = $('#certificate-preview-content');
  const printArea = $('#certificate-print');
  const title = $('#certificate-preview-title');
  if (!viewer || !preview || !printArea || !title) {
    throw new Error('The certificate preview is unavailable on this page.');
  }

  if (activeGeneratedCertificate?.previewUrl) URL.revokeObjectURL(activeGeneratedCertificate.previewUrl);
  activeGeneratedCertificate = generatedFile;
  const markup = generatedFile
    ? `<figure class="certificate-artwork-sheet generated-certificate-sheet"><img src="${generatedFile.previewUrl}" alt="${escapeHTML(certificate.award)} certificate presented to ${escapeHTML(certificate.recipient)}" /></figure>`
    : createCertificateMarkup(certificate);
  preview.innerHTML = markup;
  printArea.innerHTML = markup;
  const downloadStatus = $('#certificate-download-status');
  if (downloadStatus) downloadStatus.textContent = '';
  title.textContent = `${certificate.award} · Generated certificate`;
  certificateReturnFocus = returnFocus;
  viewer.hidden = false;
  viewer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('certificate-view-open');
  $('#close-certificate-preview')?.focus();
}

function closeCertificatePreview() {
  const viewer = $('#certificate-viewer');
  if (!viewer) return;
  viewer.hidden = true;
  viewer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('certificate-view-open');
  if (activeGeneratedCertificate?.previewUrl) URL.revokeObjectURL(activeGeneratedCertificate.previewUrl);
  activeGeneratedCertificate = null;
  certificateReturnFocus?.focus();
  certificateReturnFocus = null;
}

function printCertificatePreview() {
  const printArea = $('#certificate-print');
  if (!printArea?.innerHTML) return;
  window.print();
}

async function downloadCertificatePreview() {
  if (activeGeneratedCertificate) {
    const url = URL.createObjectURL(activeGeneratedCertificate.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeGeneratedCertificate.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const suppliedArtwork = $('#certificate-preview-content [data-certificate-download]');
  if (suppliedArtwork) {
    const link = document.createElement('a');
    link.href = suppliedArtwork.dataset.certificateDownload;
    link.download = suppliedArtwork.dataset.certificateDownload.split('/').pop() || 't10-certificate.jpeg';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    return;
  }
  throw new Error('This certificate is not available for download.');
}

async function createAwardCertificateFile({ award, rank, recipient, description }) {
  const imageResponse = await fetch('/logo-transparent.png');
  if (!imageResponse.ok) throw new Error('The T10 logo could not be loaded for the certificate download.');
  const logoBlob = await imageResponse.blob();
  let logoBitmap;
  try {
    logoBitmap = await createImageBitmap(logoBlob);
  } catch (error) {
    throw new Error(`The T10 logo could not be prepared for the certificate: ${error.message}`);
  }
  const logoCanvas = document.createElement('canvas');
  const logoScale = Math.min(1, 220 / Math.max(logoBitmap.width, logoBitmap.height));
  logoCanvas.width = Math.round(logoBitmap.width * logoScale);
  logoCanvas.height = Math.round(logoBitmap.height * logoScale);
  const logoContext = logoCanvas.getContext('2d');
  if (!logoContext) {
    logoBitmap.close();
    throw new Error('A canvas could not be created to prepare the certificate logo.');
  }
  logoContext.drawImage(logoBitmap, 0, 0, logoCanvas.width, logoCanvas.height);
  logoBitmap.close();
  const logoData = logoCanvas.toDataURL('image/png');
  const escapeXML = (value) => escapeHTML(value);
  const signatures = [
    ['SUMAN SHRESTHA', 'CHIEF GUEST'],
    ['SAJAN BAITHA', 'CHIEF ORGANIZER'],
    ['SONU DAS', 'CHIEF REFEREE']
  ];
  const signatureMarkup = signatures.map(([name, role], index) => {
    const x = [245, 700, 1155][index];
    return `<text x="${x}" y="862" text-anchor="middle" fill="#17283c" font-family="Arial,sans-serif" font-size="17" font-weight="700">${escapeXML(name)}</text><text x="${x}" y="891" text-anchor="middle" fill="#725b33" font-family="Arial,sans-serif" font-size="13" letter-spacing="2">${escapeXML(role)}</text>`;
  }).join('');
  const recipientFontSize = recipient.length > 22 ? 46 : 58;
  const descriptionLines = [];
  let descriptionLine = '';
  for (const word of description.split(/\s+/)) {
    if (`${descriptionLine} ${word}`.trim().length > 64 && descriptionLine) {
      descriptionLines.push(descriptionLine);
      descriptionLine = word;
    } else {
      descriptionLine = `${descriptionLine} ${word}`.trim();
    }
  }
  if (descriptionLine) descriptionLines.push(descriptionLine);
  const descriptionMarkup = descriptionLines.map((line, index) =>
    `<tspan x="700" dy="${index === 0 ? 0 : 30}">${escapeXML(line)}</tspan>`
  ).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="990" viewBox="0 0 1400 990">
      <defs>
        <linearGradient id="paper" x2="0" y2="1"><stop stop-color="#fffdf5"/><stop offset="1" stop-color="#eee5cf"/></linearGradient>
        <linearGradient id="gold" x2="1" y2="1"><stop stop-color="#e4bd67"/><stop offset="1" stop-color="#a77c35"/></linearGradient>
      </defs>
      <rect width="1400" height="990" fill="#f3eddf"/>
      <rect x="34" y="34" width="1332" height="922" rx="8" fill="url(#paper)" stroke="url(#gold)" stroke-width="8"/>
      <rect x="58" y="58" width="1284" height="874" fill="none" stroke="#b48b45" stroke-width="2"/>
      <path d="M38 38 H1362 V218 Q1120 296 700 300 Q280 296 38 218 Z" fill="#101927"/>
      <image href="${logoData}" x="640" y="48" width="120" height="118" preserveAspectRatio="xMidYMid meet"/>
      <text x="700" y="192" text-anchor="middle" fill="#e6c779" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="6">T10 SHOWDOWN · CLASS 10 CHESS TOURNAMENT</text>
      <text x="700" y="370" text-anchor="middle" fill="#17283c" font-family="Georgia,serif" font-size="48" font-weight="700" letter-spacing="3">CERTIFICATE OF ACHIEVEMENT</text>
      <text x="700" y="424" text-anchor="middle" fill="#4d4a43" font-family="Georgia,serif" font-size="22">THIS CERTIFICATE IS PROUDLY PRESENTED TO</text>
      <path d="M260 476 H1140" stroke="#b48b45" stroke-width="2"/>
      <text x="445" y="518" text-anchor="middle" fill="#17283c" font-family="Georgia,serif" font-size="24" font-weight="700">${escapeXML(rank)}</text>
      <text x="700" y="518" text-anchor="middle" fill="#625b4e" font-family="Arial,sans-serif" font-size="16" letter-spacing="3">RANK / POSITION</text>
      <text x="955" y="518" text-anchor="middle" fill="#17283c" font-family="Georgia,serif" font-size="24" font-weight="700">${escapeXML(award)}</text>
      <path d="M390 532 H570 M830 532 H1010" stroke="#d3b264" stroke-width="1"/>
      <text x="700" y="620" text-anchor="middle" fill="#101927" font-family="Georgia,serif" font-size="${recipientFontSize}" font-weight="700">${escapeXML(recipient)}</text>
      <text x="700" y="685" text-anchor="middle" fill="#383735" font-family="Georgia,serif" font-size="22">${descriptionMarkup}</text>
      <text x="700" y="758" text-anchor="middle" fill="#8d7139" font-family="Arial,sans-serif" font-size="17" letter-spacing="6">SMALL MOVES · BIG RESULTS</text>
      <path d="M145 832 H355 M515 832 H885 M1045 832 H1255" stroke="#b48b45" stroke-width="2"/>
      ${signatureMarkup}
      <rect x="540" y="916" width="320" height="42" rx="21" fill="#101927"/>
      <text x="700" y="943" text-anchor="middle" fill="#e6c779" font-family="Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="4">A TOKEN OF LOVE</text>
    </svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const filenameRecipient = recipient.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const filenameAward = award.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const previewUrl = URL.createObjectURL(blob);
  const previewImage = new Image();
  previewImage.src = previewUrl;
  try {
    await previewImage.decode();
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw new Error(`The certificate was generated, but its image could not be displayed: ${error.message}`);
  }
  return {
    blob,
    previewUrl,
    filename: `${filenameRecipient}-${filenameAward}-certificate.svg`
  };
}

function renderClockDemo() {
  const clockDemo = $('#clock-demo');
  if (!clockDemo) return;
  const finalMatch = getMatchById('m7');
  const whiteName = finalMatch?.player1 || 'White';
  const blackName = finalMatch?.player2 || 'Black';
  clockDemo.innerHTML = `
    <article class="clock-card">
      <div class="chess-clock-display">
        <div class="clock-display ${clockState.activeSide === 'white' ? 'active' : ''}" data-clock-side="white">
          <div><div class="clock-player">White</div><div class="clock-time" data-clock-time="white">${formatClock(clockState.whiteSeconds)}</div></div>
          <div class="clock-player clock-name">${whiteName}</div>
        </div>
        <div class="clock-display ${clockState.activeSide === 'black' ? 'active' : ''}" data-clock-side="black">
          <div><div class="clock-player">Black</div><div class="clock-time" data-clock-time="black">${formatClock(clockState.blackSeconds)}</div></div>
          <div class="clock-player clock-name">${blackName}</div>
        </div>
      </div>
      <div class="clock-toolbar">
        <p data-clock-status role="status" aria-live="polite">${clockState.running ? `${clockState.activeSide === 'white' ? 'White' : 'Black'} to move` : 'Clock paused · press start to begin'}</p>
        <div class="clock-controls">
          <button type="button" data-clock-action="start" ${clockExpired() ? 'disabled' : ''}>${clockState.running ? 'Running' : 'Start clock'}</button>
          <button type="button" data-clock-action="switch" ${clockExpired() ? 'disabled' : ''}>Switch turn</button>
          <button type="button" data-clock-action="pause">Pause</button>
          <button type="button" data-clock-action="reset">Reset</button>
        </div>
      </div>
    </article>
  `;
  clockDemo.querySelectorAll('[data-clock-action]').forEach((button) => {
    button.addEventListener('click', () => handleClockAction(button.dataset.clockAction));
  });
}

function clockExpired() {
  return clockState.whiteSeconds === 0 || clockState.blackSeconds === 0;
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function stopChessClock() {
  if (clockState.intervalId !== null) window.clearInterval(clockState.intervalId);
  clockState.intervalId = null;
  clockState.running = false;
}

function handleClockAction(action) {
  if ((action === 'start' || action === 'switch') && clockExpired()) return;
  if (action === 'reset') {
    stopChessClock();
    clockState.whiteSeconds = 600;
    clockState.blackSeconds = 600;
    clockState.activeSide = null;
    renderClockDemo();
    return;
  }
  if (action === 'pause') {
    stopChessClock();
  } else if (action === 'start') {
    if (!clockState.activeSide) clockState.activeSide = 'white';
    if (!clockState.running) {
      clockState.running = true;
      clockState.intervalId = window.setInterval(tickChessClock, 1000);
    }
  } else if (action === 'switch') {
    if (!clockState.activeSide) clockState.activeSide = 'white';
    else clockState.activeSide = clockState.activeSide === 'white' ? 'black' : 'white';
    if (!clockState.running) {
      clockState.running = true;
      clockState.intervalId = window.setInterval(tickChessClock, 1000);
    }
  }
  renderClockDemo();
  const updatedStatus = $('[data-clock-status]');
  if (updatedStatus) updatedStatus.textContent = clockState.running
    ? `${clockState.activeSide === 'white' ? 'White' : 'Black'} to move`
    : 'Clock paused';
}

function tickChessClock() {
  if (!clockState.running || !clockState.activeSide) return;
  const key = clockState.activeSide === 'white' ? 'whiteSeconds' : 'blackSeconds';
  clockState[key] = Math.max(0, clockState[key] - 1);
  const time = $(`[data-clock-time="${clockState.activeSide}"]`);
  if (time) time.textContent = formatClock(clockState[key]);
  if (clockExpired()) {
    const expiredSide = clockState.activeSide;
    stopChessClock();
    const status = $('[data-clock-status]');
    if (status) status.textContent = `${expiredSide === 'white' ? 'White' : 'Black'} clock expired. Reset to play again.`;
    document.querySelectorAll('[data-clock-action="start"], [data-clock-action="switch"]')
      .forEach((button) => { button.disabled = true; });
  }
}

function showReplayScene(match, phase, index, total, {
  isReplay = true,
  isPresentation = false,
  statusMessage = ''
} = {}) {
  const reveal = document.getElementById('winner-reveal');
  if (!reveal) return;
  for (const timer of revealTimers) window.clearTimeout(timer);
  revealTimers = [];

  const completed = match.status === 'COMPLETED' && Boolean(match.winner);
  const loser = completed ? (match.winner === match.player1 ? match.player2 : match.player1) : '';
  const winnerSide = completed ? (match.winner === match.player1 ? 'white' : 'black') : '';
  const pendingTitle = match.category === 'Final' ? 'Grand Final result pending' : `${match.round} result pending`;
  reveal.innerHTML = `
    <div class="winner-scene replay-scene replay-phase-${phase}" data-match-id="${match.id}" data-winner-side="${winnerSide}">
      <div class="scene-overlay" aria-hidden="true"></div>
      <header class="replay-topline">
        <div class="replay-brand">
          <span class="replay-brand-mark">T10</span>
          <span>T10 SHOWDOWN <small>OFFICIAL TOURNAMENT REPLAY</small></span>
        </div>
        <span class="replay-progress">MATCH ${String(index).padStart(2, '0')} <i>/ ${String(total).padStart(2, '0')}</i></span>
        <button class="skip-reveal" type="button">${isReplay ? 'End replay' : 'Close'}</button>
      </header>
      <main class="replay-stage-content">
        <p class="replay-round">${match.round}</p>
        <div class="replay-matchup">
          <div class="replay-player replay-player-white">
            <span class="replay-player-side">WHITE</span>
            <strong>${escapeHTML(match.player1 || 'TBD')}</strong>
          </div>
          <span class="replay-versus">VS</span>
          <div class="replay-player replay-player-black">
            <span class="replay-player-side">BLACK</span>
            <strong>${escapeHTML(match.player2 || 'TBD')}</strong>
          </div>
        </div>
        <div class="replay-chessboard" aria-hidden="true">
          <span class="chess-piece chess-queen">♕</span>
          <span class="chess-piece chess-queen-black">♛</span>
          <span class="chess-piece chess-rook">♖</span>
          <span class="chess-piece chess-king-white">♔</span>
          <span class="chess-piece chess-king-black">♚</span>
          <span class="chess-piece chess-pawn">♟</span>
        </div>
        ${phase === 'result' && completed ? `
          <div class="replay-result">
            <span class="replay-result-label">${match.category === 'Final' ? 'CONGRATULATIONS' : 'MATCH WINNER'}</span>
            <strong class="replay-winner-name">${escapeHTML(match.winner)}</strong>
            <span class="replay-result-detail">${match.category === 'Final' ? 'T10 SHOWDOWN CHAMPION' : `${escapeHTML(match.winner)} defeats ${escapeHTML(loser)}`}</span>
          </div>
        ` : ''}
        ${phase === 'pending' ? `
          <div class="replay-pending">
            <span class="replay-pending-mark">♔</span>
            <strong>${pendingTitle}</strong>
            <span>${statusMessage || 'The official result will appear here once confirmed.'}</span>
          </div>
        ` : ''}
        ${phase === 'complete' ? `
          <div class="replay-result replay-complete">
            <span class="replay-result-label">TOURNAMENT COMPLETE</span>
            <strong class="replay-winner-name">${escapeHTML(statusMessage)}</strong>
            <span class="replay-result-detail">${statusMessage && statusMessage !== 'Replay complete' ? 'T10 SHOWDOWN · OFFICIAL CHAMPION' : 'T10 SHOWDOWN · OFFICIAL RESULTS'}</span>
          </div>
        ` : ''}
      </main>
      <footer class="replay-footer">
        <span>${phase === 'lineup' ? 'Players to the board' : phase === 'battle' ? 'The match is underway' : phase === 'result' ? 'Winner advances' : phase === 'pending' ? 'Awaiting official confirmation' : 'Thank you for watching'}</span>
        <span class="replay-footer-mark">THINK <i>•</i> MOVE <i>•</i> WIN</span>
      </footer>
    </div>
  `;
  reveal.classList.toggle('presentation-reveal', isPresentation);
  reveal.classList.remove('hidden');
  document.body.classList.toggle('presentation-reveal-open', isPresentation);
  document.body.classList.toggle('reveal-open', !isPresentation);

  reveal.querySelector('.skip-reveal').addEventListener('click', () => {
    if (isReplay && isPresentation) cancelPresentationSequence();
    else if (isReplay) cancelTournamentReplay();
    else hideWinnerReveal();
  });
}

function waitForReplay(duration) {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      replayWaitCancel = null;
      resolve(true);
    }, duration);
    replayWaitCancel = () => {
      window.clearTimeout(timer);
      replayWaitCancel = null;
      resolve(false);
    };
  });
}

function waitForPresentation(duration) {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      presentationWaitCancel = null;
      resolve(true);
    }, duration);
    presentationWaitCancel = () => {
      window.clearTimeout(timer);
      presentationWaitCancel = null;
      resolve(false);
    };
  });
}

function scrollToElement(element, block = 'start', inline = 'nearest') {
  if (!element) return;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  element.scrollIntoView({ behavior, block, inline });
}

function clearBracketBuild() {
  const tree = $('[data-bracket-tree]');
  tree?.closest('.bracket-viewport')?.classList.remove('is-building');
  tree?.classList.remove('is-building');
  tree?.querySelectorAll('.build-visible').forEach((element) => element.classList.remove('build-visible'));
  tree?.querySelectorAll('.bracket-link').forEach((path) => {
    path.classList.remove('is-drawn');
    path.style.removeProperty('stroke-dasharray');
    path.style.removeProperty('stroke-dashoffset');
  });
  $('#bracket-container .bracket-playoff')?.classList.remove('build-visible');
}

function prepareBracketPresentation() {
  const tree = $('[data-bracket-tree]');
  if (!tree) return false;
  clearBracketBuild();
  tree.closest('.bracket-viewport')?.classList.add('is-building');
  tree.classList.add('is-building');
  return true;
}

function revealBracketMatch(matchId) {
  const tree = $('[data-bracket-tree]');
  const matchCard = document.querySelector(`[data-match-id="${matchId}"]`);
  if (!tree || !matchCard) return null;

  if (matchCard.classList.contains('playoff-match')) {
    matchCard.closest('.bracket-playoff')?.classList.add('build-visible');
  }
  matchCard.classList.add('build-visible');
  const path = tree.querySelector(`.bracket-link[data-target-match-id="${matchId}"]`);
  if (path) {
    const sourceIds = (path.dataset.sourceMatchIds || '').split(' ').filter(Boolean);
    const allSourcesRevealed = sourceIds.length > 0 && sourceIds.every((sourceId) =>
      tree.querySelector(`[data-match-id="${sourceId}"]`)?.classList.contains('build-visible')
    );
    if (allSourcesRevealed) {
      const pathLength = path.getTotalLength();
      path.style.strokeDasharray = String(pathLength);
      path.style.strokeDashoffset = String(pathLength);
      requestAnimationFrame(() => path.classList.add('is-drawn'));
    }
  }
  return matchCard;
}

function setActiveBracketMatch(matchId) {
  activeReplayMatchId = matchId;
  document.querySelectorAll('.bracket-match, .playoff-match').forEach((card) => {
    card.classList.toggle('replay-active', Boolean(matchId) && card.dataset.matchId === matchId);
  });
  document.querySelectorAll('.bracket-link').forEach((path) => {
    const sources = (path.dataset.sourceMatchIds || '').split(' ');
    path.classList.toggle('bracket-link-replay', Boolean(matchId) && sources.includes(matchId));
  });
}

function finishTournamentReplay() {
  tournamentReplayRunning = false;
  replayWaitCancel = null;
  setActiveBracketMatch(null);
  const replayButton = $('#start-tournament-replay');
  if (replayButton) replayButton.disabled = false;
}

function cancelTournamentReplay() {
  if (replayWaitCancel) replayWaitCancel();
  hideWinnerReveal();
  finishTournamentReplay();
}

function cancelPresentationSequence() {
  presentationSequenceId += 1;
  if (presentationWaitCancel) presentationWaitCancel();
  if (tournamentReplayRunning) cancelTournamentReplay();
  else clearBracketBuild();
  presentationSequenceRunning = false;
  if (state?.settings.presentationMode) {
    state.settings.presentationMode = false;
    localStorage.setItem(PRESENTATION_KEY, 'false');
    document.body.classList.remove('presentation-mode');
    const toggleButton = $('#toggle-presentation-mode');
    if (toggleButton) {
      toggleButton.textContent = 'Presentation Mode';
      toggleButton.setAttribute('aria-pressed', 'false');
    }
  }
  if (state) renderEverything();
  const replayButton = $('#start-tournament-replay');
  if (replayButton) replayButton.disabled = false;
}

async function startPresentationSequence() {
  if (!state || presentationSequenceRunning || tournamentReplayRunning) return;
  presentationSequenceRunning = true;
  const sequenceId = ++presentationSequenceId;
  const replayButton = $('#start-tournament-replay');
  if (replayButton) replayButton.disabled = true;

  try {
    const bracket = $('#bracket');
    const bracketBoard = $('#bracket-container');
    if (bracketBoard) bracketBoard.scrollLeft = 0;
    prepareBracketPresentation();
    scrollToElement(bracket);
    if (!await waitForPresentation(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200)) return;
    if (sequenceId !== presentationSequenceId) return;
    await playTournamentReplay({ presentation: true });
    if (sequenceId === presentationSequenceId && state.settings.presentationMode) {
      renderEverything();
      scrollToElement($('#final'));
    }
  } finally {
    if (sequenceId === presentationSequenceId) {
      presentationSequenceRunning = false;
      presentationWaitCancel = null;
      clearBracketBuild();
      if (replayButton) replayButton.disabled = false;
    }
  }
}

async function playTournamentReplay({ presentation = false } = {}) {
  if (!state || tournamentReplayRunning) return;
  const roundOrder = { 'Opening Round': 0, Semifinal: 1, 'Third-Place Playoff': 2, Final: 3 };
  const matches = [...state.matches]
    .filter((match) => Object.hasOwn(roundOrder, match.category))
    .sort((a, b) => roundOrder[a.category] - roundOrder[b.category] || a.number - b.number);
  if (!matches.length) return;

  tournamentReplayRunning = true;
  const replayButton = $('#start-tournament-replay');
  if (replayButton) replayButton.disabled = true;
  const reveal = document.getElementById('winner-reveal');
  if (reveal) reveal.classList.add('hidden');
  document.body.classList.remove('reveal-open');

  try {
    for (const [index, match] of matches.entries()) {
      const position = index + 1;
      const matchCard = presentation
        ? revealBracketMatch(match.id)
        : document.querySelector(`[data-match-id="${match.id}"]`);
      setActiveBracketMatch(match.id);
      if (presentation) {
        hideWinnerReveal();
        scrollToElement(matchCard, 'center', 'center');
        if (!await waitForReplay(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1600)) return;
      }
      showReplayScene(match, 'lineup', position, matches.length, { isPresentation: presentation });
      if (!await waitForReplay(presentation ? 2600 : 1200)) return;

      if (match.status !== 'COMPLETED' || !match.winner) {
        showReplayScene(match, 'pending', position, matches.length, { isPresentation: presentation });
        if (!await waitForReplay(presentation ? 3900 : 2400)) return;
        hideWinnerReveal();
        continue;
      }

      showReplayScene(match, 'battle', position, matches.length, { isPresentation: presentation });
      if (!await waitForReplay(presentation ? 3200 : 2100)) return;
      showReplayScene(match, 'result', position, matches.length, { isPresentation: presentation });
      if (!await waitForReplay(presentation && match.category === 'Final' ? 5000 : presentation ? 2600 : 1500)) return;
      if (presentation) hideWinnerReveal();
    }

    const finalMatch = state.matches.find((match) => match.id === 'm7');
    const champion = finalMatch?.status === 'COMPLETED' ? finalMatch.winner : null;
    const lastMatch = matches[matches.length - 1];
    if (champion) {
      showReplayScene(lastMatch, 'complete', matches.length, matches.length, {
        isPresentation: presentation,
        statusMessage: champion
      });
      await waitForReplay(presentation ? 5000 : 4200);
    } else {
      showReplayScene(lastMatch, 'pending', matches.length, matches.length, {
        isPresentation: presentation,
        statusMessage: 'No champion has been confirmed yet.'
      });
      await waitForReplay(presentation ? 4000 : 3000);
    }
  } finally {
    hideWinnerReveal();
    finishTournamentReplay();
  }
}

function showWinnerReveal(winner, loser, isFinal = false) {
  const match = {
    number: '—',
    round: 'Official match result',
    category: isFinal ? 'Final' : 'Match',
    player1: winner,
    player2: loser,
    winner,
    status: 'COMPLETED'
  };
  showReplayScene(match, 'battle', 1, 1, { isReplay: false });
  revealTimers.push(window.setTimeout(() => {
    const scene = document.querySelector('.replay-scene');
    if (scene) {
      scene.classList.remove('replay-phase-battle');
      scene.classList.add('replay-phase-result');
      scene.querySelector('.replay-result')?.remove();
      const result = document.createElement('div');
      result.className = 'replay-result';
      result.innerHTML = `<span class="replay-result-label">${isFinal ? 'CONGRATULATIONS' : 'MATCH WINNER'}</span><strong class="replay-winner-name">${escapeHTML(winner)}</strong><span class="replay-result-detail">${isFinal ? 'T10 SHOWDOWN CHAMPION' : 'T10 SHOWDOWN · OFFICIAL RESULT'}</span>`;
      scene.querySelector('.replay-stage-content').append(result);
    }
  }, 2000));
  revealTimers.push(window.setTimeout(hideWinnerReveal, 5400));
}

function hideWinnerReveal() {
  const reveal = document.getElementById('winner-reveal');
  if (!reveal) return;
  for (const timer of revealTimers) window.clearTimeout(timer);
  revealTimers = [];
  reveal.classList.add('hidden');
  reveal.classList.remove('finished');
  reveal.classList.remove('presentation-reveal');
  document.body.classList.remove('reveal-open');
  document.body.classList.remove('presentation-reveal-open');
}

function renderEverything() {
  if (!state) return;
  const statusPill = $('.status-pill');
  if (statusPill) {
    const confirmed = Boolean(state.champion.finalConfirmed);
    statusPill.classList.toggle('pending-final', !confirmed);
    statusPill.classList.toggle('final-confirmed', confirmed);
    statusPill.innerHTML = `<span class="dot"></span>${confirmed ? 'Grand Final Result Confirmed' : 'Grand Final Result Pending'}`;
  }
  renderBracket();
  renderFinalStage();
  renderThirdPlaceStage();
  renderHistory();
  renderAdminList();
  renderAdminEditor();
  renderCertificates();
  renderOrganizationCommittee();
  renderClockDemo();
  prepareEntranceEffects();
}

function prepareEntranceEffects() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  if (!entranceObserver) {
    entranceObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.1, rootMargin: '0px 0px -7% 0px' });
  }
  document.querySelectorAll('.hero, main > .section-block, .feature-card, .history-item, .appreciation-card, .clock-card, .certificate-card')
    .forEach((element, index) => {
      if (element.classList.contains('motion-ready')) return;
      element.classList.add('motion-ready');
      element.style.setProperty('--reveal-delay', `${Math.min(index % 5, 3) * 70}ms`);
      entranceObserver.observe(element);
    });
}

function showAdminMessage(message, type = '') {
  const feedback = $('#admin-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `admin-feedback ${type}`.trim();
  feedback.hidden = !message;
}

function setAdminView(authenticated) {
  const login = $('#admin-login');
  const content = $('#admin-content');
  if (login) login.hidden = authenticated;
  if (content) content.hidden = !authenticated;
}

async function initializeAdminPage() {
  setAdminView(false);
  const loginForm = $('#admin-login-form');
  const logoutButton = $('#admin-logout');

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passwordInput = $('#admin-password');
    showAdminMessage('');
    try {
      await requestJSON('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: passwordInput.value })
      });
      passwordInput.value = '';
      adminAuthenticated = true;
      state = await loadState();
      setAdminView(true);
      renderEverything();
      showAdminMessage('Signed in. Result changes are protected and saved on this server.', 'success');
    } catch (error) {
      showAdminMessage(error.message, 'error');
      passwordInput.focus();
    }
  });

  logoutButton.addEventListener('click', async () => {
    try {
      await requestJSON('/api/logout', { method: 'POST', body: '{}' });
      adminAuthenticated = false;
      state = null;
      setAdminView(false);
      showAdminMessage('You have been signed out.');
      $('#admin-password').focus();
    } catch (error) {
      showAdminMessage(error.message, 'error');
    }
  });

  try {
    const session = await requestJSON('/api/session');
    adminAuthenticated = session.authenticated;
    if (adminAuthenticated) {
      state = await loadState();
      setAdminView(true);
      renderEverything();
    }
  } catch (error) {
    showAdminMessage(`Unable to connect to the tournament server: ${error.message}`, 'error');
  }
}

async function initializePublicPage() {
  const pageMessage = $('#app-feedback');
  try {
    state = await loadState();
    renderEverything();
  } catch (error) {
    console.error('Unable to load tournament data from the server.', error);
    if (pageMessage) {
      pageMessage.textContent = `Tournament data is unavailable: ${error.message}`;
      pageMessage.hidden = false;
    }
    return;
  }

  const toggleButton = document.getElementById('toggle-presentation-mode');
  const replayButton = document.getElementById('start-tournament-replay');
  if (replayButton) replayButton.addEventListener('click', () => playTournamentReplay());
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      state.settings.presentationMode = !state.settings.presentationMode;
      localStorage.setItem(PRESENTATION_KEY, String(state.settings.presentationMode));
      document.body.classList.toggle('presentation-mode', state.settings.presentationMode);
      toggleButton.textContent = state.settings.presentationMode ? 'Exit Presentation Mode' : 'Presentation Mode';
      toggleButton.setAttribute('aria-pressed', String(state.settings.presentationMode));
      if (state.settings.presentationMode) {
        startPresentationSequence();
      } else {
        cancelPresentationSequence();
      }
    });
    toggleButton.textContent = state.settings.presentationMode ? 'Exit Presentation Mode' : 'Presentation Mode';
    toggleButton.setAttribute('aria-pressed', String(state.settings.presentationMode));
  }
  initializeBannerSelector();
  initializeCertificateViewer();
  initializeScrollProgress();
  document.body.classList.toggle('presentation-mode', state.settings.presentationMode);
  if (state.settings.presentationMode) startPresentationSequence();

  window.setInterval(async () => {
    try {
      const updated = await loadState();
      if (JSON.stringify(updated.matches) !== JSON.stringify(state.matches)) {
        updated.settings.presentationMode = state.settings.presentationMode;
        state = updated;
        if (!presentationSequenceRunning && !tournamentReplayRunning) renderEverything();
      }
    } catch (error) {
      console.error('Unable to refresh tournament results.', error);
    }
  }, 15000);
}

if (isAdminPage) initializeAdminPage();
else initializePublicPage();
