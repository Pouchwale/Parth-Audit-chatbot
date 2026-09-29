import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Notice } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { viewedFile } from '@/lib/hand-over';

/** A PDF or photo opened on an iPhone, shown by the system's web view, which draws both. */
export default function ViewerScreen() {
  const theme = useTheme();
  // The file opened last, as it was when this screen opened.
  const [file] = useState(viewedFile);

  if (!file) {
    return (
      <View style={styles.empty}>
        <Notice>Nothing is open. Open the file again from the chat.</Notice>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: file.name }} />
      <WebView
        source={{ uri: file.uri }}
        // Local files are outside the web view's default http and https, which it would otherwise hand to the system.
        originWhitelist={['*']}
        allowingReadAccessToURL={file.folder}
        style={[styles.viewer, { backgroundColor: theme.background }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1 },
  empty: { padding: Spacing.lg },
});
