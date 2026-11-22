'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const TUNNEL_FILE = path.join(__dirname, '.tunnel_url');

let activeProc = null;
let stopping = false;

function startTunnel() {
  if (stopping) return;
  try { fs.unlinkSync(TUNNEL_FILE); } catch (_) {}

  console.log('Opening public HTTPS share link via localhost.run...');

  const ssh = spawn('ssh', [
    '-T',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL',
    '-o', 'ServerAliveInterval=25',
    '-o', 'ServerAliveCountMax=3',
    '-R', `80:127.0.0.1:${PORT}`,
    'nokey@localhost.run',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  activeProc = ssh;
  let announced = false;

  function handleOutput(chunk) {
    const text = chunk.toString('utf8');
    const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/);
    if (match && !announced) {
      announced = true;
      const url = match[0];
      try { fs.writeFileSync(TUNNEL_FILE, url, 'utf8'); } catch (_) {}
      console.log('');
      console.log('==========================================================');
      console.log(`   PUBLIC SHARE LINK (Anyone, Anywhere): ${url}`);
      console.log('==========================================================');
      console.log('');
    }
  }

  ssh.stdout.on('data', handleOutput);
  ssh.stderr.on('data', handleOutput);

  ssh.on('exit', (code) => {
    try { fs.unlinkSync(TUNNEL_FILE); } catch (_) {}
    if (!stopping) {
      console.log(`Tunnel disconnected (exit ${code}). Reconnecting in 3s...`);
      setTimeout(startTunnel, 3000);
    }
  });
}

process.on('SIGINT', () => {
  stopping = true;
  try { fs.unlinkSync(TUNNEL_FILE); } catch (_) {}
  if (activeProc) activeProc.kill();
  process.exit(0);
});

startTunnel();
