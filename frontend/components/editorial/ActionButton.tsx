import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';

import { ButtonText } from '@/components/editorial/Typography';
import { colors, layout, radius, spacing } from '@/design/tokens';

type ActionButtonProps = {
  label: 'Less' | 'Save' | 'More' | 'Open';
  icon: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

export function ActionButton({
  label,
  icon,
  selected,
  disabled,
  onPress,
  style,
  accessibilityLabel,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={selected ? colors.accent : colors.inkSecondary}
      />
      <ButtonText style={[styles.label, selected && styles.selectedLabel]}>
        {label}
      </ButtonText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.minTouch,
    minWidth: layout.minTouch,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfacePrimary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.48,
  },
  label: {
    color: colors.inkSecondary,
  },
  selectedLabel: {
    color: colors.accent,
  },
});
