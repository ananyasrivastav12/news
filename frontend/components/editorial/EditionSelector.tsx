// horizontal selector for daily feed editions
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Metadata } from '@/components/editorial/Typography';
import { colors, layout, spacing } from '@/design/tokens';
import { FeedEdition, FeedEditionType } from '@/lib/api';

const EDITION_LABELS: Record<FeedEditionType, string> = {
  morning_brief: 'Morning',
  midday_catch_up: 'Midday',
  daily_digest: 'Evening',
};

const EDITION_ICONS: Record<FeedEditionType, keyof typeof Ionicons.glyphMap> = {
  morning_brief: 'sunny-outline',
  midday_catch_up: 'business-outline',
  daily_digest: 'moon-outline',
};

type EditionSelectorProps = {
  editions: FeedEdition[];
  selectedFeedDate: string | null;
  selectedEditionType: FeedEditionType | null;
  disabled?: boolean;
  onSelect: (edition: FeedEdition) => void;
};

export const EDITION_ORDER: FeedEditionType[] = [
  'morning_brief',
  'midday_catch_up',
  'daily_digest',
];

export function editionLabel(editionType: FeedEditionType) {
  return EDITION_LABELS[editionType];
}

export function EditionSelector({
  editions,
  selectedFeedDate,
  selectedEditionType,
  disabled,
  onSelect,
}: EditionSelectorProps) {
  if (editions.length === 0) return null;

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {EDITION_ORDER.map((editionType, index) => {
        const edition =
          editions.find(
            (item) =>
              item.feed_date === selectedFeedDate && item.edition_type === editionType
          ) ?? editions.find((item) => item.edition_type === editionType);
        const selected =
          selectedEditionType === editionType && selectedFeedDate === edition?.feed_date;
        const available = Boolean(edition);
        const itemDisabled = disabled || !available;
        return (
          <React.Fragment key={editionType}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled: itemDisabled }}
              accessibilityLabel={`${EDITION_LABELS[editionType]} edition`}
              disabled={itemDisabled}
              onPress={() => edition && onSelect(edition)}
              style={({ pressed }) => [
                styles.item,
                itemDisabled && styles.disabledItem,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={EDITION_ICONS[editionType]}
                size={18}
                color={
                  itemDisabled
                    ? colors.inkMuted
                    : selected
                      ? colors.accent
                      : colors.deepBlack
                }
              />
              <Metadata style={[styles.label, selected && styles.activeLabel]}>
                {EDITION_LABELS[editionType]}
              </Metadata>
              <View style={[styles.rule, selected && styles.activeRule]} />
            </Pressable>
            {index < EDITION_ORDER.length - 1 ? <View style={styles.separator} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  item: {
    minWidth: layout.minTouch + spacing.md,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 1,
  },
  disabledItem: {
    opacity: 0.45,
  },
  label: {
    color: colors.inkSecondary,
    fontSize: 8.5,
    lineHeight: 11,
    letterSpacing: 1.9,
    textTransform: 'uppercase',
  },
  activeLabel: {
    color: colors.inkSecondary,
  },
  rule: {
    width: 28,
    height: 2,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  activeRule: {
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.65,
  },
  separator: {
    width: 1,
    height: 30,
    backgroundColor: colors.border,
    opacity: 0.85,
  },
});
