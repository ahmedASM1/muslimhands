#!/usr/bin/env node
/**
 * Railway-safe Next.js starter: bind 0.0.0.0 and use process.env.PORT.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = process.env.PORT || '8080';
const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(
  process.execPath,
  [nextBin, 'start', '--hostname', '0.0.0.0', '--port', String(port)],
  {
    cwd: path.join(__dirname),
    stdio: 'inherit',
    env: process.env,
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
