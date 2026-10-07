// WHERE THE MITRA SERVER IS. Plain functions with no imports, so the server's tests can check them
// (server/test/server-address.test.ts).
//
// The plant runs the Mitra server (port 3000) on one computer. Mitra reaches it in one of two ways:
//
// - In Expo Go, phones open Mitra from a QR code for exp://<that computer's address>:8081, served by Expo on the same
//   computer. Expo Go tells the app that address: the manifest's hostUri (Constants.expoConfig.hostUri) —
//   REACT_NATIVE_PACKAGER_HOSTNAME when Expo was started with it (npm run phones sets it), else the address the phone
//   itself reached — and the same address as Expo Go's debuggerHost and in its linking URL. So the server is that
//   computer, on port 3000. The web build does the same with the page's own computer. EXPO_PUBLIC_API_URL, when it was
//   set where the app was bundled, says otherwise.
// - The installed Android app (built with EAS) has no such link, so it asks: the sign-in screen asks for the server's
//   address once, checks that a Mitra server answers there, and saves it on the phone; it can be changed later on the
//   sign-in screen and in Settings. A saved address wins over a default baked into the build (EXPO_PUBLIC_API_URL from
//   the build profile in eas.json).

/** The port the Mitra server listens on, on the computer that runs Expo (PORT in server/.env). */
export const SERVER_PORT = 3000;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The computer an address names: "192.168.0.107:8081", "192.168.0.107", "exp://192.168.0.107:8081/--/",
 * "[fe80::1]:8081" and "mitra-server.local:8081" each name one. Null when there is none.
 */
export function hostOf(address: string | null | undefined): string | null {
  let rest = typeof address === 'string' ? address.trim() : '';
  if (!rest) return null;
  rest = rest.replace(SCHEME, '').replace(/^[^@/]*@/, '');
  rest = rest.split(/[/?#]/)[0] ?? '';
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    return end > 1 ? rest.slice(0, end + 1) : null;
  }
  // More than one colon and no brackets: an IPv6 address without a port.
  if (rest.split(':').length > 2) return `[${rest}]`;
  const host = rest.split(':')[0]?.trim() ?? '';
  return host || null;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** A computer's name or IPv4 address as typed: every number of an all-number address 0-255, and four of them. */
function isHostName(host: string): boolean {
  const labels = host.split('.');
  if (!labels.every((label) => LABEL.test(label))) return false;
  if (labels.every((label) => /^\d+$/.test(label))) return labels.length === 4 && labels.every((label) => Number(label) <= 255);
  return true;
}

/**
 * A server address as someone types it or as a build sets it, made into the address to call, or null when it isn't
 * one. Just the computer is enough: "192.168.62.195" is http://192.168.62.195:3000, the Mitra server's port. A port
 * given is kept ("192.168.62.195:3001"), and a full address that starts with http:// or https:// is taken as written,
 * without a slash at the end.
 */
export function normalizeAddress(input: string | null | undefined): string | null {
  let rest = typeof input === 'string' ? input.trim() : '';
  if (!rest) return null;
  let scheme: string | null = null;
  const given = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (given) {
    scheme = given[1]!.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return null;
    rest = rest.slice(given[0].length);
  }
  const cut = rest.search(/[/?#]/);
  const authority = cut >= 0 ? rest.slice(0, cut) : rest;
  const path = (cut >= 0 ? rest.slice(cut) : '').replace(/\/+$/, '');
  // A path is kept (a server behind another web server may sit under one); a query or a fragment means a mistake.
  if (path && !/^\/[^\s?#]*$/.test(path)) return null;

  let host: string;
  let port = '';
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 2) return null;
    host = authority.slice(0, end + 1);
    const after = authority.slice(end + 1);
    if (after) {
      if (!after.startsWith(':')) return null;
      port = after.slice(1);
      if (!port) return null;
    }
    if (!/^\[[0-9a-f:.]+\]$/i.test(host)) return null;
  } else if (authority.split(':').length > 2) {
    // More than one colon and no brackets: an IPv6 address without a port.
    if (!/^[0-9a-f:.]+$/i.test(authority)) return null;
    host = `[${authority}]`;
  } else {
    const [name = '', typedPort] = authority.split(':');
    host = name;
    if (typedPort !== undefined) {
      if (!typedPort) return null;
      port = typedPort;
    }
    if (!isHostName(host)) return null;
  }
  if (port && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) return null;
  // Just the computer (no http://): the Mitra server's own port.
  if (!scheme && !port) port = String(SERVER_PORT);
  return `${scheme ?? 'http'}://${host.toLowerCase()}${port ? `:${port}` : ''}${path}`;
}

/** An address the way people type it: "192.168.62.195" for http://192.168.62.195:3000, else the address in full. */
export function shortAddress(address: string): string {
  const match = /^http:\/\/([^/]+):(\d+)$/.exec(address);
  return match && Number(match[2]) === SERVER_PORT ? match[1]! : address;
}

/** Where this copy of the app is running, to tell whether it asks for its server's address. */
export interface AppPlace {
  platform: string;
  /** Inside Expo Go (Constants.executionEnvironment is "storeClient"). */
  inExpoGo: boolean;
  /** EXPO_PUBLIC_ASK_FOR_SERVER where the web build was bundled: "1" makes a browser ask too, to test that screen. */
  webAsks?: string | null;
}

/**
 * Whether this copy of the app asks for its server's address: the installed app (on Android, or an iPhone if one is
 * ever built), which has no Expo Go link to find it from. Expo Go and the web build find it themselves.
 */
export function asksForServer({ platform, inExpoGo, webAsks }: AppPlace): boolean {
  if (platform === 'web') return webAsks?.trim() === '1';
  return !inExpoGo;
}

export interface AddressSources {
  /** The installed app asks for the address (asksForServer); Expo Go and the web build find it themselves. */
  asks?: boolean;
  /** Where the installed app asks: the address saved on this phone, from the sign-in screen or Settings. */
  saved?: string | null;
  /** EXPO_PUBLIC_API_URL, when it was set where the app was bundled. */
  configured?: string | null;
  /** In a browser: the page's own address. */
  page?: { protocol: string; hostname: string } | null;
  /** In Expo Go: the addresses it loaded the app from, in the order to trust them. */
  expoAddresses?: readonly (string | null | undefined)[];
}

/** The Mitra server's address, such as http://192.168.0.107:3000, or null when this copy of the app can't tell. */
export function serverAddress({ asks = false, saved, configured, page, expoAddresses = [] }: AddressSources): string | null {
  // The installed app: what was saved on the phone, else the build's default. Nothing else names its server.
  if (asks) return normalizeAddress(saved) ?? normalizeAddress(configured);
  const set = normalizeAddress(configured);
  if (set) return set;
  if (page?.hostname) return `${page.protocol}//${page.hostname}:${SERVER_PORT}`;
  for (const address of expoAddresses) {
    const host = hostOf(address);
    if (host) return `http://${host}:${SERVER_PORT}`;
  }
  return null;
}

/**
 * What to say when the server can't be reached. Factory staff read this, so it says what to try in order: again,
 * then the company Wi-Fi, then the administrator. `device` is "phone" or "computer"; `asks` is true in the installed
 * app, where the person entered the server's address and can change it.
 */
export function unreachableMessage(server: string | null, device: 'phone' | 'computer', asks = false): string {
  if (!server) {
    return asks
      ? "Mitra doesn't know where its server is yet. Enter the Mitra server's address on the sign-in screen. Your administrator can tell you what it is."
      : "Mitra can't tell where its server is. Open Mitra again from the QR code your administrator shared. If that doesn't help, ask your administrator.";
  }
  const first = `Mitra can't reach its server at ${server}. Try again in a moment.`;
  return asks
    ? `${first} If it still doesn't work, check that this ${device} is on the company Wi-Fi, then ask your administrator to check that the Mitra server is running and whether its address has changed. You can change the address with Change server.`
    : `${first} If it still doesn't work, check that this ${device} is on the company Wi-Fi, then ask your administrator to check that the Mitra server is running.`;
}

/** Why an address typed on the sign-in screen or in Settings can't be used, in the words shown under it. */
export function addressProblem(problem: 'invalid' | 'unreachable' | 'notMitra', address?: string): string {
  switch (problem) {
    case 'invalid':
      return 'That is not a server address. Type it like 192.168.1.20, or in full, starting with http://.';
    case 'unreachable':
      return `Mitra can't reach a server at ${address}. Check the address, and that this phone is on the company Wi-Fi. If it is right, ask your administrator to check that the Mitra server is running.`;
    case 'notMitra':
      return `Something answered at ${address}, but it is not the Mitra server. Check the address and the port: the Mitra server's port is ${SERVER_PORT}.`;
  }
}
