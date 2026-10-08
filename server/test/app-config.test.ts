// The phone app's build configuration (mobile/app.config.ts): version 1.1.0 with the notification module, installed over
// 1.0.0 (same package, a higher versionCode, the runtime version that keeps 1.0.0 from getting this JavaScript), and
// Firebase's file wired in only when there is one, so the Android app builds with or without Firebase.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const CONFIG = new URL('../../mobile/app.config.ts', import.meta.url).href;

interface Plugin {
  0: string;
  1?: Record<string, unknown>;
}
interface AppConfig {
  version: string;
  runtimeVersion: unknown;
  scheme: string;
  android: { package: string; versionCode: number; googleServicesFile?: string; adaptiveIcon: { backgroundColor: string } };
  ios: { bundleIdentifier: string };
  plugins: (string | Plugin)[];
  extra: { eas: { projectId: string } };
  owner: string;
  updates: { url: string };
}

/** The configuration as the app's build reads it, with the environment given. */
async function config(env: Record<string, string | undefined> = {}): Promise<AppConfig> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  // Read afresh each time: resetModules makes the import run the file again, with this environment.
  return ((await import(CONFIG)) as { default: AppConfig }).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it('is version 1.1.0 of the same app, with the notification module, and keeps every earlier setting', async () => {
  const app = await config({ GOOGLE_SERVICES_JSON: undefined });
  expect(app.version).toBe('1.1.0');
  expect(app.runtimeVersion).toEqual({ policy: 'appVersion' });
  expect(app.android).toMatchObject({ package: 'com.pouchwale.mitra', versionCode: 2, adaptiveIcon: { backgroundColor: '#7E3C40' } });
  expect(app.ios.bundleIdentifier).toBe('com.pouchwale.mitra');
  expect(app.scheme).toBe('mitra');
  expect(app.extra.eas.projectId).toBe('4add7f19-7318-43c1-be5c-efb24f28e6ab');
  expect(app.owner).toBe('parth2005s-team');
  expect(app.updates.url).toBe('https://u.expo.dev/4add7f19-7318-43c1-be5c-efb24f28e6ab');
  const names = app.plugins.map((plugin) => (typeof plugin === 'string' ? plugin : plugin[0]));
  expect(names).toEqual(['expo-router', 'expo-splash-screen', 'expo-secure-store', 'expo-audio', 'expo-sharing', 'expo-image-picker', 'expo-asset', 'expo-build-properties', 'expo-notifications']);
  const notifications = app.plugins.find((plugin): plugin is Plugin => typeof plugin !== 'string' && plugin[0] === 'expo-notifications');
  expect(notifications?.[1]).toEqual({ icon: './assets/images/notification-icon.png', color: '#7E3C40', defaultChannel: 'tasks' });
});

it("wires Firebase's file in only when EAS gives one (or one sits beside the config), so a build works without it", async () => {
  // No Firebase yet: no Google services file at all (there is none beside the config in the repository either).
  expect((await config({ GOOGLE_SERVICES_JSON: undefined })).android.googleServicesFile).toBeUndefined();
  // EAS's file variable names a file that is there: that file.
  const folder = mkdtempSync(join(tmpdir(), 'mitra-config-'));
  try {
    const file = join(folder, 'google-services.json');
    writeFileSync(file, '{"project_info":{"project_id":"stand-in"}}');
    expect((await config({ GOOGLE_SERVICES_JSON: file })).android.googleServicesFile).toBe(file);
    // A variable naming a file that is not there is left out, rather than failing the build.
    expect((await config({ GOOGLE_SERVICES_JSON: join(folder, 'missing.json') })).android.googleServicesFile).toBeUndefined();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
