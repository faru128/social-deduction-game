const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?code=')) {
    fs.readFile('index.html', (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Error loading index.html');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/client.js') {
    fs.readFile('client.js', (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Error loading client.js');
      }
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(data);
    });
  }
});

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ server });
const lobbies = new Map();
const wordPairs = [
  {
    normal: 'dog',
    impostor: 'cat',
    normalImage: 'https://images.unsplash.com/photo-1561037404-61cd46aa615b',
    impostorImage: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba'
  },
  {
    normal: 'apple',
    impostor: 'orange',
    normalImage: 'https://images.unsplash.com/photo-1567306226416-28f0ef17a324',
    impostorImage: 'https://images.unsplash.com/photo-1547517023-055a254de5e0'
  },
  {
    normal: 'car',
    impostor: 'bicycle',
    normalImage: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7',
    impostorImage: 'https://images.unsplash.com/photo-1485965127657-8c6a82fed280'
  },
  {
    normal: 'tree',
    impostor: 'flower',
    normalImage: 'https://images.unsplash.com/photo-1518495973543-1e286b83f072',
    impostorImage: 'https://images.unsplash.com/photo-1503152394-8434d8a1c027'
  },
  {
    normal: 'beach',
    impostor: 'mountain',
    normalImage: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
    impostorImage: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b'
  }
];

function generateLobbyCode() {
  return Math.random().toString(36).substr(2, 5).toUpperCase();
}

wss.on('connection', (ws) => {
  let playerId;
  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
      console.log('Received message:', data);
    } catch (err) {
      console.error('Invalid message format:', message);
      return;
    }

    if (data.type === 'reconnect' && data.playerId && data.playerName) {
      // Validate and reuse existing playerId
      playerId = data.playerId;
      const lobby = [...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[1];
      if (lobby && lobby.players.find(p => p.id === playerId && p.name === data.playerName)) {
        console.log(`Reusing playerId: ${playerId} for ${data.playerName}`);
        ws.send(JSON.stringify({ type: 'connected', playerId }));
      } else {
        // Generate new playerId if invalid or not found
        playerId = Math.random().toString(36).substr(2, 8);
        console.log(`Generated new playerId: ${playerId} (invalid reconnect)`);
        ws.send(JSON.stringify({ type: 'connected', playerId }));
      }
    } else if (!playerId) {
      // Initial connection without reconnect
      playerId = Math.random().toString(36).substr(2, 8);
      console.log(`New connection with playerId: ${playerId}`);
      ws.send(JSON.stringify({ type: 'connected', playerId }));
    }

    switch (data.type) {
      case 'createLobby':
        const lobbyCode = generateLobbyCode();
        lobbies.set(lobbyCode, {
          players: [{ id: playerId, name: data.name, ws, connected: true }],
          host: playerId,
          state: 'lobby',
          clues: [],
          votes: new Map(),
          submittedClues: new Map(),
          gameData: {}
        });
        ws.send(JSON.stringify({
          type: 'lobbyCreated',
          lobbyCode,
          players: [{ id: playerId, name: data.name }]
        }));
        console.log(`Lobby created: ${lobbyCode} by ${data.name}`);
        break;
      case 'joinLobby':
        console.log(`Join attempt: code=${data.lobbyCode}, name=${data.name}, playerId=${playerId}`);
        const lobby = lobbies.get(data.lobbyCode);
        if (!lobby) {
          ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found' }));
          console.error(`Lobby not found: ${data.lobbyCode}`);
          return;
        }
        if (lobby.players.length >= 15) {
          ws.send(JSON.stringify({ type: 'error', message: 'Lobby full' }));
          console.error(`Lobby full: ${data.lobbyCode}`);
          return;
        }
        if (lobby.state !== 'lobby' && !lobby.players.find(p => p.id === playerId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
          console.error(`Game already started: ${data.lobbyCode}`);
          return;
        }
        const existingPlayer = lobby.players.find(p => p.id === playerId);
        if (existingPlayer) {
          existingPlayer.ws = ws;
          existingPlayer.connected = true;
          existingPlayer.name = data.name; // Update name in case it changed
          console.log(`Player reconnected: ${existingPlayer.name} (${playerId})`);
        } else {
          lobby.players.push({ id: playerId, name: data.name, ws, connected: true });
          console.log(`Player joined: ${data.name} (${playerId}) to ${data.lobbyCode}`);
        }
        ws.send(JSON.stringify({
          type: 'lobbyJoined',
          lobbyCode: data.lobbyCode,
          players: lobby.players.map(p => ({ id: p.id, name: p.name }))
        }));
        lobby.players.forEach(p => {
          if (p.connected) {
            p.ws.send(JSON.stringify({
              type: 'lobbyJoined',
              lobbyCode: data.lobbyCode,
              players: lobby.players.map(p2 => ({ id: p2.id, name: p2.name }))
            }));
          }
        });
        if (lobby.state !== 'lobby') {
          syncGameState(lobby, playerId);
        }
        break;
      case 'startGame':
        const lobbyStart = lobbies.get([...lobbies.entries()].find(([_, l]) => l.host === playerId)?.[0]);
        if (!lobbyStart || lobbyStart.host !== playerId) {
          console.error(`Start game failed: Not host or lobby not found for ${playerId}`);
          return;
        }
        if (lobbyStart.players.length < 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Need at least 2 players' }));
          console.error('Start game failed: Need at least 2 players');
          return;
        }
        lobbyStart.state = 'clue';
        lobbyStart.clueTime = data.clueTime || 30;
        lobbyStart.discussionTime = data.discussionTime || 60;
        lobbyStart.votingTime = data.votingTime || 30;
        const wordPair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
        const impostorIndex = Math.floor(Math.random() * lobbyStart.players.length);
        lobbyStart.players.forEach((p, i) => {
          p.word = i === impostorIndex ? wordPair.impostor : wordPair.normal;
          p.image = i === impostorIndex ? wordPair.impostorImage : wordPair.normalImage;
          p.impostor = i === impostorIndex;
          if (p.connected) {
            p.ws.send(JSON.stringify({ type: 'gameStarted', word: p.word, image: p.image }));
          }
        });
        lobbyStart.impostor = lobbyStart.players[impostorIndex];
        lobbyStart.gameData = { wordPair, impostorIndex };
        console.log(`Game started in lobby ${[...lobbies.entries()].find(([_, l]) => l.host === playerId)?.[0]}`);
        startCluePhase(lobbyStart);
        break;
      case 'submitClue':
        const lobbyClue = lobbies.get([...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[0]);
        if (lobbyClue.state !== 'clue') {
          console.error(`Submit clue failed: Not in clue phase for ${playerId}`);
          return;
        }
        if (lobbyClue.submittedClues.has(playerId)) {
          console.error(`Submit clue failed: Already submitted for ${playerId}`);
          return;
        }
        const player = lobbyClue.players.find(p => p.id === playerId);
        lobbyClue.submittedClues.set(playerId, { playerName: player.name, clue: data.clue });
        console.log(`Clue submitted by ${player.name}: ${data.clue}`);
        if (lobbyClue.submittedClues.size === lobbyClue.players.filter(p => p.connected).length) {
          endCluePhase(lobbyClue);
        }
        break;
      case 'chat':
        const lobbyChat = lobbies.get([...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[0]);
        const chatPlayer = lobbyChat.players.find(p => p.id === playerId);
        lobbyChat.players.forEach(p => {
          if (p.connected) {
            p.ws.send(JSON.stringify({
              type: 'chat',
              playerName: chatPlayer.name,
              message: data.message
            }));
          }
        });
        console.log(`Chat message by ${chatPlayer.name}: ${data.message}`);
        break;
      case 'submitVote':
        const lobbyVote = lobbies.get([...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[0]);
        if (lobbyVote.state !== 'voting') {
          console.error(`Submit vote failed: Not in voting phase for ${playerId}`);
          return;
        }
        if (!lobbyVote.players.find(p => p.id === data.vote)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid vote' }));
          console.error(`Invalid vote by ${playerId}: ${data.vote}`);
          return;
        }
        lobbyVote.votes.set(playerId, data.vote);
        console.log(`Vote submitted by ${playerId}: ${data.vote}`);
        if (lobbyVote.votes.size === lobbyVote.players.filter(p => p.connected).length) {
          endVotingPhase(lobbyVote);
        }
        break;
      case 'returnToLobby':
        const lobbyReturn = lobbies.get([...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[0]);
        lobbyReturn.state = 'lobby';
        lobbyReturn.clues = [];
        lobbyReturn.votes = new Map();
        lobbyReturn.submittedClues = new Map();
        lobbyReturn.players.forEach(p => {
          delete p.word;
          delete p.image;
          delete p.impostor;
        });
        delete lobbyReturn.impostor;
        delete lobbyReturn.gameData;
        lobbyReturn.players.forEach(p => {
          if (p.connected) {
            p.ws.send(JSON.stringify({
              type: 'lobbyJoined',
              lobbyCode: [...lobbies.entries()].find(([_, l]) => l.players.some(p2 => p2.id === p.id))?.[0],
              players: lobbyReturn.players.map(p2 => ({ id: p2.id, name: p2.name }))
            }));
          }
        });
        console.log(`Returned to lobby: ${[...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[0]}`);
        break;
      default:
        if (data.type !== 'reconnect') {
          console.error(`Unknown message type: ${data.type}`);
        }
    }
  });

  ws.on('close', () => {
    const lobby = [...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[1];
    if (lobby) {
      const player = lobby.players.find(p => p.id === playerId);
      if (player) {
        player.connected = false;
        console.log(`Player disconnected: ${player.name} (${playerId})`);
      }
      if (lobby.players.every(p => !p.connected)) {
        const code = [...lobbies.entries()].find(([_, l]) => l.players.some(p => p.id === playerId))?.[0];
        lobbies.delete(code);
        console.log(`Lobby deleted: ${code} (no connected players)`);
      } else {
        lobby.players.forEach(p => {
          if (p.connected) {
            p.ws.send(JSON.stringify({
              type: 'lobbyJoined',
              lobbyCode: [...lobbies.entries()].find(([_, l]) => l.players.some(p2 => p2.id === p.id))?.[0],
              players: lobby.players.map(p2 => ({ id: p2.id, name: p2.name }))
            }));
          }
        });
        if (lobby.state === 'clue' && lobby.submittedClues.size === lobby.players.filter(p => p.connected).length) {
          endCluePhase(lobby);
        } else if (lobby.state === 'voting' && lobby.votes.size === lobby.players.filter(p => p.connected).length) {
          endVotingPhase(lobby);
        }
      }
    }
  });
});

function syncGameState(lobby, playerId) {
  const player = lobby.players.find(p => p.id === playerId);
  if (lobby.state === 'clue') {
    player.ws.send(JSON.stringify({ type: 'gameStarted', word: player.word, image: player.image }));
    player.ws.send(JSON.stringify({ type: 'clueTimerUpdate', timeLeft: lobby.clueTime }));
  } else if (lobby.state === 'discussion') {
    player.ws.send(JSON.stringify({ type: 'cluesSubmitted', clues: lobby.clues }));
    player.ws.send(JSON.stringify({ type: 'discussionPhase', discussionTime: lobby.discussionTime }));
    player.ws.send(JSON.stringify({ type: 'discussionTimerUpdate', timeLeft: lobby.discussionTime }));
  } else if (lobby.state === 'voting') {
    player.ws.send(JSON.stringify({ type: 'cluesSubmitted', clues: lobby.clues }));
    player.ws.send(JSON.stringify({
      type: 'votingPhase',
      players: lobby.players.map(p => ({ id: p.id, name: p.name })),
      votingTime: lobby.votingTime
    }));
    player.ws.send(JSON.stringify({ type: 'votingTimerUpdate', timeLeft: lobby.votingTime }));
  } else if (lobby.state === 'reveal') {
    const winStatus = lobby.impostor.id === lobby.gameData.votedOut ? 'impostor_caught' : 'impostor_escaped';
    player.ws.send(JSON.stringify({
      type: 'revealPhase',
      impostor: { id: lobby.impostor.id, name: lobby.impostor.name, word: lobby.impostor.word },
      players: lobby.players.map(p => ({ id: p.id, name: p.name, word: p.word })),
      votedOut: lobby.gameData.votedOut,
      winStatus
    }));
  }
}

function startCluePhase(lobby) {
  let timeLeft = lobby.clueTime;
  lobby.submittedClues = new Map();
  const timerInterval = setInterval(() => {
    if (lobby.state !== 'clue') {
      clearInterval(timerInterval);
      return;
    }
    lobby.players.forEach(p => {
      if (p.connected) {
        p.ws.send(JSON.stringify({ type: 'clueTimerUpdate', timeLeft }));
      }
    });
    timeLeft--;
    if (timeLeft < 0) {
      clearInterval(timerInterval);
      endCluePhase(lobby);
    }
  }, 1000);
}

function endCluePhase(lobby) {
  lobby.players.forEach(player => {
    if (!lobby.submittedClues.has(player.id) && player.connected) {
      lobby.submittedClues.set(player.id, { playerName: player.name, clue: '[No clue submitted]' });
    }
  });
  lobby.clues = Array.from(lobby.submittedClues.values());
  lobby.players.forEach(p => {
    if (p.connected) {
      p.ws.send(JSON.stringify({
        type: 'cluesSubmitted',
        clues: lobby.clues
      }));
    }
  });
  lobby.state = 'discussion';
  lobby.players.forEach(p => {
    if (p.connected) {
      p.ws.send(JSON.stringify({ type: 'discussionPhase', discussionTime: lobby.discussionTime }));
    }
  });
  startDiscussionTimer(lobby);
}

function startDiscussionTimer(lobby) {
  let timeLeft = lobby.discussionTime;
  const timerInterval = setInterval(() => {
    if (lobby.state !== 'discussion') {
      clearInterval(timerInterval);
      return;
    }
    lobby.players.forEach(p => {
      if (p.connected) {
        p.ws.send(JSON.stringify({ type: 'discussionTimerUpdate', timeLeft }));
      }
    });
    timeLeft--;
    if (timeLeft < 0) {
      clearInterval(timerInterval);
      lobby.state = 'voting';
      lobby.players.forEach(p => {
        if (p.connected) {
          p.ws.send(JSON.stringify({
            type: 'votingPhase',
            players: lobby.players.map(p2 => ({ id: p2.id, name: p2.name })),
            votingTime: lobby.votingTime
          }));
        }
      });
      startVotingTimer(lobby);
    }
  }, 1000);
}

function startVotingTimer(lobby) {
  let timeLeft = lobby.votingTime;
  const timerInterval = setInterval(() => {
    if (lobby.state !== 'voting') {
      clearInterval(timerInterval);
      return;
    }
    lobby.players.forEach(p => {
      if (p.connected) {
        p.ws.send(JSON.stringify({ type: 'votingTimerUpdate', timeLeft }));
      }
    });
    timeLeft--;
    if (timeLeft < 0) {
      clearInterval(timerInterval);
      endVotingPhase(lobby);
    }
  }, 1000);
}

function endVotingPhase(lobby) {
  lobby.players.forEach(player => {
    if (!lobby.votes.has(player.id) && player.connected) {
      lobby.votes.set(player.id, null);
    }
  });
  const voteCounts = new Map();
  lobby.votes.forEach(vote => {
    if (vote) {
      voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
    }
  });
  const maxVotes = Math.max(...(voteCounts.size > 0 ? voteCounts.values() : [0]));
  const votedOut = maxVotes > 0 ? [...voteCounts.entries()].find(([_, count]) => count === maxVotes)?.[0] : null;
  lobby.state = 'reveal';
  lobby.gameData.votedOut = votedOut;
  const winStatus = lobby.impostor.id === votedOut ? 'impostor_caught' : 'impostor_escaped';
  lobby.players.forEach(p => {
    if (p.connected) {
      p.ws.send(JSON.stringify({
        type: 'revealPhase',
        impostor: { id: lobby.impostor.id, name: lobby.impostor.name, word: lobby.impostor.word },
        players: lobby.players.map(p2 => ({ id: p2.id, name: p2.name, word: p2.word })),
        votedOut,
        winStatus
      }));
    }
  });
  console.log(`Reveal phase in lobby ${[...lobbies.entries()].find(([_, l]) => l.state === 'reveal')?.[0]}, Win status: ${winStatus}`);
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});