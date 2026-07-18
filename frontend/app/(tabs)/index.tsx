import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppSession } from '@/context/AppSessionContext';
import {
  FeedEdition,
  FeedEditionType,
  FeedItem,
  deleteInteraction,
  fetchFeed,
  fetchFeedEditions,
  logInteraction,
} from '@/lib/api';

type ReactionType = 'like' | 'skip' | 'save';
const IMAGE_PREFETCH_BEHIND = 4;
const IMAGE_PREFETCH_AHEAD = 12;
const EDITION_ORDER: FeedEditionType[] = [
  'morning_brief',
  'midday_catch_up',
  'daily_digest',
];

function getMarketTimezone() {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolved === 'Asia/Kolkata' || resolved === 'Asia/Calcutta') {
    return 'Asia/Kolkata';
  }
  return 'America/New_York';
}

function formatEditionLabel(editionType: FeedEditionType) {
  if (editionType === 'morning_brief') return 'Morning';
  if (editionType === 'midday_catch_up') return 'Midday';
  return 'Digest';
}

function formatArticleDate(value: string | null) {
  if (!value) return 'Recent';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function displayTitle(item: FeedItem) {
  const source = item.article.source?.trim();
  if (!source) return item.article.title;
  return item.article.title.replace(new RegExp(`\\s+-\\s+${escapeRegExp(source)}$`, 'i'), '');
}

function displayMarketTimezone(value: string) {
  if (value === 'Asia/Kolkata') return 'India';
  return 'NYC';
}

export default function FeedScreen() {
  const router = useRouter();
  const { accessToken, apiBaseUrl, clearSession, sessionReady, userEmail } =
    useAppSession();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [editions, setEditions] = useState<FeedEdition[]>([]);
  const [selectedFeedDate, setSelectedFeedDate] = useState<string | null>(null);
  const [selectedEditionType, setSelectedEditionType] =
    useState<FeedEditionType | null>(null);
  const selectedFeedDateRef = useRef<string | null>(null);
  const selectedEditionTypeRef = useRef<FeedEditionType | null>(null);
  const marketTimezone = useMemo(() => getMarketTimezone(), []);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeReactions, setActiveReactions] = useState<
    Record<number, Partial<Record<ReactionType, boolean>>>
  >({});
  const viewedArticleIdsRef = useRef<Set<number>>(new Set());
  const cardOpenedAt = useRef<number>(Date.now());
  const animatingRef = useRef(false);
  const swipe = useRef(new Animated.ValueXY()).current;

  const currentItem = feed[currentIndex] ?? null;
  const isCaughtUp = feed.length > 0 && currentIndex >= feed.length;
  const selectedEdition = useMemo(
    () =>
      editions.find(
        (edition) =>
          edition.feed_date === selectedFeedDate &&
          edition.edition_type === selectedEditionType
      ) ?? null,
    [editions, selectedEditionType, selectedFeedDate]
  );
  const activeEditionTitle = selectedEdition?.title ?? 'Morning Brief';
  const warmImageUrls = useMemo(() => {
    const start = Math.max(0, currentIndex - IMAGE_PREFETCH_BEHIND);
    const end = Math.min(feed.length, currentIndex + IMAGE_PREFETCH_AHEAD + 1);
    return feed
      .slice(start, end)
      .map((item) => item.article.image_url)
      .filter((url): url is string => Boolean(url));
  }, [currentIndex, feed]);
  const feedStats = useMemo(
    () => ({
      current: Math.min(currentIndex + 1, feed.length),
      total: feed.length,
    }),
    [currentIndex, feed.length]
  );

  useEffect(() => {
    selectedFeedDateRef.current = selectedFeedDate;
    selectedEditionTypeRef.current = selectedEditionType;
  }, [selectedEditionType, selectedFeedDate]);

  const loadFeed = useCallback(
    async (forceRefresh = false) => {
      if (!accessToken) {
        setFeed([]);
        setCurrentIndex(0);
        setEditions([]);
        setSelectedFeedDate(null);
        setSelectedEditionType(null);
        return;
      }

      setLoading(true);
      try {
        const editionResponse = await fetchFeedEditions(
          apiBaseUrl,
          accessToken,
          marketTimezone
        );
        setEditions(editionResponse.editions);

        const targetFeedDate =
          selectedFeedDateRef.current ?? editionResponse.selected_feed_date;
        const targetEditionType =
          selectedEditionTypeRef.current ?? editionResponse.selected_edition_type;

        if (!targetFeedDate || !targetEditionType) {
          setFeed([]);
          setCurrentIndex(0);
          setSelectedFeedDate(null);
          setSelectedEditionType(null);
          return;
        }

        const items = await fetchFeed(apiBaseUrl, accessToken, forceRefresh, {
          feedDate: targetFeedDate,
          editionType: targetEditionType,
          marketTimezone,
        });
        const firstUnreadIndex = items.findIndex(
          (item) =>
            !item.is_viewed && !viewedArticleIdsRef.current.has(item.article.id)
        );
        setFeed(items);
        setSelectedFeedDate(targetFeedDate);
        setSelectedEditionType(targetEditionType);
        setEditions((current) =>
          current.map((edition) =>
            edition.feed_date === targetFeedDate &&
            edition.edition_type === targetEditionType
              ? {
                  ...edition,
                  is_ready: items.length > 0,
                  total: items.length,
                  unread: items.filter((item) => !item.is_viewed).length,
                  completed:
                    items.length > 0 && items.every((item) => item.is_viewed),
                }
              : edition
          )
        );
        setCurrentIndex(firstUnreadIndex >= 0 ? firstUnreadIndex : 0);
        setActiveReactions({});
        cardOpenedAt.current = Date.now();
        swipe.stopAnimation();
        swipe.setValue({ x: 0, y: 0 });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to load feed.';
        if (
          message.toLowerCase().includes('could not validate credentials') ||
          message.toLowerCase().includes('invalid token') ||
          message.toLowerCase().includes('401')
        ) {
          clearSession();
          router.replace('/explore');
          return;
        }
        Alert.alert(
          'Feed error',
          message
        );
      } finally {
        setLoading(false);
      }
    },
    [
      accessToken,
      apiBaseUrl,
      clearSession,
      marketTimezone,
      router,
      swipe,
    ]
  );

  useFocusEffect(
    useCallback(() => {
      void loadFeed(false);
    }, [loadFeed])
  );

  useEffect(() => {
    if (warmImageUrls.length > 0) {
      void Image.prefetch(warmImageUrls, 'memory-disk');
    }
  }, [warmImageUrls]);

  const selectEdition = useCallback(
    async (edition: FeedEdition) => {
      if (!accessToken) return;

      setLoading(true);
      try {
        const items = await fetchFeed(apiBaseUrl, accessToken, false, {
          feedDate: edition.feed_date,
          editionType: edition.edition_type,
          marketTimezone,
        });
        const firstUnreadIndex = items.findIndex(
          (item) =>
            !item.is_viewed && !viewedArticleIdsRef.current.has(item.article.id)
        );
        setFeed(items);
        setSelectedFeedDate(edition.feed_date);
        setSelectedEditionType(edition.edition_type);
        setEditions((current) =>
          current.map((item) =>
            item.feed_date === edition.feed_date &&
            item.edition_type === edition.edition_type
              ? {
                  ...item,
                  is_ready: items.length > 0,
                  total: items.length,
                  unread: items.filter((feedItem) => !feedItem.is_viewed).length,
                  completed:
                    items.length > 0 && items.every((feedItem) => feedItem.is_viewed),
                }
              : item
          )
        );
        setCurrentIndex(firstUnreadIndex >= 0 ? firstUnreadIndex : 0);
        setActiveReactions({});
        cardOpenedAt.current = Date.now();
        swipe.stopAnimation();
        swipe.setValue({ x: 0, y: 0 });
      } catch (error) {
        Alert.alert(
          'Feed error',
          error instanceof Error ? error.message : 'Unable to load edition.'
        );
      } finally {
        setLoading(false);
      }
    },
    [accessToken, apiBaseUrl, marketTimezone, swipe]
  );

  const resetSwipe = useCallback(() => {
    cardOpenedAt.current = Date.now();
    animatingRef.current = false;
    swipe.stopAnimation();
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
      if (animatingRef.current) return;

      if (direction === 'right' && currentIndex === 0) {
        Animated.spring(swipe, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();
        return;
      }

      animatingRef.current = true;
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
        requestAnimationFrame(resetSwipe);
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
    const articleUrl = currentItem.article.url ?? currentItem.article.original_url;
    if (typeof articleUrl !== 'string' || articleUrl.length === 0) {
      Alert.alert('Article link unavailable', 'This story did not include a valid URL.');
      return;
    }
    await sendInteraction('click');
    await Linking.openURL(articleUrl);
  }

  const markCurrentCardViewed = useCallback(
    (articleId: number) => {
      setFeed((current) =>
        current.map((item) =>
          item.article.id === articleId ? { ...item, is_viewed: true } : item
        )
      );
      setEditions((current) =>
        current.map((edition) => {
          if (
            edition.feed_date !== selectedFeedDate ||
            edition.edition_type !== selectedEditionType ||
            edition.unread === 0
          ) {
            return edition;
          }
          const unread = edition.unread - 1;
          return { ...edition, unread, completed: unread === 0 };
        })
      );
    },
    [selectedEditionType, selectedFeedDate]
  );

  useEffect(() => {
    if (!currentItem || !accessToken) return;

    const articleId = currentItem.article.id;
    if (viewedArticleIdsRef.current.has(articleId) || currentItem.is_viewed) {
      return;
    }

    viewedArticleIdsRef.current.add(articleId);
    markCurrentCardViewed(articleId);
    void logInteraction(apiBaseUrl, accessToken, {
      article_id: articleId,
      interaction_type: 'view',
      dwell_time_seconds: 1,
    }).catch((error) => {
      console.log(
        `[feed] view interaction failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    });
  }, [accessToken, apiBaseUrl, currentItem, markCurrentCardViewed]);

  function renderEditionSwitcher() {
    if (editions.length === 0) return null;

    return (
      <View style={styles.editionSwitcher}>
        {EDITION_ORDER.map((editionType) => {
          const edition = editions.find(
            (item) =>
              item.feed_date === selectedFeedDate && item.edition_type === editionType
          ) ?? editions.find((item) => item.edition_type === editionType);
          const isSelected =
            selectedEditionType === editionType &&
            selectedFeedDate === edition?.feed_date;
          const isReady = Boolean(edition?.is_ready);
          const canOpen = Boolean(
            edition && (isReady || new Date(edition.expected_publish_at) <= new Date())
          );
          return (
            <Pressable
              key={editionType}
              disabled={!canOpen}
              style={[
                styles.editionButton,
                isSelected && styles.editionButtonSelected,
                !canOpen && styles.editionButtonDisabled,
              ]}
              onPress={() => edition && void selectEdition(edition)}
            >
              <Text
                style={[
                  styles.editionButtonText,
                  isSelected && styles.editionButtonTextSelected,
                  !canOpen && styles.editionButtonTextDisabled,
                ]}
              >
                {formatEditionLabel(editionType)}
              </Text>
              <Text
                style={[
                  styles.editionProgressText,
                  isSelected && styles.editionButtonTextSelected,
                  !canOpen && styles.editionButtonTextDisabled,
                ]}
              >
                {edition && isReady
                  ? `${edition.total - edition.unread}/${edition.total}`
                  : canOpen
                    ? 'Load'
                    : 'Pending'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (!sessionReady) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <ActivityIndicator size="large" color="#1268ff" />
      </SafeAreaView>
    );
  }

  if (!accessToken) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Text style={styles.emptyKicker}>Daily Editions</Text>
        <Text style={styles.emptyTitle}>Let’s set up your reader</Text>
        <Text style={styles.emptyBody}>
          Log in with your beta invite, pick interests, and your personalized news cards will land here.
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
        <Text style={styles.caughtUpEmoji}>Done</Text>
        <Text style={styles.emptyTitle}>You’re caught up on {activeEditionTitle}</Text>
        <Text style={styles.emptyBody}>
          That’s the full edition for now. Revisit the last story or check the other editions.
        </Text>
        {renderEditionSwitcher()}
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
          No edition is ready for {userEmail || 'this user'} in {displayMarketTimezone(marketTimezone)} yet.
        </Text>
        {renderEditionSwitcher()}
        <Pressable style={styles.primaryButton} onPress={() => void loadFeed(true)}>
          <Text style={styles.primaryButtonText}>Check again</Text>
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
  const currentReactions = currentItem ? activeReactions[currentItem.article.id] ?? {} : {};

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{activeEditionTitle}</Text>
          <Text style={styles.headerSubtitle}>
            {feedStats.current} of {feedStats.total} for {userEmail || 'you'}
          </Text>
        </View>
        <Pressable style={styles.secondaryButton} onPress={() => void loadFeed(true)}>
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {renderEditionSwitcher()}

      <View style={styles.cardStage}>
        <Animated.View
          key={currentItem.id}
          {...panResponder.panHandlers}
          style={[
            styles.card,
            {
              transform: [{ translateX: swipe.x }, { rotate }],
            },
          ]}
        >
          {currentItem.article.image_url ? (
            <Image
              source={{ uri: currentItem.article.image_url }}
              style={styles.heroImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              priority="high"
              recyclingKey={String(currentItem.article.id)}
              transition={0}
            />
          ) : (
            <View style={styles.imageFallback}>
              <Text style={styles.imageFallbackText}>
                {currentItem.article.primary_category.toUpperCase()}
              </Text>
            </View>
          )}

          <ScrollView
            style={styles.cardBodyScroll}
            contentContainerStyle={styles.cardBody}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
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
              <Text style={styles.title}>
                {displayTitle(currentItem)}
              </Text>
            </Pressable>
            <Text style={styles.sourceText}>{currentItem.article.source || 'News source'}</Text>
            <Text style={styles.takeaway}>
              {currentItem.article.summary.main_takeaway}
            </Text>
          </ScrollView>
        </Animated.View>
      </View>
      <Text style={styles.swipeHint}>Swipe left for next. Swipe right to go back.</Text>
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
    paddingTop: 6,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 27,
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
  editionSwitcher: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    gap: 8,
  },
  editionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8dde8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editionButtonSelected: {
    backgroundColor: '#1268ff',
    borderColor: '#1268ff',
  },
  editionButtonDisabled: {
    backgroundColor: '#eef1f6',
  },
  editionButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#172033',
  },
  editionButtonTextSelected: {
    color: '#ffffff',
  },
  editionButtonTextDisabled: {
    color: '#818998',
  },
  editionProgressText: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
    color: '#667085',
  },
  cardStage: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  card: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#ffffff',
    borderRadius: 20,
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
    height: 170,
    backgroundColor: '#dbe7ff',
  },
  imageFallback: {
    width: '100%',
    height: 170,
    backgroundColor: '#dbe7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallbackText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1268ff',
  },
  cardBodyScroll: {
    flex: 1,
  },
  cardBody: {
    padding: 18,
    gap: 8,
    paddingBottom: 24,
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
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    color: '#08090a',
    textDecorationLine: 'underline',
    textDecorationColor: '#9fc1ff',
  },
  sourceText: {
    color: '#6d7480',
    fontSize: 12,
    fontWeight: '700',
  },
  takeaway: {
    fontSize: 16,
    lineHeight: 24,
    color: '#2c3036',
    fontWeight: '400',
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  reactionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
  swipeHint: {
    color: '#7b8493',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    paddingTop: 2,
    paddingBottom: 12,
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
    fontSize: 24,
    fontWeight: '900',
    color: '#1268ff',
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
