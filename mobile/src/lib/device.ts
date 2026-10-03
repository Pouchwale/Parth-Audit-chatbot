import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import type { DeviceInfo } from '@shared/api';
import { getItem, setItem } from './storage';

/** The model recorded for a browser that doesn't say which device it runs on: a computer's, in practice. */
export const WEB_BROWSER_MODEL = 'Web browser';

/** What the server records about this device at sign-in. The ID is generated once per install. */
export async function deviceInfo(): Promise<DeviceInfo> {
  let deviceId = await getItem('deviceId');
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await setItem('deviceId', deviceId);
  }
  return {
    deviceId,
    name: Device.deviceName,
    model: Device.modelName ?? (Platform.OS === 'web' ? WEB_BROWSER_MODEL : null),
    os: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion,
    appVersion: Constants.expoConfig?.version ?? null,
  };
}

/**
 * The name to look for in the phone's Settings to allow the microphone or the camera. Inside Expo Go the permission
 * is Expo Go's, asked in Expo Go's own words, so the person allows it for Expo Go, not for Mitra.
 */
export function nameInSettings(): string {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? 'Expo Go' : 'this app';
}

let zone: { value: string | undefined } | null = null;

/** The device's IANA time zone, e.g. "Asia/Kolkata", looked up once. */
export function timeZone(): string | undefined {
  if (!zone) {
    try {
      zone = { value: Intl.DateTimeFormat().resolvedOptions().timeZone };
    } catch {
      zone = { value: undefined };
    }
  }
  return zone.value;
}
