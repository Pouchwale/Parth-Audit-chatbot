import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, type ComponentProps } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { MAX_ATTACHMENTS } from '@/lib/file-types';
import type { PickSource } from '@/lib/picked-files';

/** Where the button that opens the menu is on screen, for placing it beside the button in a browser. */
export interface Anchor {
  x: number;
  y: number;
}

interface Option {
  source: PickSource;
  label: string;
  detail: string;
  icon: ComponentProps<typeof Ionicons>['name'];
}

const FOLDER_DETAIL = `Every file in a folder, up to ${MAX_ATTACHMENTS}`;

const OPTIONS: readonly Option[] = [
  { source: 'photos', label: 'Photos', detail: 'From your photo library', icon: 'images-outline' },
  ...(Platform.OS === 'web' ? [] : [{ source: 'camera', label: 'Camera', detail: 'Take a photo', icon: 'camera-outline' } as const]),
  { source: 'files', label: 'Files', detail: 'PDF, Word, Excel, CSV, text or images', icon: 'document-outline' },
  {
    source: 'folder',
    label: 'Folder',
    // Android won't hand over the Download folder itself, or the top of the phone's storage.
    detail: Platform.OS === 'android' ? `${FOLDER_DETAIL}. Pick a folder inside Download, not Download itself.` : FOLDER_DETAIL,
    icon: 'folder-outline',
  },
];

const POPOVER_WIDTH = 300;
const POPOVER_GAP = Spacing.sm;

/**
 * What to attach: photos, the camera (phones only), files or a whole folder. A sheet from the bottom on phones, a
 * popover above the button in a browser.
 */
export function AttachMenu({
  visible,
  anchor,
  onPick,
  onClose,
}: {
  visible: boolean;
  anchor: Anchor | null;
  onPick(source: PickSource): void;
  onClose(): void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // iPhones can't show a picker while this menu is still going away, so the choice waits until it has.
  const chosen = useRef<PickSource | null>(null);

  function choose(source: PickSource) {
    onClose();
    // Browsers open their file dialog only straight from the tap, so it can't wait.
    if (Platform.OS === 'ios') chosen.current = source;
    else onPick(source);
  }

  function dismissed() {
    const source = chosen.current;
    chosen.current = null;
    if (source) onPick(source);
  }

  const popover = Platform.OS === 'web' && anchor;
  const placement = popover
    ? {
        left: Math.max(Spacing.sm, Math.min(anchor.x, window.width - POPOVER_WIDTH - Spacing.sm)),
        bottom: window.height - anchor.y + POPOVER_GAP,
      }
    : null;

  return (
    <Modal visible={visible} transparent animationType={popover ? 'none' : 'fade'} onRequestClose={onClose} onDismiss={dismissed}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: popover ? 'transparent' : theme.overlay }]}
      />
      <View
        aria-modal
        accessibilityLabel="Add attachment"
        style={[
          { backgroundColor: theme.surface, borderColor: theme.border },
          placement ? [styles.popover, placement] : [styles.sheet, { paddingBottom: insets.bottom + Spacing.md }],
        ]}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.source}
            accessibilityRole="menuitem"
            accessibilityLabel={option.label}
            accessibilityHint={option.detail}
            onPress={() => choose(option.source)}
            style={({ pressed }) => [styles.option, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
            <View style={[styles.icon, { backgroundColor: theme.surfaceMuted }]}>
              <Ionicons name={option.icon} size={20} color={theme.text} />
            </View>
            <View style={styles.text}>
              <Text style={[styles.label, { color: theme.text }]}>{option.label}</Text>
              <Text style={[styles.detail, { color: theme.textSecondary }]}>{option.detail}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.xs,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  icon: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  label: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 18 },
});
