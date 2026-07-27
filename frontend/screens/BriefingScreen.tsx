import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/editorial/EmptyState';
import { EditionSelector } from '@/components/editorial/EditionSelector';
import { StoryCard } from '@/components/editorial/StoryCard';
import { Masthead, Metadata } from '@/components/editorial/Typography';
import { useAppSession } from '@/context/AppSessionContext';
import { colors, layout, motion, spacing } from '@/design/tokens';
import { feedItemToBriefingStory } from '@/lib/briefingStory';
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

function getMarketTimezone() {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolved === 'Asia/Kolkata' || resolved === 'Asia/Calcutta') return 'Asia/Kolkata';
  return 'America/New_York';
}

function isCredentialError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('could not validate credentials') ||
    normalized.includes('invalid token') ||
    normalized.includes('401')
  );
}

function isNetworkError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('internet') ||
    normalized.includes('offline')
  );
}

export default function BriefingScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { accessToken, apiBaseUrl, clearSession, sessionReady } = useAppSession();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [editions, setEditions] = useState<FeedEdition[]>([]);
  const [selectedFeedDate, setSelectedFeedDate] = useState<string | null>(null);
  const [selectedEditionType, setSelectedEditionType] = useState<FeedEditionType | null>(null);
  const selectedFeedDateRef = useRef<string | null>(null);
  const selectedEditionTypeRef = useRef<FeedEditionType | null>(null);
  const marketTimezone = useMemo(() => getMarketTimezone(), []);
  const [loading, setLoading] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeReactions, setActiveReactions] = useState<
    Record<number, Partial<Record<ReactionType, boolean>>>
  >({});
  const [reduceMotion, setReduceMotion] = useState(false);
  const viewedArticleIdsRef = useRef<Set<number>>(new Set());
  const cardOpenedAt = useRef<number>(Date.now());
  const animatingRef = useRef(false);
  const hasLoadedFeedRef = useRef(false);
  const swipe = useRef(new Animated.ValueXY()).current;

  const currentItem = feed[currentIndex] ?? null;
  const story = currentItem ? feedItemToBriefingStory(currentItem) : null;
  const fixedCardWidth = Math.min(width - 56, 360);
  const chromeWidth = Math.min(width - 40, fixedCardWidth + 16);
  const fixedCardHeight = Math.min(620, Math.max(520, height * 0.64));
  const isCaughtUp = feed.length > 0 && currentIndex >= feed.length;
  const warmImageUrls = useMemo(() => {
    const start = Math.max(0, currentIndex - IMAGE_PREFETCH_BEHIND);
    const end = Math.min(feed.length, currentIndex + IMAGE_PREFETCH_AHEAD + 1);
    return feed
      .slice(start, end)
      .map((item) => item.article.image_url)
      .filter((url): url is string => Boolean(url));
  }, [currentIndex, feed]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    selectedFeedDateRef.current = selectedFeedDate;
    selectedEditionTypeRef.current = selectedEditionType;
  }, [selectedEditionType, selectedFeedDate]);

  const resetSwipe = useCallback(() => {
    cardOpenedAt.current = Date.now();
    animatingRef.current = false;
    swipe.stopAnimation();
    swipe.setValue({ x: 0, y: 0 });
  }, [swipe]);

  const loadFeed = useCallback(
    async (forceRefresh = false) => {
      if (!accessToken) {
        hasLoadedFeedRef.current = false;
        setFeed([]);
        setCurrentIndex(0);
        setEditions([]);
        setSelectedFeedDate(null);
        setSelectedEditionType(null);
        return;
      }

      setLoading(true);
      setRefreshFailure(null);
      try {
        const editionResponse = await fetchFeedEditions(apiBaseUrl, accessToken, marketTimezone);
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
          (item) => !item.is_viewed && !viewedArticleIdsRef.current.has(item.article.id)
        );
        setFeed(items);
        setSelectedFeedDate(targetFeedDate);
        setSelectedEditionType(targetEditionType);
        setEditions((current) =>
          current.map((edition) =>
            edition.feed_date === targetFeedDate && edition.edition_type === targetEditionType
              ? {
                  ...edition,
                  is_ready: items.length > 0,
                  total: items.length,
                  unread: items.filter((item) => !item.is_viewed).length,
                  completed: items.length > 0 && items.every((item) => item.is_viewed),
                }
              : edition
          )
        );
        setCurrentIndex(firstUnreadIndex >= 0 ? firstUnreadIndex : 0);
        setActiveReactions({});
        hasLoadedFeedRef.current = true;
        resetSwipe();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your briefing.';
        if (isCredentialError(message)) {
          clearSession();
          router.replace('/login');
          return;
        }
        setRefreshFailure(
          isNetworkError(message)
            ? 'You appear to be offline. Reconnect and try again.'
            : 'The briefing could not refresh. Try again in a moment.'
        );
      } finally {
        setLoading(false);
      }
    },
    [accessToken, apiBaseUrl, clearSession, marketTimezone, resetSwipe, router]
  );

  useFocusEffect(
    useCallback(() => {
      if (!accessToken || hasLoadedFeedRef.current) return;
      void loadFeed(false);
    }, [accessToken, loadFeed])
  );

  useEffect(() => {
    if (warmImageUrls.length > 0) void Image.prefetch(warmImageUrls, 'memory-disk');
  }, [warmImageUrls]);

  const selectEdition = useCallback(
    async (edition: FeedEdition) => {
      if (!accessToken) return;
      setLoading(true);
      setRefreshFailure(null);
      try {
        const items = await fetchFeed(apiBaseUrl, accessToken, false, {
          feedDate: edition.feed_date,
          editionType: edition.edition_type,
          marketTimezone,
        });
        const firstUnreadIndex = items.findIndex(
          (item) => !item.is_viewed && !viewedArticleIdsRef.current.has(item.article.id)
        );
        setFeed(items);
        setSelectedFeedDate(edition.feed_date);
        setSelectedEditionType(edition.edition_type);
        setCurrentIndex(firstUnreadIndex >= 0 ? firstUnreadIndex : 0);
        setActiveReactions({});
        hasLoadedFeedRef.current = true;
        resetSwipe();
      } catch (error) {
        setRefreshFailure(error instanceof Error ? error.message : 'Unable to load that edition.');
      } finally {
        setLoading(false);
      }
    },
    [accessToken, apiBaseUrl, marketTimezone, resetSwipe]
  );

  const sendInteraction = useCallback(
    async (type: 'view' | 'skip' | 'click' | 'like' | 'save') => {
      if (!currentItem || !accessToken) return;
      const dwellTimeSeconds = Math.max(
        1,
        Math.round((Date.now() - cardOpenedAt.current) / 1000)
      );
      await logInteraction(apiBaseUrl, accessToken, {
        article_id: currentItem.article.id,
        interaction_type: type,
        dwell_time_seconds: dwellTimeSeconds,
      });
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
        [articleId]: { ...current[articleId], [type]: !wasActive },
      }));

      const nextFeedback =
        type === 'skip'
          ? "We'll show fewer stories like this."
          : type === 'save'
            ? 'Saved for later.'
            : "We'll show more stories like this.";
      AccessibilityInfo.announceForAccessibility(nextFeedback);
      if (type === 'save' && !wasActive) void Haptics.selectionAsync();

      try {
        if (wasActive) {
          await deleteInteraction(apiBaseUrl, accessToken, {
            article_id: articleId,
            interaction_type: type,
          });
          return;
        }
        await sendInteraction(type);
      } catch {
        setActiveReactions((current) => ({
          ...current,
          [articleId]: { ...current[articleId], [type]: wasActive },
        }));
        AccessibilityInfo.announceForAccessibility('That action could not be saved.');
      }
    },
    [accessToken, activeReactions, apiBaseUrl, currentItem, sendInteraction]
  );

  const flingCard = useCallback(
    (direction: 'left' | 'right', verticalOffset = 0) => {
      if (animatingRef.current) return;
      if (direction === 'right' && currentIndex === 0) {
        resetSwipe();
        return;
      }

      animatingRef.current = true;
      const exitX = direction === 'left' ? -720 : 720;
      const exitY = Math.max(-90, Math.min(90, verticalOffset * 0.45));
      Animated.timing(swipe, {
        toValue: { x: reduceMotion ? 0 : exitX, y: reduceMotion ? 0 : exitY },
        duration: reduceMotion ? motion.quickMs : 270,
        useNativeDriver: true,
      }).start(() => {
        setCurrentIndex((value) =>
          direction === 'left' ? Math.min(value + 1, feed.length) : Math.max(value - 1, 0)
        );
        requestAnimationFrame(resetSwipe);
      });
    },
    [currentIndex, feed.length, reduceMotion, resetSwipe, swipe]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: reduceMotion
          ? undefined
          : Animated.event([null, { dx: swipe.x, dy: swipe.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          const shouldFling = Math.abs(gesture.dx) > 96 || Math.abs(gesture.vx) > 0.58;
          if (shouldFling && gesture.dx < 0) return flingCard('left', gesture.dy);
          if (shouldFling && gesture.dx > 0) return flingCard('right', gesture.dy);
          Animated.spring(swipe, {
            toValue: { x: 0, y: 0 },
            friction: 7,
            tension: 75,
            useNativeDriver: true,
          }).start(() => resetSwipe());
        },
      }),
    [flingCard, reduceMotion, resetSwipe, swipe]
  );

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
    if (viewedArticleIdsRef.current.has(articleId) || currentItem.is_viewed) return;

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

  async function openOriginalArticle() {
    if (!story) return;
    if (!story.sourceUrl) {
      setRefreshFailure('Original article is unavailable.');
      return;
    }
    void sendInteraction('click').catch(() => {});
    try {
      await Linking.openURL(story.sourceUrl);
    } catch {
      setRefreshFailure('Original article could not be opened.');
    }
  }

  if (!sessionReady) {
    return (
      <SafeAreaView style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!accessToken) {
    return (
      <EmptyState
        icon="newspaper-outline"
        title="Set up your reader"
        body="Sign in with your beta invitation to start your personalized briefing."
        actionLabel="Continue"
        onAction={() => router.replace('/login')}
      />
    );
  }

  if (loading && feed.length === 0) {
    return (
      <SafeAreaView style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Loading your briefing" />
        <Metadata style={styles.loadingText}>Preparing your briefing</Metadata>
      </SafeAreaView>
    );
  }

  if (isCaughtUp) {
    return (
      <EmptyState
        icon="checkmark-circle-outline"
        title="You are caught up"
        body="That is the full edition for now. You can revisit the last story or switch editions."
        actionLabel="Back to last story"
        onAction={() => {
          setCurrentIndex(Math.max(feed.length - 1, 0));
          resetSwipe();
        }}
      />
    );
  }

  if (!story) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={[styles.headerCopy, { width: chromeWidth }]}>
            <View style={styles.brandRow}>
              <Masthead>THE EDIT</Masthead>
              <Pressable accessibilityRole="button" accessibilityLabel="Refresh briefing" style={styles.refreshButton} onPress={() => void loadFeed(true)}>
                <Ionicons name="refresh" size={23} color={colors.accent} />
              </Pressable>
            </View>
            <View style={styles.rule} />
          </View>
        </View>
        <View style={[styles.selectorWrap, { width: chromeWidth }]}>
          <EditionSelector editions={editions} selectedFeedDate={selectedFeedDate} selectedEditionType={selectedEditionType} onSelect={(edition) => void selectEdition(edition)} />
        </View>
        <View style={[styles.emptyWrap, { width: chromeWidth }]}>
          <EmptyState
            icon={refreshFailure ? 'cloud-offline-outline' : 'time-outline'}
            title={refreshFailure ? 'Refresh failed' : 'No stories yet'}
            body={refreshFailure ?? 'This edition is not ready yet. Check back soon or choose another edition.'}
            actionLabel="Check again"
            onAction={() => void loadFeed(true)}
          />
        </View>
      </SafeAreaView>
    );
  }

  const currentReactions = activeReactions[currentItem?.article.id ?? -1] ?? {};
  const rotate = swipe.x.interpolate({
    inputRange: [-260, 0, 260],
    outputRange: ['-8deg', '0deg', '8deg'],
    extrapolate: 'clamp',
  });
  const verticalTravel = swipe.y.interpolate({
    inputRange: [-140, 0, 140],
    outputRange: [-18, 0, 18],
    extrapolate: 'clamp',
  });
  const animatedStyle = reduceMotion
    ? {
        opacity: swipe.x.interpolate({ inputRange: [-220, 0, 220], outputRange: [0.35, 1, 0.35] }),
      }
    : {
        opacity: swipe.x.interpolate({ inputRange: [-320, 0, 320], outputRange: [0.84, 1, 0.84] }),
        transform: [{ translateX: swipe.x }, { translateY: verticalTravel }, { rotate }],
      };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={[styles.headerCopy, { width: chromeWidth }]}>
          <View style={styles.brandRow}>
            <Masthead>THE EDIT</Masthead>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh briefing" style={styles.refreshButton} onPress={() => void loadFeed(true)}>
              {loading ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="refresh" size={22} color={colors.accent} />}
            </Pressable>
          </View>
          <View style={styles.rule} />
        </View>
      </View>

      <View style={[styles.selectorWrap, { width: chromeWidth }]}>
        <EditionSelector editions={editions} selectedFeedDate={selectedFeedDate} selectedEditionType={selectedEditionType} onSelect={(edition) => void selectEdition(edition)} />
      </View>

      {refreshFailure ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Metadata style={styles.bannerText}>{refreshFailure}</Metadata>
        </View>
      ) : null}

      <View style={styles.cardStage}>
        <Animated.View
          key={story.id}
          {...panResponder.panHandlers}
          style={[
            styles.animatedCard,
            { width: fixedCardWidth, height: fixedCardHeight },
            animatedStyle,
          ]}
        >
          <StoryCard
            story={story}
            compact
            lessSelected={currentReactions.skip}
            savedSelected={currentReactions.save}
            moreSelected={currentReactions.like}
            onOpen={() => void openOriginalArticle()}
            onLess={() => void toggleReaction('skip')}
            onSave={() => void toggleReaction('save')}
            onMore={() => void toggleReaction('like')}
          />
        </Animated.View>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.swipeHint, { width: fixedCardWidth }]}
        >
          <Ionicons name="arrow-undo-outline" size={18} color={colors.inkMuted} />
          <Ionicons name="arrow-redo-outline" size={18} color={colors.inkMuted} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.canvas,
  },
  loadingText: { color: colors.inkSecondary },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    alignItems: 'center',
    zIndex: 2,
  },
  headerCopy: {},
  brandRow: {
    minHeight: layout.iconButton,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rule: {
    height: 1,
    backgroundColor: colors.deepBlack,
    opacity: 0.65,
  },
  refreshButton: {
    width: layout.iconButton,
    height: layout.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorWrap: {
    alignSelf: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    zIndex: 2,
  },
  banner: {
    marginHorizontal: layout.margin,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    padding: spacing.sm,
  },
  bannerText: { color: colors.accentPressed },
  cardStage: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 0,
    paddingBottom: 124,
    justifyContent: 'flex-start',
    overflow: 'hidden',
    zIndex: 1,
  },
  animatedCard: {},
  swipeHint: {
    height: 22,
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    opacity: 0.46,
  },
  emptyWrap: { flex: 1, alignSelf: 'center', gap: spacing.md },
});
