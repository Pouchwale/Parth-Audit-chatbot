import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Modal, Pressable, StyleSheet, Text, View, type ImageURISource } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Radius, Spacing } from '@/constants/theme';

// A photo is seen best on black, whatever the app's theme.
const BACKDROP = '#000000';
const ON_BACKDROP = '#FFFFFF';
const PRESSED = 'rgba(255, 255, 255, 0.16)';

/** An image filling the screen, with its name and a close button. */
export function ImageViewer({ name, source, onClose }: { name: string; source: ImageURISource; onClose(): void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* The modal is a window of its own, which needs its own safe-area measurements. */}
      <SafeAreaProvider>
        <SafeAreaView style={[styles.screen, { backgroundColor: BACKDROP }]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.name, { color: ON_BACKDROP }]}>
              {name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [styles.close, { backgroundColor: pressed ? PRESSED : 'transparent' }]}>
              <Ionicons name="close" size={24} color={ON_BACKDROP} />
            </Pressable>
          </View>
          <Image source={source} resizeMode="contain" accessibilityLabel={name} style={styles.image} />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingLeft: Spacing.lg, paddingRight: Spacing.sm, paddingVertical: Spacing.xs },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  close: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1 },
});
