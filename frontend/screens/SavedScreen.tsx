import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EditorialImage } from '@/components/editorial/EditorialImage';
import { EmptyState } from '@/components/editorial/EmptyState';
import {
  Masthead,
  Metadata,
  SavedHeadline,
  ScreenTitle,
  SourceText,
} from '@/components/editorial/Typography';
import { useAppSession } from '@/context/AppSessionContext';
import { colors, layout, radius, shadows, spacing } from '@/design/tokens';
import { BriefingStory, getRelativeDate, savedArticleToBriefingStory } from '@/lib/briefingStory';
import { SavedArticle, deleteInteraction, fetchSavedArticles } from '@/lib/api';

const DEFAULT_FILTERS = ['All', 'Entertainment', 'Sports'];

function storyCountLabel(count: number) {
  return `${count} ${count === 1 ? 'story' : 'stories'}`;
}

export default function SavedScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { accessToken, apiBaseUrl, sessionReady } = useAppSession();
  const [articles, setArticles] = useState<SavedArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');

  const stories = useMemo(
    () => articles.map(savedArticleToBriefingStory),
    [articles]
  );
  const filters = useMemo(() => {
    const sections = Array.from(new Set(stories.map((story) => story.section))).slice(0, 5);
    return ['All', ...sections.filter((section) => section !== 'All')];
  }, [stories]);
  const visibleStories = useMemo(
    () => stories.filter((story) => filter === 'All' || story.section === filter),
    [filter, stories]
  );
  const cardWidth = Math.min(width - 56, 360);
  const chromeWidth = Math.min(width - 40, cardWidth + 16);

  const loadSaved = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setArticles(await fetchSavedArticles(apiBaseUrl, accessToken));
    } catch {
      setError('Saved stories could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, apiBaseUrl]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionReady) return;
      if (!accessToken) {
        router.replace('/login');
        return;
      }
      void loadSaved();
    }, [accessToken, loadSaved, router, sessionReady])
  );

  async function removeSaved(story: BriefingStory) {
    if (!accessToken) return;
    setArticles((current) => current.filter((article) => String(article.id) !== story.id));
    try {
      await deleteInteraction(apiBaseUrl, accessToken, {
        article_id: Number(story.id),
        interaction_type: 'save',
      });
    } catch {
      setError('That story could not be removed.');
      void loadSaved();
    }
  }

  async function openStory(story: BriefingStory) {
    if (!story.sourceUrl) {
      setError('Original article is unavailable.');
      return;
    }
    try {
      await Linking.openURL(story.sourceUrl);
    } catch {
      setError('Original article could not be opened.');
    }
  }

  if (!sessionReady || loading) {
    return (
      <SafeAreaView style={styles.centerState}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { width: chromeWidth }]}>
        <View style={styles.header}>
          <Masthead>THE EDIT</Masthead>
          <View style={styles.rule} />
          <ScreenTitle style={styles.screenTitle}>Saved Stories</ScreenTitle>
          <Metadata style={styles.muted}>{storyCountLabel(stories.length)}</Metadata>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(filters.length > 1 ? filters : DEFAULT_FILTERS).map((item) => {
            const selected = item === filter;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={styles.filterItem}
                onPress={() => setFilter(item)}
              >
                <Metadata style={[styles.filterText, selected && styles.filterTextSelected]}>
                  {item.toUpperCase()}
                </Metadata>
                <View style={[styles.filterRule, selected && styles.filterRuleSelected]} />
              </Pressable>
            );
          })}
        </ScrollView>

        {error ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Metadata style={styles.errorText}>{error}</Metadata>
          </View>
        ) : null}

        {visibleStories.length === 0 ? (
          <View style={styles.emptySlot}>
            <EmptyState
              icon="bookmark-outline"
              title="No saved stories"
              body="Stories you save from a briefing will appear here for later."
            />
          </View>
        ) : (
          <View style={styles.list}>
            {visibleStories.map((story) => (
              <Pressable
                key={story.id}
                accessibilityRole="button"
                accessibilityLabel={`Open saved story ${story.displayHeadline}`}
                style={styles.row}
                onPress={() => void openStory(story)}
              >
                <View style={styles.thumbnail}>
                  <EditorialImage
                    imageUrl={story.imageUrl}
                    section={story.section}
                    sourceName={story.sourceName}
                    topRadius={false}
                    aspectRatio={96 / 80}
                  />
                </View>
                <View style={styles.rowCopy}>
                  <SavedHeadline>{story.displayHeadline}</SavedHeadline>
                  <SourceText style={styles.source} numberOfLines={1}>
                    {story.sourceName} · {getRelativeDate(story.publishedAt)}
                  </SourceText>
                  <Metadata numberOfLines={2} style={styles.excerpt}>
                    {story.shortSummary}
                  </Metadata>
                </View>
                <View style={styles.rowActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove saved story" style={styles.iconButton} onPress={() => void removeSaved(story)}>
                    <Ionicons name="ellipsis-horizontal" size={19} color={colors.inkSecondary} />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  content: {
    alignSelf: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 126,
  },
  header: { gap: spacing.xs },
  rule: {
    height: 1,
    backgroundColor: colors.deepBlack,
    opacity: 0.65,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  screenTitle: {
    alignSelf: 'center',
    fontSize: 28,
    lineHeight: 32,
    textAlign: 'center',
  },
  muted: { alignSelf: 'center', color: colors.inkSecondary, textAlign: 'center' },
  filterRow: { gap: spacing.lg, paddingRight: spacing.md },
  filterItem: {
    minHeight: 30,
    justifyContent: 'flex-end',
    gap: spacing.xxs,
  },
  filterText: {
    color: colors.inkSecondary,
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '600',
  },
  filterTextSelected: { color: colors.accent },
  filterRule: {
    height: 2,
    backgroundColor: 'transparent',
  },
  filterRuleSelected: {
    backgroundColor: colors.accent,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.control,
    padding: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  errorText: { color: colors.error },
  emptySlot: { minHeight: 360 },
  list: { gap: spacing.sm },
  row: {
    minHeight: 118,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfacePrimary,
    borderWidth: 1,
    borderColor: 'rgba(21, 20, 18, 0.14)',
    borderRadius: radius.card + 2,
    ...shadows.card,
  },
  thumbnail: {
    width: 90,
    height: 76,
    borderRadius: radius.thumbnail,
    overflow: 'hidden',
    backgroundColor: colors.imageFallback,
  },
  rowCopy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  source: { color: colors.inkSecondary, textTransform: 'uppercase' },
  excerpt: { color: colors.inkSecondary },
  rowActions: { justifyContent: 'flex-start' },
  iconButton: {
    width: layout.minTouch,
    height: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
