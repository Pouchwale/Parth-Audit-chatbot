import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator } from 'react-native';
import type { ActionStatus } from '@shared/api';
import { useTheme } from '@/constants/theme';

const SIZE = 16;

/** How a lookup or change is going: running, done, failed, not done, or waiting for confirmation. */
export function StatusIcon({ status }: { status: ActionStatus }) {
  const theme = useTheme();
  switch (status) {
    case 'running':
      return <ActivityIndicator size="small" color={theme.textSecondary} style={{ width: SIZE, height: SIZE }} />;
    case 'succeeded':
      return <Ionicons name="checkmark-circle" size={SIZE} color={theme.success} />;
    case 'failed':
      return <Ionicons name="alert-circle" size={SIZE} color={theme.danger} />;
    case 'cancelled':
      return <Ionicons name="remove-circle" size={SIZE} color={theme.textSecondary} />;
    case 'awaiting_confirmation':
      return <Ionicons name="time-outline" size={SIZE} color={theme.warning} />;
  }
}
