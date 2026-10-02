// How the phone app finds the Mitra server (mobile/src/lib/server-address.ts). The app has no test runner of its own,
// and these are plain functions, so they are checked here with the server's tests.
import { expect, it } from 'vitest';

// Loaded by a path the server's typecheck does not follow: the app's files are the app's typecheck's (npm run
// typecheck checks both), and to the server's settings a file of the app's is CommonJS.
interface AddressModule {
  SERVER_PORT: number;
  hostOf(address: string | null | undefined): string | null;
  serverAddress(sources: {
    configured?: string | null;
    page?: { protocol: string; hostname: string } | null;
    expoAddresses?: readonly (string | null | undefined)[];
  }): string | null;
  unreachableMessage(server: string | null, device: 'phone' | 'computer'): string;
}
const APP_MODULE: string = new URL('../../mobile/src/lib/server-address.ts', import.meta.url).href;
const { hostOf, SERVER_PORT, serverAddress, unreachableMessage } = (await import(APP_MODULE)) as AddressModule;

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
  expect(serverAddress({ configured: '   ', expoAddresses: ['192.168.0.107:8081'] })).toBe('http://192.168.0.107:3000');
  // Nothing says where it is: no guess at "localhost", which on a phone is the phone.
  expect(serverAddress({})).toBeNull();
  expect(serverAddress({ expoAddresses: [undefined, 'mitra://'] })).toBeNull();
});

it("says what to do, in order, when the server can't be reached", () => {
  const phone = unreachableMessage('http://192.168.0.107:3000', 'phone');
  expect(phone).toContain('http://192.168.0.107:3000');
  expect(phone).toMatch(/Try again in a moment\..*this phone is on the company Wi-Fi.*ask your administrator/);
  expect(unreachableMessage('http://localhost:3000', 'computer')).toContain('this computer is on the company Wi-Fi');
  expect(unreachableMessage(null, 'phone')).toMatch(/can't tell where its server is.*QR code.*administrator/);
});
