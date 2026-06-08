import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppSession } from '@/context/AppSessionContext';
import { FeedItem, deleteInteraction, fetchFeed, logInteraction } from '@/lib/api';

type ReactionType = 'like' | 'skip' | 'save';

function formatArticleDate(value: string | null) {
  if (!value) return 'Recent';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function FeedScreen() {
  const router = useRouter();
  const { accessToken, apiBaseUrl, userEmail } = useAppSession();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeReactions, setActiveReactions] = useState<Record<number, Partial<Record<ReactionType, boolean>>>>({});
  const cardOpenedAt = useRef<number>(Date.now());
  const swipe = useRef(new Animated.ValueXY()).current;

  const currentItem = feed[currentIndex] ?? null;
  const isCaughtUp = feed.length > 0 && currentIndex >= feed.length;
  const feedStats = useMemo(
    () => ({
      current: Math.min(currentIndex + 1, feed.length),
      total: feed.length,
    }),
    [currentIndex, feed.length]
  );

  const loadFeed = useCallback(
    async (forceRefresh = false) => {
      if (!accessToken) {
        setFeed([]);
        setCurrentIndex(0);
        return;
      }

      setLoading(true);
      try {
        const items = await fetchFeed(apiBaseUrl, accessToken, forceRefresh);
        setFeed(items);
        setCurrentIndex(0);
        setActiveReactions({});
        cardOpenedAt.current = Date.now();
      } catch (error) {
        Alert.alert(
          'Feed error',
          error instanceof Error ? error.message : 'Unable to load feed.'
        );
      } finally {
        setLoading(false);
      }
    },
    [accessToken, apiBaseUrl]
  );

  useEffect(() => {
    void loadFeed(false);
  }, [loadFeed]);

  useEffect(() => {
    const urls = feed
      .slice(currentIndex + 1, currentIndex + 3)
      .map((item) => item.article.image_url)
      .filter((url): url is string => Boolean(url));

    if (urls.length > 0) {
      void Image.prefetch(urls);
    }
  }, [currentIndex, feed]);

  const resetSwipe = useCallback(() => {
    cardOpenedAt.current = Date.now();
    swipe.setValue({ x: 0, y: 0 });
  }, [swipe]);

  const sendInteraction = useCallback(
    async (type: 'view' | 'skip' | 'click' | 'like' | 'save') => {
      if (!currentItem || !accessToken) return;

      const dwellTimeSeconds = Math.max(
        1,
        Math.round((Date.now() - cardOpenedAt.current) / 1000)
      );

      try {
        await logInteraction(apiBaseUrl, accessToken, {
          article_id: currentItem.article.id,
          interaction_type: type,
          dwell_time_seconds: dwellTimeSeconds,
        });
      } catch (error) {
        Alert.alert(
          'Interaction error',
          error instanceof Error ? error.message : 'Unable to save interaction.'
        );
      }
    },
    [accessToken, apiBaseUrl, currentItem]
  );

  const toggleReaction = useCallback(
    async (type: ReactionType) => {
      if (!currentItem || !accessToken) return;

      const articleId = currentItem.article.id;
      const wasActive = Boolean(activeReactions[articleId]?.[type]);
      setActiveReactions((current) => ({
        ...current,
        [articleId]: {
          ...current[articleId],
          [type]: !wasActive,
        },
      }));

      try {
        if (wasActive) {
          await deleteInteraction(apiBaseUrl, accessToken, {
            article_id: articleId,
            interaction_type: type,
          });
          return;
        }
        const dwellTimeSeconds = Math.max(
          1,
          Math.round((Date.now() - cardOpenedAt.current) / 1000)
        );
        await logInteraction(apiBaseUrl, accessToken, {
          article_id: articleId,
          interaction_type: type,
          dwell_time_seconds: dwellTimeSeconds,
        });
      } catch (error) {
        setActiveReactions((current) => ({
          ...current,
          [articleId]: {
            ...current[articleId],
            [type]: wasActive,
          },
        }));
        Alert.alert(
          'Interaction error',
          error instanceof Error ? error.message : 'Unable to update interaction.'
        );
      }
    },
    [accessToken, activeReactions, apiBaseUrl, currentItem]
  );

  const flingCard = useCallback(
    (direction: 'left' | 'right') => {
      if (direction === 'right' && currentIndex === 0) {
        Animated.spring(swipe, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();
        return;
      }

      const toX = direction === 'left' ? -420 : 420;
      Animated.timing(swipe, {
        toValue: { x: toX, y: 0 },
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setCurrentIndex((value) => {
          if (direction === 'left') {
            return Math.min(value + 1, feed.length);
          }
          return Math.max(value - 1, 0);
        });
        resetSwipe();
      });
    },
    [currentIndex, feed.length, resetSwipe, swipe]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: Animated.event([null, { dx: swipe.x }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -90) {
            flingCard('left');
            return;
          }
          if (gesture.dx > 90) {
            flingCard('right');
            return;
          }
          Animated.spring(swipe, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
        },
      }),
    [flingCard, swipe]
  );

  async function openArticle() {
    if (!currentItem) return;
    await sendInteraction('click');
    await Linking.openURL(currentItem.article.url);
  }

  if (!accessToken) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Text style={styles.emptyKicker}>Morning Brief</Text>
        <Text style={styles.emptyTitle}>Let’s set up your reader</Text>
        <Text style={styles.emptyBody}>
          Create an account, pick interests, and your personalized news cards will land here.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace('/explore')}>
          <Text style={styles.primaryButtonText}>Start setup</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <ActivityIndicator size="large" color="#1268ff" />
      </SafeAreaView>
    );
  }

  if (isCaughtUp) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Text style={styles.caughtUpEmoji}>🌞</Text>
        <Text style={styles.emptyTitle}>You’re all caught up</Text>
        <Text style={styles.emptyBody}>
          That’s the full brief for now. Revisit the last story or reload when new cards are ready.
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            setCurrentIndex(Math.max(feed.length - 1, 0));
            resetSwipe();
          }}
        >
          <Text style={styles.primaryButtonText}>Back to last story</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!currentItem) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No cards yet</Text>
        <Text style={styles.emptyBody}>
          No summarized articles are ready for {userEmail || 'this user'} yet. Run the real news
          pipeline, then generate your feed again.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => void loadFeed(true)}>
          <Text style={styles.primaryButtonText}>Generate feed</Text>
        </Pressable>
        <Pressable style={styles.secondaryEmptyButton} onPress={() => router.replace('/explore')}>
          <Text style={styles.secondaryEmptyButtonText}>Open profile</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const rotate = swipe.x.interpolate({
    inputRange: [-220, 0, 220],
    outputRange: ['-7deg', '0deg', '7deg'],
  });
  const nextOpacity = swipe.x.interpolate({
    inputRange: [-130, -20],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const previousOpacity = swipe.x.interpolate({
    inputRange: [20, 130],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const currentReactions = currentItem ? activeReactions[currentItem.article.id] ?? {} : {};

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Morning Brief</Text>
          <Text style={styles.headerSubtitle}>
            {feedStats.current} of {feedStats.total} for {userEmail || 'you'}
          </Text>
        </View>
        <Pressable style={styles.secondaryButton} onPress={() => void loadFeed(true)}>
          <Text style={styles.secondaryButtonText}>Reload</Text>
        </Pressable>
      </View>

      <View style={styles.cardStage}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.card,
            {
              transform: [{ translateX: swipe.x }, { rotate }],
            },
          ]}
        >
          <Animated.Text style={[styles.swipeBadge, styles.nextBadge, { opacity: nextOpacity }]}>
            NEXT
          </Animated.Text>
          <Animated.Text
            style={[styles.swipeBadge, styles.previousBadge, { opacity: previousOpacity }]}
          >
            PREV
          </Animated.Text>

          {currentItem.article.image_url ? (
            <Image
              source={{ uri: currentItem.article.image_url }}
              style={styles.heroImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.imageFallback}>
              <Text style={styles.imageFallbackText}>
                {currentItem.article.primary_category.toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.cardBody}>
            <View style={styles.metaRow}>
              <View>
                <Text style={styles.categoryPill}>{currentItem.article.primary_category}</Text>
                <Text style={styles.metaText}>{formatArticleDate(currentItem.article.published_at)}</Text>
              </View>
              <View style={styles.reactionRow}>
                <Pressable
                  accessibilityLabel="Like article"
                  style={[
                    styles.reactionButton,
                    currentReactions.like && styles.reactionButtonLikeActive,
                  ]}
                  onPress={() => void toggleReaction('like')}
                >
                  <Text style={[styles.reactionText, currentReactions.like && styles.reactionTextActive]}>
                    👍
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Dislike article"
                  style={[
                    styles.reactionButton,
                    currentReactions.skip && styles.reactionButtonSkipActive,
                  ]}
                  onPress={() => void toggleReaction('skip')}
                >
                  <Text style={[styles.reactionText, currentReactions.skip && styles.reactionTextActive]}>
                    👎
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Save article"
                  style={[
                    styles.reactionButton,
                    currentReactions.save && styles.reactionButtonSaveActive,
                  ]}
                  onPress={() => void toggleReaction('save')}
                >
                  <Text style={[styles.reactionText, currentReactions.save && styles.reactionTextActive]}>
                    🔖
                  </Text>
                </Pressable>
              </View>
            </View>

            <Pressable onPress={() => void openArticle()}>
              <Text style={styles.title}>{currentItem.article.title}</Text>
            </Pressable>
            <Text style={styles.takeaway}>{currentItem.article.summary.main_takeaway}</Text>
          </View>
        </Animated.View>
      </View>

      <View style={styles.swipeHintRow}>
        <Text style={styles.swipeHint}>previous ⇢</Text>
        <Text style={styles.swipeHint}>⇠ next</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fb',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#08090a',
  },
  headerSubtitle: {
    marginTop: 4,
    color: '#5f6673',
    fontSize: 14,
  },
  secondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#e8f1ff',
  },
  secondaryButtonText: {
    color: '#0b4fd6',
    fontWeight: '700',
  },
  cardStage: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  card: {
    minHeight: 580,
    maxHeight: 650,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d8dde8',
    shadowColor: '#0b1220',
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  heroImage: {
    width: '100%',
    height: 230,
    backgroundColor: '#dbe7ff',
  },
  imageFallback: {
    width: '100%',
    height: 230,
    backgroundColor: '#dbe7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallbackText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1268ff',
  },
  cardBody: {
    padding: 20,
    gap: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  categoryPill: {
    textTransform: 'uppercase',
    fontSize: 11,
    fontWeight: '800',
    color: '#f05a28',
  },
  metaText: {
    marginTop: 3,
    fontSize: 12,
    color: '#6d7480',
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    color: '#08090a',
    textDecorationLine: 'underline',
    textDecorationColor: '#9fc1ff',
  },
  takeaway: {
    fontSize: 16,
    lineHeight: 23,
    color: '#2c3036',
    fontWeight: '400',
  },
  swipeBadge: {
    position: 'absolute',
    top: 22,
    zIndex: 5,
    borderRadius: 12,
    borderWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 22,
    fontWeight: '900',
    overflow: 'hidden',
  },
  nextBadge: {
    right: 22,
    color: '#1268ff',
    borderColor: '#1268ff',
    transform: [{ rotate: '8deg' }],
  },
  previousBadge: {
    left: 22,
    color: '#f05a28',
    borderColor: '#f05a28',
    transform: [{ rotate: '-8deg' }],
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  reactionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f1f5fb',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e3e9f3',
  },
  reactionButtonLikeActive: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
    transform: [{ scale: 1.1 }],
  },
  reactionButtonSkipActive: {
    backgroundColor: '#fff1f2',
    borderColor: '#fb7185',
    transform: [{ scale: 1.1 }],
  },
  reactionButtonSaveActive: {
    backgroundColor: '#fff7ed',
    borderColor: '#f97316',
    transform: [{ scale: 1.1 }],
  },
  reactionText: {
    fontSize: 18,
  },
  reactionTextActive: {
    fontSize: 21,
  },
  swipeHintRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingTop: 4,
    paddingBottom: 22,
  },
  swipeHint: {
    color: '#7b8493',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyState: {
    flex: 1,
    backgroundColor: '#f7f8fb',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 16,
  },
  emptyKicker: {
    color: '#1268ff',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#08090a',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 16,
    lineHeight: 24,
    color: '#5f6673',
    textAlign: 'center',
  },
  caughtUpEmoji: {
    fontSize: 48,
  },
  primaryButton: {
    backgroundColor: '#1268ff',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryEmptyButton: {
    borderRadius: 999,
    backgroundColor: '#e8f1ff',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryEmptyButtonText: {
    color: '#0b4fd6',
    fontWeight: '800',
  },
});
