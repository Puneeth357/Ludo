'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const INDEX_PATH = path.join(__dirname, 'index.html');
const TUNNEL_FILE = path.join(__dirname, '.tunnel_url');

const DEFAULT_SEAT_ORDER = {
  2: [2, 0],          // Default opposite seats: Green & Blue
  3: [2, 3, 0],       // Green -> Yellow -> Blue
  4: [2, 3, 0, 1],    // Green -> Yellow -> Blue -> Red
};

const START_TRACK = [0, 13, 26, 39];
const SAFE_TRACK = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_VALID_D6 = Math.floor(0x100000000 / 6) * 6; // 4294967292 (zero modulo bias)

const COLOR_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];

// In-memory active rooms: code -> room object
const rooms = new Map();

function sampleUnbiasedD6(rngStats) {
  while (true) {
    const v = crypto.randomBytes(4).readUInt32BE(0);
    if (v < MAX_VALID_D6) {
      return (v % 6) + 1;
    }
    if (rngStats) rngStats.rejections++;
  }
}

function generateTeamCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function getPublicTunnelUrl(req) {
  const envUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (req && req.headers) {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const rawProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
    if (rawHost && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(rawHost)) {
      return `${rawProto}://${rawHost}`.replace(/\/+$/, '');
    }
  }
  try {
    if (fs.existsSync(TUNNEL_FILE)) {
      const txt = fs.readFileSync(TUNNEL_FILE, 'utf8').trim();
      if (/^https?:\/\//i.test(txt)) return txt.replace(/\/+$/, '');
    }
  } catch (_) {}
  return null;
}

function getLanIPv4Addresses() {
  const ifaces = os.networkInterfaces();
  const preferred = [];
  const secondary = [];

  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    const low = name.toLowerCase();
    const isVirtual = /vethernet|wsl|docker|vmware|virtualbox|loopback|tailscale|hyper-v/.test(low);
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        if (!isVirtual && (/wi-fi|wifi|wlan|ethernet/.test(low) || info.address.startsWith('192.168.'))) {
          preferred.push(info.address);
        } else if (!isVirtual) {
          secondary.push(info.address);
        }
      }
    }
  }
  return [...new Set([...preferred, ...secondary])];
}

function createEmptyRngStats() {
  return {
    total: 0,
    counts: [0, 0, 0, 0, 0, 0],
    byPlayer: [
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    rejections: 0,
  };
}

function pickAvailableSeat(room, preferredSeat) {
  const taken = new Set(room.members.map((m) => m.seatId));
  const pref = Number(preferredSeat);
  if (Number.isInteger(pref) && pref >= 0 && pref <= 3 && !taken.has(pref)) {
    return pref;
  }
  // If 2-player game and Captain has picked a seat, prefer diagonally opposite seat first
  if (room.targetCount === 2 && room.members.length === 1) {
    const opp = (room.members[0].seatId + 2) % 4;
    if (!taken.has(opp)) return opp;
  }
  const order = DEFAULT_SEAT_ORDER[room.targetCount] || [2, 3, 0, 1];
  for (const s of order) {
    if (!taken.has(s)) return s;
  }
  for (let s = 0; s < 4; s++) {
    if (!taken.has(s)) return s;
  }
  return -1;
}

function initMatchState(room) {
  // Preserve exact clockwise turn order across the colors actually chosen by the players
  const chosenSet = new Set(room.members.map((m) => m.seatId));
  const activeSeats = [0, 1, 2, 3].filter((s) => chosenSet.has(s));

  const tokens = [
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
  ];

  // Unbiased CSPRNG selection of starting seat (zero 1st-turn favoritism)
  const firstSeat = activeSeats[crypto.randomInt(0, activeSeats.length)];
  room.started = true;
  room.match = {
    matchId: (room.match ? room.match.matchId : 0) + 1,
    activeSeats,
    currentPlayer: firstSeat,
    phase: 'AWAITING_ROLL', // 'AWAITING_ROLL' | 'CHOOSING_TOKEN' | 'GAME_OVER'
    lastRoll: 1,
    consecutiveSixes: 0,
    legalTokens: [],
    tokens,
    captures: [0, 0, 0, 0],
    winner: null,
    rngStats: createEmptyRngStats(),
  };
}

function serializeRoom(room) {
  return {
    code: room.code,
    targetCount: room.targetCount,
    captainClientId: room.captainClientId,
    members: room.members,
    started: room.started,
    createdAt: room.createdAt,
    match: room.match || null,
  };
}

function broadcastSSE(room, eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of room.clients) {
    try {
      res.write(data);
    } catch (_) {
      room.clients.delete(res);
    }
  }
}

function getLegalMoves(tokens, roll) {
  const legal = [];
  for (let t = 0; t < 4; t++) {
    const s = tokens[t];
    if (s === -1) {
      if (roll === 6) legal.push(t);
    } else if (s >= 0 && s < 56) {
      if (s + roll <= 56) legal.push(t);
    }
  }
  return legal;
}

function stepToTrackIndex(seatId, step) {
  if (step < 0 || step > 50) return -1;
  return (START_TRACK[seatId] + step) % 52;
}

function advanceTurn(match) {
  match.consecutiveSixes = 0;
  const idx = match.activeSeats.indexOf(match.currentPlayer);
  match.currentPlayer = match.activeSeats[(idx + 1) % match.activeSeats.length];
  match.phase = 'AWAITING_ROLL';
  match.legalTokens = [];
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 65536) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Periodic keepalive & stale room cleanup
setInterval(() => {
  const cutoff = Date.now() - 8 * 3600 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (room.clients.size === 0 && room.createdAt < cutoff) {
      rooms.delete(code);
      continue;
    }
    for (const res of room.clients) {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        room.clients.delete(res);
      }
    }
  }
}, 15000);

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // Serve index.html
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(INDEX_PATH, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load index.html');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(content);
    });
    return;
  }

  // Serve realistic fighter PNG assets (/assets/king1.png, /assets/king2.png)
  if (req.method === 'GET' && /^\/assets\/[a-zA-Z0-9_-]+\.png$/.test(pathname)) {
    const assetPath = path.join(__dirname, pathname.slice(1));
    fs.readFile(assetPath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Asset not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(content);
    });
    return;
  }

  // Server info (Public Tunnel URL + LAN URLs)
  if (req.method === 'GET' && pathname === '/api/info') {
    const ips = getLanIPv4Addresses();
    const lanUrls = ips.map((ip) => `http://${ip}:${PORT}`);
    const publicUrl = getPublicTunnelUrl(req);
    sendJson(res, 200, {
      ok: true,
      mode: 'multi-device-server',
      port: PORT,
      publicUrl,
      lanUrls,
      localUrl: `http://localhost:${PORT}`,
    });
    return;
  }

  // Create Team Room (Captain picks 2-4 players, preferred color & name -> generates Team Code)
  if (req.method === 'POST' && pathname === '/api/rooms') {
    try {
      const body = await readJsonBody(req);
      const targetCount = Math.min(4, Math.max(2, Number(body.targetCount) || 2));
      const clientId = String(body.clientId || '').trim();
      if (!clientId) return sendJson(res, 400, { ok: false, error: 'Missing clientId' });

      const prefSeat = Number.isInteger(Number(body.seatId)) && Number(body.seatId) >= 0 && Number(body.seatId) <= 3
        ? Number(body.seatId)
        : 2; // default Green
      const captainName = String(body.captainName || '').trim().slice(0, 18) || `Captain (${COLOR_NAMES[prefSeat]})`;
      const code = generateTeamCode();

      const room = {
        code,
        targetCount,
        captainClientId: clientId,
        members: [
          { seatId: prefSeat, name: captainName, isCaptain: true, clientId },
        ],
        started: false,
        createdAt: Date.now(),
        match: null,
        clients: new Set(),
      };
      rooms.set(code, room);
      sendJson(res, 201, { ok: true, room: serializeRoom(room) });
    } catch (_) {
      sendJson(res, 400, { ok: false, error: 'Invalid request body' });
    }
    return;
  }

  // Room-scoped routes: /api/rooms/:code/...
  const matchRoute = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)(?:\/([a-z]+))?$/);
  if (matchRoute) {
    const code = normalizeCode(matchRoute[1]);
    const action = matchRoute[2] || '';
    const room = rooms.get(code);

    if (!room) {
      return sendJson(res, 404, { ok: false, error: `Team Code "${code}" not found. Check the code and try again.` });
    }

    // GET /api/rooms/:code — fetch room snapshot (taken colors, members, count)
    if (req.method === 'GET' && action === '') {
      return sendJson(res, 200, { ok: true, room: serializeRoom(room) });
    }

    // GET /api/rooms/:code/events — SSE stream
    if (req.method === 'GET' && action === 'events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      res.write(`event: SYNC\ndata: ${JSON.stringify({ room: serializeRoom(room) })}\n\n`);
      room.clients.add(res);
      req.on('close', () => {
        room.clients.delete(res);
      });
      return;
    }

    // POST /api/rooms/:code/join — join with exact Team Code + chosen Color & Name
    if (req.method === 'POST' && action === 'join') {
      try {
        const body = await readJsonBody(req);
        const clientId = String(body.clientId || '').trim();
        if (!clientId) return sendJson(res, 400, { ok: false, error: 'Missing clientId' });
        if (room.started) return sendJson(res, 409, { ok: false, error: `Room "${code}" has already started.` });
        if (room.members.length >= room.targetCount) {
          return sendJson(res, 409, { ok: false, error: `Room "${code}" is already full (${room.targetCount}/${room.targetCount}).` });
        }

        const taken = new Set(room.members.map((m) => m.seatId));
        if (body.seatId !== undefined && body.seatId !== null && body.seatId !== '') {
          const reqSeat = Number(body.seatId);
          if (Number.isInteger(reqSeat) && reqSeat >= 0 && reqSeat <= 3 && taken.has(reqSeat)) {
            return sendJson(res, 409, { ok: false, error: `${COLOR_NAMES[reqSeat]} is already taken! Pick another color.` });
          }
        }

        const seatId = pickAvailableSeat(room, body.seatId);
        if (seatId < 0) return sendJson(res, 409, { ok: false, error: 'No seats available.' });

        const cleanName = String(body.playerName || '').trim().slice(0, 18) || `Player ${room.members.length + 1}`;
        const member = { seatId, name: cleanName, isCaptain: false, clientId };
        room.members.push(member);
        const serialized = serializeRoom(room);
        broadcastSSE(room, 'ROOM_UPDATE', { room: serialized, joinedMember: member });
        return sendJson(res, 200, { ok: true, room: serialized, member });
      } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    }

    // POST /api/rooms/:code/update — change Color or Name before game starts!
    if (req.method === 'POST' && action === 'update') {
      try {
        const body = await readJsonBody(req);
        if (room.started) return sendJson(res, 409, { ok: false, error: 'Cannot change color after game starts.' });
        const clientId = String(body.clientId || '').trim();
        const currentSeatId = body.currentSeatId !== undefined ? Number(body.currentSeatId) : null;

        // Locate member owned by this clientId
        const member = room.members.find((m) =>
          m.clientId === clientId && (currentSeatId === null || m.seatId === currentSeatId)
        );
        if (!member) return sendJson(res, 403, { ok: false, error: 'Member not found for this device.' });

        if (body.seatId !== undefined && body.seatId !== null) {
          const newSeat = Number(body.seatId);
          if (!Number.isInteger(newSeat) || newSeat < 0 || newSeat > 3) {
            return sendJson(res, 400, { ok: false, error: 'Invalid color choice.' });
          }
          const conflict = room.members.find((m) => m !== member && m.seatId === newSeat);
          if (conflict) {
            return sendJson(res, 409, { ok: false, error: `${COLOR_NAMES[newSeat]} is already taken by ${conflict.name}!` });
          }
          member.seatId = newSeat;
        }

        if (typeof body.name === 'string') {
          const clean = body.name.trim().slice(0, 18);
          if (clean) member.name = clean;
        }

        const serialized = serializeRoom(room);
        broadcastSSE(room, 'ROOM_UPDATE', { room: serialized });
        return sendJson(res, 200, { ok: true, room: serialized, member });
      } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    }

    // POST /api/rooms/:code/start — Captain starts once joined === targetCount
    if (req.method === 'POST' && action === 'start') {
      try {
        const body = await readJsonBody(req);
        if (body.clientId !== room.captainClientId) {
          return sendJson(res, 403, { ok: false, error: 'Only the Team Captain can start the game.' });
        }
        if (room.members.length !== room.targetCount) {
          return sendJson(res, 409, {
            ok: false,
            error: `Waiting for all members (${room.members.length}/${room.targetCount}).`,
          });
        }
        initMatchState(room);
        const serialized = serializeRoom(room);
        broadcastSSE(room, 'START_MATCH', { room: serialized });
        return sendJson(res, 200, { ok: true, room: serialized });
      } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    }

    // POST /api/rooms/:code/roll — Authoritative Fair CSPRNG Roll
    if (req.method === 'POST' && action === 'roll') {
      try {
        const body = await readJsonBody(req);
        const m = room.match;
        if (!room.started || !m || m.phase !== 'AWAITING_ROLL') {
          return sendJson(res, 409, { ok: false, error: 'Not ready for roll' });
        }
        const pIdx = m.currentPlayer;
        const member = room.members.find((mb) => mb.seatId === pIdx);
        if (!member || member.clientId !== body.clientId) {
          return sendJson(res, 403, { ok: false, error: 'It is not your turn.' });
        }

        const face = sampleUnbiasedD6(m.rngStats);
        m.rngStats.total++;
        m.rngStats.counts[face - 1]++;
        m.rngStats.byPlayer[pIdx][face - 1]++;
        m.lastRoll = face;

        let outcome = 'CHOOSE';
        if (face === 6) {
          m.consecutiveSixes++;
          if (m.consecutiveSixes >= 3) {
            outcome = 'FORFEIT_THREE_SIXES';
            advanceTurn(m);
          }
        }

        if (outcome === 'CHOOSE') {
          const legal = getLegalMoves(m.tokens[pIdx], face);
          m.legalTokens = legal;
          if (legal.length === 0) {
            outcome = 'NO_MOVES';
            advanceTurn(m);
          } else {
            m.phase = 'CHOOSING_TOKEN';
          }
        }

        const payload = {
          pIdx,
          face,
          outcome,
          legalTokens: outcome === 'CHOOSE' ? m.legalTokens : [],
          rngStats: m.rngStats,
          nextCurrentPlayer: m.currentPlayer,
          nextPhase: m.phase,
          consecutiveSixes: m.consecutiveSixes,
        };
        broadcastSSE(room, 'GAME_ROLL', payload);
        return sendJson(res, 200, { ok: true, ...payload });
      } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    }

    // POST /api/rooms/:code/move — Authoritative Token Move + Extra Dice on Six / Kill / Home
    if (req.method === 'POST' && action === 'move') {
      try {
        const body = await readJsonBody(req);
        const m = room.match;
        if (!room.started || !m || m.phase !== 'CHOOSING_TOKEN') {
          return sendJson(res, 409, { ok: false, error: 'No token choice pending' });
        }
        const pIdx = m.currentPlayer;
        const member = room.members.find((mb) => mb.seatId === pIdx);
        if (!member || member.clientId !== body.clientId) {
          return sendJson(res, 403, { ok: false, error: 'It is not your turn.' });
        }

        const tokenIdx = Number(body.tokenIdx);
        if (!m.legalTokens.includes(tokenIdx)) {
          return sendJson(res, 400, { ok: false, error: 'Illegal token move' });
        }

        const roll = m.lastRoll;
        const curStep = m.tokens[pIdx][tokenIdx];
        const nextStep = curStep === -1 ? 0 : curStep + roll;
        m.tokens[pIdx][tokenIdx] = nextStep;

        let reachedHome = false;
        const captured = [];

        if (nextStep === 56) {
          reachedHome = true;
        } else if (nextStep >= 0 && nextStep <= 50) {
          const targetTrack = stepToTrackIndex(pIdx, nextStep);
          if (!SAFE_TRACK.has(targetTrack)) {
            for (const otherSeat of m.activeSeats) {
              if (otherSeat === pIdx) continue;
              for (let t = 0; t < 4; t++) {
                const os = m.tokens[otherSeat][t];
                if (os >= 0 && os <= 50 && stepToTrackIndex(otherSeat, os) === targetTrack) {
                  m.tokens[otherSeat][t] = -1;
                  captured.push({ p: otherSeat, t });
                }
              }
            }
            if (captured.length > 0) {
              m.captures[pIdx] += captured.length;
            }
          }
        }

        let winner = null;
        if (reachedHome && m.tokens[pIdx].every((s) => s === 56)) {
          winner = pIdx;
          m.winner = pIdx;
          m.phase = 'GAME_OVER';
          m.legalTokens = [];
        } else {
          // Extra dice roll on: SIX, KILL (capture), or ENTER TO HOME
          const extraDiceRoll = (roll === 6) || (captured.length > 0) || reachedHome;
          if (extraDiceRoll) {
            if (roll !== 6) m.consecutiveSixes = 0;
            m.phase = 'AWAITING_ROLL';
            m.legalTokens = [];
          } else {
            advanceTurn(m);
          }
        }

        const payload = {
          pIdx,
          tokenIdx,
          roll,
          fromStep: curStep,
          toStep: nextStep,
          captured,
          reachedHome,
          winner,
          nextCurrentPlayer: m.currentPlayer,
          nextPhase: m.phase,
          consecutiveSixes: m.consecutiveSixes,
          tokens: m.tokens,
          captures: m.captures,
        };
        broadcastSSE(room, 'GAME_MOVE', payload);
        return sendJson(res, 200, { ok: true, ...payload });
      } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    }

    // POST /api/rooms/:code/rematch — Restart match with same team
    if (req.method === 'POST' && action === 'rematch') {
      try {
        await readJsonBody(req);
        if (room.members.length !== room.targetCount) {
          return sendJson(res, 409, { ok: false, error: 'Team incomplete' });
        }
        initMatchState(room);
        const serialized = serializeRoom(room);
        broadcastSSE(room, 'GAME_REMATCH', { room: serialized });
        return sendJson(res, 200, { ok: true, room: serialized });
      } catch (_) {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIPv4Addresses();
  const pub = getPublicTunnelUrl(null);
  console.log('');
  console.log('==========================================================');
  console.log('   LUDO ROYAL — Multi-Device Server Running               ');
  console.log('==========================================================');
  console.log(`   On this laptop:   http://localhost:${PORT}`);
  if (ips.length > 0) {
    ips.forEach((ip) => {
      console.log(`   Same Wi-Fi:       http://${ip}:${PORT}`);
    });
  }
  if (pub) {
    console.log(`   Public Internet:  ${pub}`);
  }
  console.log('==========================================================');
  console.log('   Press Ctrl+C to stop the server.');
  console.log('');
});
