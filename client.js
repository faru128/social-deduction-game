const ws = new WebSocket(window.location.protocol === 'https:' ? 'wss://' + window.location.host : 'ws://' + window.location.host);
let playerId = localStorage.getItem('playerId') || null;
let playerName = localStorage.getItem('playerName') || null;
let lobbyCode = null;
let isHost = false;

// Sound effects
const sounds = {
  join: new Audio('https://cdn.jsdelivr.net/gh/kenneyaudio/kenneyaudio.github.io@latest/audio/ui-click.mp3'),
  start: new Audio('https://cdn.jsdelivr.net/gh/kenneyaudio/kenneyaudio.github.io@latest/audio/positive.mp3'),
  clue: new Audio('https://cdn.jsdelivr.net/gh/kenneyaudio/kenneyaudio.github.io@latest/audio/click.mp3'),
  vote: new Audio('https://cdn.jsdelivr.net/gh/kenneyaudio/kenneyaudio.github.io@latest/audio/select.mp3'),
  win: new Audio('https://cdn.jsdelivr.net/gh/kenneyaudio/kenneyaudio.github.io@latest/audio/positive2.mp3'),
  lose: new Audio('https://cdn.jsdelivr.net/gh/kenneyaudio/kenneyaudio.github.io@latest/audio/negative.mp3')
};

ws.onopen = () => {
  console.log('WebSocket connection opened');
  // Send existing playerId and name if available
  ws.send(JSON.stringify({ type: 'reconnect', playerId, playerName }));
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  alert('Failed to connect to the game server. Please try refreshing the page or contact support.');
};

ws.onclose = () => {
  console.log('WebSocket connection closed');
  alert('Connection to the game server was lost. Please refresh the page.');
};

ws.onmessage = (event) => {
  console.log('Received WebSocket message:', event.data);
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'connected':
      playerId = data.playerId;
      localStorage.setItem('playerId', playerId);
      console.log('Connected with playerId:', playerId);
      checkUrlForLobby();
      break;
    case 'lobbyCreated':
      lobbyCode = data.lobbyCode;
      isHost = true;
      playerName = data.players[0].name;
      localStorage.setItem('playerName', playerName);
      document.getElementById('lobbyCode').innerText = `Lobby Code: ${lobbyCode}`;
      const shareUrl = `${window.location.origin}/?code=${lobbyCode}`;
      document.getElementById('shareUrlLink').innerText = shareUrl;
      document.getElementById('shareUrlLink').href = shareUrl;
      document.getElementById('shareUrl').classList.remove('hidden');
      document.getElementById('hostControls').style.display = 'block';
      updatePlayerList(data.players);
      sounds.join.play().catch(err => console.error('Sound play error:', err));
      console.log('Lobby created:', lobbyCode, 'Players:', data.players);
      break;
    case 'lobbyJoined':
      lobbyCode = data.lobbyCode;
      updatePlayerList(data.players);
      document.getElementById('lobbyCode').innerText = `Lobby Code: ${lobbyCode}`;
      const shareUrlJoin = `${window.location.origin}/?code=${lobbyCode}`;
      document.getElementById('shareUrlLink').innerText = shareUrlJoin;
      document.getElementById('shareUrlLink').href = shareUrlJoin;
      document.getElementById('shareUrl').classList.remove('hidden');
      history.pushState({}, '', `/?code=${lobbyCode}`);
      sounds.join.play().catch(err => console.error('Sound play error:', err));
      console.log('Joined lobby:', lobbyCode, 'Players:', data.players);
      break;
    case 'error':
      console.error('Server error:', data.message);
      alert(data.message);
      break;
    case 'gameStarted':
      document.getElementById('lobbyArea').style.display = 'none';
      document.getElementById('gameArea').style.display = 'block';
      document.getElementById('secretWord').innerText = data.word;
      document.getElementById('secretWordImage').src = data.image;
      document.getElementById('secretWordImage').classList.remove('hidden');
      document.getElementById('gameState').innerText = 'Clue Phase: Submit your clue';
      document.getElementById('clueArea').style.display = 'block';
      document.getElementById('clueTimer').style.display = 'block';
      sounds.start.play().catch(err => console.error('Sound play error:', err));
      console.log('Game started with word:', data.word);
      break;
    case 'clueTimerUpdate':
      document.getElementById('clueTimer').innerText = `Time left: ${data.timeLeft}s`;
      if (data.timeLeft <= 0) {
        document.getElementById('clueTimer').style.display = 'none';
        document.getElementById('clueArea').style.display = 'none';
        document.getElementById('secretWordImage').classList.add('hidden');
      }
      break;
    case 'cluesSubmitted':
      data.clues.forEach(clue => {
        document.getElementById('chatBox').innerHTML += `<p><b>${clue.playerName}</b>: ${clue.clue}</p>`;
      });
      document.getElementById('clueArea').style.display = 'none';
      document.getElementById('clueTimer').style.display = 'none';
      document.getElementById('secretWordImage').classList.add('hidden');
      console.log('Clues submitted:', data.clues);
      break;
    case 'discussionPhase':
      document.getElementById('clueArea').style.display = 'none';
      document.getElementById('discussionArea').style.display = 'block';
      document.getElementById('gameState').innerText = 'Discussion Phase';
      document.getElementById('discussionTimer').innerText = `Discussion time left: ${data.discussionTime}s`;
      console.log('Discussion phase started');
      break;
    case 'discussionTimerUpdate':
      document.getElementById('discussionTimer').innerText = `Discussion time left: ${data.timeLeft}s`;
      if (data.timeLeft <= 0) {
        document.getElementById('discussionTimer').innerText = '';
      }
      break;
    case 'votingPhase':
      document.getElementById('discussionArea').style.display = 'none';
      document.getElementById('votingArea').style.display = 'block';
      document.getElementById('gameState').innerText = 'Voting Phase';
      document.getElementById('votingTimer').style.display = 'block';
      document.getElementById('votingTimer').innerText = `Voting time left: ${data.votingTime}s`;
      const voteSelect = document.getElementById('voteSelect');
      voteSelect.innerHTML = '<option value="">Select a player</option>';
      data.players.forEach(player => {
        if (player.id !== playerId) {
          voteSelect.innerHTML += `<option value="${player.id}">${player.name}</option>`;
        }
      });
      voteSelect.disabled = false;
      console.log('Voting phase started, players:', data.players);
      break;
    case 'votingTimerUpdate':
      document.getElementById('votingTimer').innerText = `Voting time left: ${data.timeLeft}s`;
      if (data.timeLeft <= 0) {
        document.getElementById('votingTimer').style.display = 'none';
      }
      break;
    case 'revealPhase':
      document.getElementById('votingArea').style.display = 'none';
      document.getElementById('revealArea').style.display = 'block';
      document.getElementById('gameState').innerText = 'Game Over';
      let winLoseText = '';
      if (data.winStatus === 'impostor_caught') {
        if (playerId !== data.impostor.id) {
          winLoseText = '<div class="win-text">You Win!</div>';
          sounds.win.play().catch(err => console.error('Sound play error:', err));
        } else {
          winLoseText = '<div class="lose-text">You Lose!</div>';
          sounds.lose.play().catch(err => console.error('Sound play error:', err));
        }
      } else {
        if (playerId !== data.impostor.id) {
          winLoseText = '<div class="lose-text">You Lose!</div>';
          sounds.lose.play().catch(err => console.error('Sound play error:', err));
        } else {
          winLoseText = '<div class="win-text">You Win!</div>';
          sounds.win.play().catch(err => console.error('Sound play error:', err));
        }
      }
      document.getElementById('winLoseText').innerHTML = winLoseText;
      let revealText = `Impostor was ${data.impostor.name} with word "${data.impostor.word}".<br>`;
      revealText += 'Players:<br>';
      data.players.forEach(player => {
        revealText += `${player.name}: "${player.word}"<br>`;
      });
      document.getElementById('revealText').innerHTML = revealText;
      console.log('Reveal phase:', data.impostor, data.players, 'Win status:', data.winStatus);
      break;
    case 'chat':
      document.getElementById('chatBox').innerHTML += `<p><b>${data.playerName}</b>: ${data.message}</p>`;
      document.getElementById('chatBox').scrollTop = document.getElementById('chatBox').scrollHeight;
      console.log('Chat message:', data.playerName, data.message);
      break;
  }
};

function showRules() {
  document.getElementById('rulesModal').classList.add('show');
}

function hideRules() {
  document.getElementById('rulesModal').classList.remove('show');
}

function checkUrlForLobby() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code')?.trim().toUpperCase();
    if (code) {
      console.log('Found lobby code in URL:', code);
      document.getElementById('lobbyCodeInput').value = code;
      // Wait for WebSocket to be open before attempting to join
      const waitForWebSocket = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          clearInterval(waitForWebSocket);
          const name = playerName || document.getElementById('joinPlayerName').value.trim();
          if (name && playerId) {
            console.log('Auto-joining lobby with name:', name, 'code:', code, 'playerId:', playerId);
            joinLobby(name, code);
          } else {
            console.log('Waiting for player name or playerId to auto-join lobby:', code);
            if (playerName) {
              document.getElementById('joinPlayerName').value = playerName;
            }
          }
        }
      }, 100);
    } else {
      console.log('No lobby code found in URL');
    }
  } catch (err) {
    console.error('Error parsing URL for lobby code:', err);
  }
}

function copyUrl() {
  const shareUrl = document.getElementById('shareUrlLink').href;
  navigator.clipboard.writeText(shareUrl).then(() => {
    alert('Lobby URL copied to clipboard!');
    console.log('Copied share URL:', shareUrl);
  }).catch(err => {
    alert('Failed to copy URL: ' + err);
    console.error('Failed to copy URL:', err);
  });
}

function createLobby() {
  const name = document.getElementById('createPlayerName').value.trim();
  if (!name) {
    alert('Please enter a name');
    console.error('Create lobby failed: No name provided');
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot create lobby: No connection to the game server. Please refresh the page.');
    console.error('Create lobby failed: WebSocket not open');
    return;
  }
  const payload = { type: 'createLobby', name, playerId };
  console.log('Sending createLobby:', payload);
  ws.send(JSON.stringify(payload));
  document.getElementById('createPlayerName').value = '';
}

function joinLobby(providedName, providedCode) {
  const name = providedName || document.getElementById('joinPlayerName').value.trim();
  const code = providedCode || document.getElementById('lobbyCodeInput').value.trim().toUpperCase() || new URLSearchParams(window.location.search).get('code')?.trim().toUpperCase();
  if (!name || !code) {
    alert('Please enter a name and lobby code');
    console.error('Join lobby failed: Missing name or code', { name, code });
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot join lobby: No connection to the game server. Please refresh the page.');
    console.error('Join lobby failed: WebSocket not open');
    return;
  }
  const payload = { type: 'joinLobby', name, lobbyCode: code, playerId };
  console.log('Sending joinLobby:', payload);
  ws.send(JSON.stringify(payload));
  localStorage.setItem('playerName', name);
  document.getElementById('joinPlayerName').value = '';
  document.getElementById('lobbyCodeInput').value = '';
}

function startGame() {
  const clueTime = parseInt(document.getElementById('clueTime').value);
  const discussionTime = parseInt(document.getElementById('discussionTime').value);
  const votingTime = parseInt(document.getElementById('votingTime').value);
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot start game: No connection to the game server. Please refresh the page.');
    console.error('Start game failed: WebSocket not open');
    return;
  }
  const payload = { type: 'startGame', clueTime, discussionTime, votingTime };
  console.log('Sending startGame:', payload);
  ws.send(JSON.stringify(payload));
}

function submitClue() {
  const clue = document.getElementById('clueInput').value.trim();
  if (!clue) {
    alert('Please enter a clue');
    console.error('Submit clue failed: No clue provided');
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot submit clue: No connection to the game server. Please refresh the page.');
    console.error('Submit clue failed: WebSocket not open');
    return;
  }
  const payload = { type: 'submitClue', clue };
  console.log('Sending submitClue:', payload);
  ws.send(JSON.stringify(payload));
  sounds.clue.play().catch(err => console.error('Sound play error:', err));
  document.getElementById('clueInput').value = '';
  document.getElementById('clueArea').style.display = 'none';
  document.getElementById('secretWordImage').classList.add('hidden');
}

function sendChat() {
  const message = document.getElementById('chatInput').value.trim();
  if (!message) {
    console.log('Send chat skipped: Empty message');
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot send message: No connection to the game server. Please refresh the page.');
    console.error('Send chat failed: WebSocket not open');
    return;
  }
  const payload = { type: 'chat', message };
  console.log('Sending chat:', payload);
  ws.send(JSON.stringify(payload));
  document.getElementById('chatInput').value = '';
}

function submitVote() {
  const voteSelect = document.getElementById('voteSelect');
  const vote = voteSelect.value;
  if (!vote) {
    alert('Please select a player to vote');
    console.error('Submit vote failed: No player selected');
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot submit vote: No connection to the game server. Please refresh the page.');
    console.error('Submit vote failed: WebSocket not open');
    return;
  }
  const payload = { type: 'submitVote', vote };
  console.log('Sending submitVote:', payload);
  ws.send(JSON.stringify(payload));
  sounds.vote.play().catch(err => console.error('Sound play error:', err));
  voteSelect.disabled = true;
}

function returnToLobby() {
  if (ws.readyState !== WebSocket.OPEN) {
    alert('Cannot return to lobby: No connection to the game server. Please refresh the page.');
    console.error('Return to lobby failed: WebSocket not open');
    return;
  }
  const payload = { type: 'returnToLobby' };
  console.log('Sending returnToLobby:', payload);
  ws.send(JSON.stringify(payload));
  document.getElementById('gameArea').style.display = 'none';
  document.getElementById('lobbyArea').style.display = 'block';
  document.getElementById('revealArea').style.display = 'none';
}

function updatePlayerList(players) {
  document.getElementById('playerList').innerText = `Players: ${players.map(p => p.name).join(', ')}`;
  console.log('Updated player list:', players);
}