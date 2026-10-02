// Starts Mitra for the phones: Expo on port 8081, for Expo Go, at this computer's address on the company network.
//   npm run phones            production mode: smaller and faster on the phones, and what staff should use
//   npm run phones -- --dev   development mode: reloads when the app's code changes, and shows its errors
// Start the Mitra server too (npm run server, port 3000): the app finds it on the computer the QR code names.
// Keep this window open while people use Mitra. Press Ctrl+C to stop.
//
// THE ADDRESS IN THE QR CODE. Expo puts the address of the network card with the default route in the QR code, which
// on a computer with a cable as well as Wi-Fi (or a WSL, VirtualBox or VMware adapter) may not be the one the phones
// can reach. So this script picks the address itself: REACT_NATIVE_PACKAGER_HOSTNAME when it is set, else the Wi-Fi
// card's, else the first other private address, and says which it used and which others there are.
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8081;
const dev = process.argv.includes('--dev');
const mobile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mobile');

const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Bluetooth|TAP|Tailscale|ZeroTier|docker/i;
const WIFI = /wi-?fi|wlan|wireless|^wl/i;
const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** The computer's IPv4 addresses on real network cards, Wi-Fi first. */
function addresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.') || !isPrivate(a.address)) continue;
      found.push({ name, address: a.address, wifi: WIFI.test(name), virtual: VIRTUAL.test(name) });
    }
  }
  return found.filter((a) => !a.virtual).sort((a, b) => Number(b.wifi) - Number(a.wifi));
}

const all = addresses();
const chosen = process.env.REACT_NATIVE_PACKAGER_HOSTNAME?.trim() || all[0]?.address;
if (!chosen) {
  console.error(
    'This computer has no address on a company network: connect it to the Wi-Fi the phones use (or set REACT_NATIVE_PACKAGER_HOSTNAME to its address), then try again.',
  );
  process.exit(1);
}
const card = all.find((a) => a.address === chosen);
console.log(`
  Mitra for phones, in ${dev ? 'development' : 'production'} mode.
  Phones open exp://${chosen}:${PORT} — scan the QR code below with Expo Go (Android) or the Camera app (iPhone).
  ${process.env.REACT_NATIVE_PACKAGER_HOSTNAME ? 'Address from REACT_NATIVE_PACKAGER_HOSTNAME.' : `Address of ${card ? `the "${card.name}" network card` : 'this computer'}.`}${
    all.length > 1 ? ` Other addresses here: ${all.filter((a) => a.address !== chosen).map((a) => `${a.address} (${a.name})`).join(', ')}.` : ''
  }
  The phones must reach this computer on ports ${PORT} (the app) and 3000 (the Mitra server).
  Keep this window open while people use Mitra. Press Ctrl+C to stop.
`);

// One command line, as scripts/dev.mjs runs its parts: npx runs through a shell on Windows.
const command = `npx expo start --lan --port ${PORT}${dev ? '' : ' --no-dev --minify'}`;
const child = spawn(command, { cwd: mobile, stdio: 'inherit', shell: true, env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: chosen } });
child.on('exit', (code) => process.exit(code ?? 0));

function stop() {
  if (child.exitCode !== null) process.exit(0);
  // npx runs through a shell, so end the whole process tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
