import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ButtonText, Metadata, ScreenTitle } from '@/components/editorial/Typography';
import { colors, layout, radius, spacing } from '@/design/tokens';

type EmptyStateProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      {icon ? <Ionicons name={icon} size={28} color={colors.accent} /> : null}
      <ScreenTitle style={styles.title}>{title}</ScreenTitle>
      <Metadata style={styles.body}>{body}</Metadata>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={onAction}>
          <ButtonText style={styles.buttonText}>{actionLabel}</ButtonText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
    backgroundColor: colors.canvas,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    maxWidth: 320,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
  button: {
    minHeight: layout.minTouch,
    borderRadius: radius.control,
    backgroundColor: colors.inkPrimary,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: colors.surfacePrimary,
  },
});
