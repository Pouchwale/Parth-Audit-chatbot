// Starts the assistant server and the app together, in one terminal.
//   npm run demo   sample data, no DCRS needed (sign in as demo/demo, or admin/admin)
//   npm run dev    the real server (needs the DCRS settings in server/.env)
// Keep the window open while you use the app, and press Ctrl+C to stop both.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const demo = process.argv.includes('--demo');
const SERVER = 'http://localhost:3000';
const running = [];
let stopping = false;

async function serverUp() {
  try {
    return (await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

function start(name, command) {
  const child = spawn(command, { stdio: 'inherit', shell: true });
  running.push(child);
  child.on('exit', () => {
    // Give a Ctrl+C a moment to arrive, so pressing it isn't reported as a crash.
    setTimeout(() => {
      if (stopping) return;
      console.error(`\n${name} stopped, so everything is stopping. See the messages above.`);
      stop(1);
    }, 300);
  });
}

function stop(code) {
  stopping = true;
  for (const child of running) {
    if (child.exitCode !== null) continue;
    // npm runs through a shell, so end the whole process tree.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

if (await serverUp()) {
  console.error(`Something is already running at ${SERVER}. Close the other window that runs the server, then try again.`);
  process.exit(1);
}

console.log(`Starting the assistant server${demo ? ' in demo mode' : ''}...`);
start('The server', `npm --prefix server run ${demo ? 'demo' : 'dev'}`);
for (let waited = 0; !(await serverUp()); waited += 500) {
  if (waited >= 60_000) {
    console.error('The server did not start within a minute. See the messages above.');
    stop(1);
  }
  await sleep(500);
}

console.log(`
  The server is running at ${SERVER}
  Starting the app. It opens in your browser at http://localhost:8081
${demo ? '  Sign in as demo / demo, or admin / admin to also see the Accounts view.\n' : ''}  Keep this window open while you use it. Press Ctrl+C to stop.
`);
start('The app', 'npm --prefix mobile run web');
