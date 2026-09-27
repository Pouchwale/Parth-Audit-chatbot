import { Alert, Platform } from 'react-native';
import { useColorSchemeSetting } from '@/constants/theme';

/** Returns a function that asks the person to confirm a destructive step, in the app's light or dark appearance. */
export function useConfirm(): (title: string, message: string, action: string) => Promise<boolean> {
  const scheme = useColorSchemeSetting();
  return (title, message, action) => {
    if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
    return new Promise((resolve) =>
      Alert.alert(
        title,
        message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: action, style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false), userInterfaceStyle: scheme },
      ),
    );
  };
}
