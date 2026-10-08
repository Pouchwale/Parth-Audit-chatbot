// The app's configuration (it was app.json until version 1.1.0). A file of code rather than JSON for one reason: the
// Android build gets Firebase's google-services.json only when there is one, so the app builds with or without Firebase.
//
// - Firebase present: EAS's file variable GOOGLE_SERVICES_JSON (the path EAS gives the uploaded file on its build
//   server; see README, "Notifications"), or a google-services.json beside this file (git-ignored). Push alerts then
//   reach the installed Android app with the app closed.
// - No Firebase yet: the build has no Google services file. Mitra still has its inbox, Tasks and the daily reminders on
//   the phone; asking Expo for a push token fails quietly, and Settings says alerts are not set up yet.
//
// Versions: a change that needs a new .apk (a package with native code, such as expo-notifications in 1.1.0, a
// permission, the icon) raises `version` and `android.versionCode`. The runtime version is the app's version
// (policy appVersion), so updates published for 1.1.0 never reach a 1.0.0 .apk, which lacks the notification module.
// The package and the signing key stay the same, so 1.1.0 installs over 1.0.0 and keeps its server and sign-in.
/// <reference types="node" />
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/** The Mitra mark's colour: the adaptive icon's background, the splash screen and the notification icon's tint. */
const BRAND = '#7E3C40';
const EAS_PROJECT_ID = '4add7f19-7318-43c1-be5c-efb24f28e6ab';

/** Firebase's file for the Android app (package com.pouchwale.mitra), when there is one. */
function googleServicesFile(): string | undefined {
  const fromEas = process.env.GOOGLE_SERVICES_JSON?.trim();
  if (fromEas && existsSync(fromEas)) return fromEas;
  const here = typeof __dirname === 'string' ? __dirname : process.cwd();
  return existsSync(resolve(here, 'google-services.json')) ? './google-services.json' : undefined;
}

const googleServices = googleServicesFile();

const config: ExpoConfig = {
  name: 'Mitra',
  slug: 'mitra',
  version: '1.1.0',
  runtimeVersion: {
    policy: 'appVersion',
  },
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'mitra',
  userInterfaceStyle: 'automatic',
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  ios: {
    bundleIdentifier: 'com.pouchwale.mitra',
  },
  android: {
    package: 'com.pouchwale.mitra',
    versionCode: 2,
    adaptiveIcon: {
      backgroundColor: BRAND,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: BRAND,
        image: './assets/images/splash-icon.png',
        imageWidth: 180,
      },
    ],
    'expo-secure-store',
    [
      'expo-audio',
      {
        microphonePermission: 'Allow $(PRODUCT_NAME) to use the microphone so you can speak your requests.',
      },
    ],
    'expo-sharing',
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow $(PRODUCT_NAME) to use your photos so you can attach them to your requests.',
        cameraPermission: 'Allow $(PRODUCT_NAME) to use the camera so you can attach photos to your requests.',
      },
    ],
    'expo-asset',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ],
    [
      // Alerts from DCRS: the small icon in the status bar (white, tinted with the brand colour) and the channel an
      // alert goes to when it names none. The app makes its two channels itself (lib/push.ts): "tasks" (high) and
      // "summary" (default).
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: BRAND,
        defaultChannel: 'tasks',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
  owner: 'parth2005s-team',
};

export default config;
