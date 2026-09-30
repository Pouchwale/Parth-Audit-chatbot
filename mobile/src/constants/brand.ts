import type { ImageSourcePropType } from 'react-native';

/** The product's name wherever the app shows it. The name under the app's icon is set separately, in app.json. */
export const AppName = 'Mitra';

/** The app icon's artwork: on the sign-in screen, on the welcome screen and beside each reply. */
export const AppMark = require<ImageSourcePropType>('@/assets/images/mitra-mark.png');
