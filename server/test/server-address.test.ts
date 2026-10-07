// How the phone app finds the Mitra server (mobile/src/lib/server-address.ts). The app has no test runner of its own,
// and these are plain functions, so they are checked here with the server's tests.
import { expect, it } from 'vitest';

// Loaded by a path the server's typecheck does not follow: the app's files are the app's typecheck's (npm run
// typecheck checks both), and to the server's settings a file of the app's is CommonJS.
interface AddressModule {
  SERVER_PORT: number;
  hostOf(address: string | null | undefined): string | null;
  normalizeAddress(input: string | null | undefined): string | null;
  shortAddress(address: string): string;
  asksForServer(place: { platform: string; inExpoGo: boolean; webAsks?: string | null }): boolean;
  serverAddress(sources: {
    asks?: boolean;
    saved?: string | null;
    configured?: string | null;
    page?: { protocol: string; hostname: string } | null;
    expoAddresses?: readonly (string | null | undefined)[];
  }): string | null;
  unreachableMessage(server: string | null, device: 'phone' | 'computer', asks?: boolean): string;
  addressProblem(problem: 'invalid' | 'unreachable' | 'notMitra', address?: string): string;
}
const APP_MODULE: string = new URL('../../mobile/src/lib/server-address.ts', import.meta.url).href;
const { addressProblem, asksForServer, hostOf, normalizeAddress, SERVER_PORT, serverAddress, shortAddress, unreachableMessage } =
  (await import(APP_MODULE)) as AddressModule;

it('reads the computer from every address Expo Go gives the app', () => {
  expect(hostOf('192.168.0.107:8081')).toBe('192.168.0.107');
  expect(hostOf('192.168.0.107')).toBe('192.168.0.107');
  expect(hostOf(' exp://192.168.0.107:8081/--/ ')).toBe('192.168.0.107');
  expect(hostOf('http://mitra-server.local:8081/index.bundle?platform=android')).toBe('mitra-server.local');
  expect(hostOf('[fe80::1]:8081')).toBe('[fe80::1]');
  expect(hostOf('fe80::1')).toBe('[fe80::1]');
  for (const nothing of [null, undefined, '', '   ', 'mitra://', 'exp://']) expect(hostOf(nothing), String(nothing)).toBeNull();
});

it('finds the server on port 3000 of the computer that runs Expo, unless the app was told otherwise', () => {
  expect(SERVER_PORT).toBe(3000);
  // Expo Go: the manifest's hostUri first, then the other places Expo Go keeps the same address.
  expect(serverAddress({ expoAddresses: ['192.168.0.107:8081', '10.0.0.5:8081'] })).toBe('http://192.168.0.107:3000');
  expect(serverAddress({ expoAddresses: [undefined, null, 'exp://192.168.0.107:8081/--/'] })).toBe('http://192.168.0.107:3000');
  // A browser: the page's own computer.
  expect(serverAddress({ page: { protocol: 'http:', hostname: 'localhost' }, expoAddresses: ['192.168.0.107:8081'] })).toBe('http://localhost:3000');
  // EXPO_PUBLIC_API_URL wins, with or without its scheme, without a trailing slash.
  expect(serverAddress({ configured: ' https://mitra.example.com/ ', expoAddresses: ['192.168.0.107:8081'] })).toBe('https://mitra.example.com');
  expect(serverAddress({ configured: '192.168.0.20:3000' })).toBe('http://192.168.0.20:3000');
  // Just the computer: the Mitra server's port.
  expect(serverAddress({ configured: '192.168.0.20' })).toBe('http://192.168.0.20:3000');
  expect(serverAddress({ configured: '   ', expoAddresses: ['192.168.0.107:8081'] })).toBe('http://192.168.0.107:3000');
  // Something that isn't an address is passed over, rather than called.
  expect(serverAddress({ configured: 'not an address', expoAddresses: ['192.168.0.107:8081'] })).toBe('http://192.168.0.107:3000');
  // Nothing says where it is: no guess at "localhost", which on a phone is the phone.
  expect(serverAddress({})).toBeNull();
  expect(serverAddress({ expoAddresses: [undefined, 'mitra://'] })).toBeNull();
  // An address saved by an installed app means nothing in Expo Go or a browser: the link and the page are right there.
  expect(serverAddress({ saved: '10.1.1.1', expoAddresses: ['192.168.0.107:8081'] })).toBe('http://192.168.0.107:3000');
});

it('asks for the address only in the installed app: Expo Go and the web build find it themselves', () => {
  expect(asksForServer({ platform: 'android', inExpoGo: false })).toBe(true);
  expect(asksForServer({ platform: 'ios', inExpoGo: false })).toBe(true);
  expect(asksForServer({ platform: 'android', inExpoGo: true })).toBe(false);
  expect(asksForServer({ platform: 'ios', inExpoGo: true })).toBe(false);
  expect(asksForServer({ platform: 'web', inExpoGo: false })).toBe(false);
  expect(asksForServer({ platform: 'web', inExpoGo: false, webAsks: '' })).toBe(false);
  expect(asksForServer({ platform: 'web', inExpoGo: false, webAsks: '0' })).toBe(false);
  // A web build bundled with EXPO_PUBLIC_ASK_FOR_SERVER=1 asks as the installed app does, to test that screen.
  expect(asksForServer({ platform: 'web', inExpoGo: false, webAsks: '1' })).toBe(true);
});

it('the installed app uses the address saved on the phone, else the build default, and nothing else', () => {
  // Nothing saved and no default: null, so the sign-in screen asks.
  expect(serverAddress({ asks: true })).toBeNull();
  expect(serverAddress({ asks: true, configured: '' })).toBeNull();
  // An installed app has no Expo Go link and no page, and never guesses from them.
  expect(serverAddress({ asks: true, page: { protocol: 'http:', hostname: 'localhost' }, expoAddresses: ['192.168.0.107:8081'] })).toBeNull();
  // The build's default (EXPO_PUBLIC_API_URL from eas.json) when nothing is saved...
  expect(serverAddress({ asks: true, configured: '192.168.62.195' })).toBe('http://192.168.62.195:3000');
  // ...and the saved address wins over it.
  expect(serverAddress({ asks: true, saved: 'http://10.192.193.24:3000', configured: '192.168.62.195' })).toBe('http://10.192.193.24:3000');
  expect(serverAddress({ asks: true, saved: '10.192.193.24' })).toBe('http://10.192.193.24:3000');
  // A saved value that is no address (an older app's, say) is passed over.
  expect(serverAddress({ asks: true, saved: 'nonsense here', configured: '192.168.62.195' })).toBe('http://192.168.62.195:3000');
});

it('takes the address the way people type it', () => {
  // Just the computer: port 3000.
  expect(normalizeAddress('192.168.62.195')).toBe('http://192.168.62.195:3000');
  expect(normalizeAddress('  192.168.62.195  ')).toBe('http://192.168.62.195:3000');
  expect(normalizeAddress('192.168.62.195/')).toBe('http://192.168.62.195:3000');
  expect(normalizeAddress('Mitra-Server.local')).toBe('http://mitra-server.local:3000');
  expect(normalizeAddress('localhost')).toBe('http://localhost:3000');
  // A port given is kept.
  expect(normalizeAddress('192.168.62.195:3001')).toBe('http://192.168.62.195:3001');
  // A full address is taken as written, without the slash at the end.
  expect(normalizeAddress('http://192.168.62.195:3000/')).toBe('http://192.168.62.195:3000');
  expect(normalizeAddress('HTTP://192.168.62.195:3000')).toBe('http://192.168.62.195:3000');
  expect(normalizeAddress('https://mitra.example.com')).toBe('https://mitra.example.com');
  expect(normalizeAddress('http://192.168.62.195')).toBe('http://192.168.62.195');
  expect(normalizeAddress('https://example.com/mitra/')).toBe('https://example.com/mitra');
  // IPv6.
  expect(normalizeAddress('[fe80::1]')).toBe('http://[fe80::1]:3000');
  expect(normalizeAddress('[fe80::1]:3001')).toBe('http://[fe80::1]:3001');
  expect(normalizeAddress('fe80::1')).toBe('http://[fe80::1]:3000');
  // Not addresses: nothing, words, typos in the numbers, other kinds of link, a port that can't be.
  for (const wrong of [
    null,
    undefined,
    '',
    '   ',
    'my server',
    '192.168.62',
    '192.168.62.1955',
    '192.168.62.256',
    '192,168,62,195',
    '192.168.62.195:',
    '192.168.62.195:0',
    '192.168.62.195:70000',
    '192.168.62.195:30a',
    'exp://192.168.62.195:8081',
    'ftp://192.168.62.195',
    'http://',
    'http://user@192.168.62.195',
    'http://192.168.62.195:3000/?x=1',
    '-server',
    '[fe80::1',
    '[fe80::1]x',
  ]) {
    expect(normalizeAddress(wrong), String(wrong)).toBeNull();
  }
});

it('shows an address the way it was typed when it is the usual one', () => {
  expect(shortAddress('http://192.168.62.195:3000')).toBe('192.168.62.195');
  expect(shortAddress('http://192.168.62.195:3001')).toBe('http://192.168.62.195:3001');
  expect(shortAddress('https://mitra.example.com')).toBe('https://mitra.example.com');
  expect(shortAddress('http://[fe80::1]:3000')).toBe('[fe80::1]');
  // What it shows, typed back in, is the same address.
  for (const address of ['http://192.168.62.195:3000', 'http://192.168.62.195:3001', 'https://mitra.example.com', 'http://[fe80::1]:3000']) {
    expect(normalizeAddress(shortAddress(address)), address).toBe(address);
  }
});

it("says what to do, in order, when the server can't be reached", () => {
  const phone = unreachableMessage('http://192.168.0.107:3000', 'phone');
  expect(phone).toContain('http://192.168.0.107:3000');
  expect(phone).toMatch(/Try again in a moment\..*this phone is on the company Wi-Fi.*ask your administrator/);
  expect(phone).not.toContain('Change server');
  expect(unreachableMessage('http://localhost:3000', 'computer')).toContain('this computer is on the company Wi-Fi');
  expect(unreachableMessage(null, 'phone')).toMatch(/can't tell where its server is.*QR code.*administrator/);
  // The installed app: no QR code to open it from, and the address can be changed.
  const installed = unreachableMessage('http://192.168.0.107:3000', 'phone', true);
  expect(installed).toMatch(/Try again in a moment\..*this phone is on the company Wi-Fi.*administrator.*address has changed.*Change server/);
  expect(unreachableMessage(null, 'phone', true)).toMatch(/Enter the Mitra server's address on the sign-in screen/);
  expect(unreachableMessage(null, 'phone', true)).not.toContain('QR code');
});

it('says why an address typed in can not be used', () => {
  expect(addressProblem('invalid')).toMatch(/like 192\.168\.1\.20.*http:\/\//);
  expect(addressProblem('unreachable', 'http://10.0.0.9:3000')).toMatch(/can't reach a server at http:\/\/10\.0\.0\.9:3000.*company Wi-Fi/);
  expect(addressProblem('notMitra', 'http://10.0.0.9:8081')).toMatch(/not the Mitra server.*port is 3000/);
});
