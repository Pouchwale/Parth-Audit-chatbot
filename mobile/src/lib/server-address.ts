// WHERE THE MITRA SERVER IS. Plain functions with no imports, so the server's tests can check them
// (server/test/server-address.test.ts).
//
// The plant runs the Mitra server (port 3000) and Expo (port 8081) on one computer, and phones open Mitra in Expo Go
// from a QR code for exp://<that computer's address>:8081. Expo Go tells the app that address: the manifest's hostUri
// (Constants.expoConfig.hostUri) — REACT_NATIVE_PACKAGER_HOSTNAME when Expo was started with it (npm run phones sets
// it), else the address the phone itself reached — and the same address as Expo Go's debuggerHost and in its linking
// URL. So the server is that computer, on port 3000. EXPO_PUBLIC_API_URL, when it was set where the app was bundled,
// says otherwise.

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

export interface AddressSources {
  /** EXPO_PUBLIC_API_URL, when it was set where the app was bundled. */
  configured?: string | null;
  /** In a browser: the page's own address. */
  page?: { protocol: string; hostname: string } | null;
  /** In Expo Go: the addresses it loaded the app from, in the order to trust them. */
  expoAddresses?: readonly (string | null | undefined)[];
}

/** The Mitra server's address, such as http://192.168.0.107:3000, or null when this copy of the app can't tell. */
export function serverAddress({ configured, page, expoAddresses = [] }: AddressSources): string | null {
  const set = configured?.trim();
  if (set) return (SCHEME.test(set) ? set : `http://${set}`).replace(/\/+$/, '');
  if (page?.hostname) return `${page.protocol}//${page.hostname}:${SERVER_PORT}`;
  for (const address of expoAddresses) {
    const host = hostOf(address);
    if (host) return `http://${host}:${SERVER_PORT}`;
  }
  return null;
}

/**
 * What to say when the server can't be reached. Factory staff read this, so it says what to try in order: again,
 * then the company Wi-Fi, then the administrator. `device` is "phone" or "computer".
 */
export function unreachableMessage(server: string | null, device: 'phone' | 'computer'): string {
  if (!server) {
    return "Mitra can't tell where its server is. Open Mitra again from the QR code your administrator shared. If that doesn't help, ask your administrator.";
  }
  return `Mitra can't reach its server at ${server}. Try again in a moment. If it still doesn't work, check that this ${device} is on the company Wi-Fi, then ask your administrator to check that the Mitra server is running.`;
}
