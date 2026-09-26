import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import type { DeviceInfo } from '@shared/api';
import { getItem, setItem } from './storage';

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
    model: Device.modelName ?? (Platform.OS === 'web' ? 'Web browser' : null),
    os: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion,
    appVersion: Constants.expoConfig?.version ?? null,
  };
}

export function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
