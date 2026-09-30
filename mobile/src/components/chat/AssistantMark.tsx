import { Image } from 'react-native';
import { AppMark } from '@/constants/brand';

/** Mitra's small round mark, beside its replies and on the welcome screen. */
export function AssistantMark({ size = 28 }: { size?: number }) {
  return (
    <Image
      source={AppMark}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}
