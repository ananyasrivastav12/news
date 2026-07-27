import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EditorialImage } from '@/components/editorial/EditorialImage';
import {
  ArticleHeadline,
  Metadata,
  SectionLabel,
  Summary,
} from '@/components/editorial/Typography';
import { colors, radius, shadows, spacing } from '@/design/tokens';
import { BriefingStory, getArticleDisplayDate } from '@/lib/briefingStory';

type StoryCardProps = {
  story: BriefingStory;
  lessSelected?: boolean;
  savedSelected?: boolean;
  moreSelected?: boolean;
  compact?: boolean;
  onOpen: () => void;
  onLess: () => void;
  onSave: () => void;
  onMore: () => void;
};

function IconAction({
  icon,
  selected,
  label,
  onPress,
}: {
  icon: 'thumbs-up-outline' | 'thumbs-down-outline' | 'bookmark-outline';
  selected?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        selected && styles.iconButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={21} color={selected ? colors.accent : colors.deepBlack} />
    </Pressable>
  );
}

export function StoryCard({
  story,
  lessSelected,
  savedSelected,
  moreSelected,
  compact,
  onOpen,
  onLess,
  onSave,
  onMore,
}: StoryCardProps) {
  return (
    <View style={[styles.cardShadow, compact && styles.compactCard]}>
      <View style={styles.depthUnderlay} />
      <View style={[styles.card, compact && styles.compactInnerCard]}>
        <Pressable onPress={onOpen} accessibilityRole="imagebutton" style={styles.imageWrap}>
          <EditorialImage
            imageUrl={story.imageUrl}
            section={story.section}
            sourceName={story.sourceName}
            topRadius={false}
            accessibilityLabel={`${story.displayHeadline}. Image from ${story.sourceName}.`}
          />
        </Pressable>
        <View style={[styles.body, compact && styles.compactBody]}>
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`Open ${story.displayHeadline}`}
            style={styles.headlineWrap}
          >
            <ArticleHeadline numberOfLines={3}>{story.displayHeadline}</ArticleHeadline>
          </Pressable>
          <View style={styles.metaActionRow}>
            <View style={styles.metaLine}>
              <SectionLabel numberOfLines={1} style={styles.section}>{story.section}</SectionLabel>
              <Metadata style={styles.metaDot}>•</Metadata>
              <Metadata numberOfLines={1} style={styles.date}>{getArticleDisplayDate(story.publishedAt)}</Metadata>
            </View>
            <View style={styles.actionRow}>
              <IconAction
                icon="thumbs-up-outline"
                selected={moreSelected}
                label="Show more stories like this"
                onPress={onMore}
              />
              <IconAction
                icon="thumbs-down-outline"
                selected={lessSelected}
                label="Show fewer stories like this"
                onPress={onLess}
              />
              <IconAction
                icon="bookmark-outline"
                selected={savedSelected}
                label="Save this story"
                onPress={onSave}
              />
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryWrap}>
            <Summary numberOfLines={7}>{story.shortSummary}</Summary>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    borderRadius: radius.card + 1,
    backgroundColor: 'rgba(255, 253, 248, 0.82)',
    ...shadows.card,
  },
  card: {
    backgroundColor: colors.surfacePrimary,
    borderRadius: radius.card + 2,
    borderWidth: 1,
    borderColor: 'rgba(21, 20, 18, 0.18)',
    overflow: 'hidden',
    padding: spacing.xs,
  },
  compactCard: {
    alignSelf: 'stretch',
    height: '100%',
  },
  compactInnerCard: {
    flex: 1,
  },
  depthUnderlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: -9,
    height: 30,
    borderRadius: radius.card,
    backgroundColor: 'rgba(17, 16, 15, 0.1)',
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  compactBody: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  imageWrap: {
    borderRadius: radius.smallCard,
    overflow: 'hidden',
  },
  headlineWrap: {
    minHeight: 48,
    justifyContent: 'center',
  },
  metaActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 34,
  },
  metaLine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  section: {
    color: colors.accent,
  },
  metaDot: {
    color: colors.inkSecondary,
  },
  date: {
    color: colors.inkSecondary,
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  iconButtonSelected: {
    backgroundColor: colors.accentSoft,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.85,
  },
  summaryWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
});
