import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Secure storage on phones. The web build (used for testing) falls back to localStorage.

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return globalThis.localStorage?.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') return globalThis.localStorage?.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}
