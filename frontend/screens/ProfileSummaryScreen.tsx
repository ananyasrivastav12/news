// profile screen for account and quick preference toggles
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Masthead,
  Metadata,
  SectionLabel,
} from '@/components/editorial/Typography';
import { useAppSession } from '@/context/AppSessionContext';
import { colors, layout, radius, shadows, spacing } from '@/design/tokens';
import {
  FeedEdition,
  Interest,
  ProfileSummary,
  fetchFeedEditions,
  fetchInterests,
  fetchMyInterests,
  fetchProfileSummary,
  updateInterests,
} from '@/lib/api';

const SECTIONS = [
  'Business',
  'Entertainment',
  'Health',
  'Science',
  'Sports',
  'Technology',
  'Politics',
  'Crime',
];

const AREAS = ['United States', 'India', 'World'];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function selectedCountLabel(count: number) {
  return `${count} ${count === 1 ? 'selected' : 'selected'}`;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function getMarketTimezone() {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolved === 'Asia/Kolkata' || resolved === 'Asia/Calcutta') return 'Asia/Kolkata';
  return 'America/New_York';
}

function latestReadyEdition(editions: FeedEdition[]) {
  return editions
    .filter((edition) => edition.total > 0)
    .sort(
      (left, right) =>
        Date.parse(right.expected_publish_at) - Date.parse(left.expected_publish_at)
    )[0];
}

export default function ProfileSummaryScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { accessToken, apiBaseUrl, clearSession, sessionReady, userEmail } = useAppSession();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<number[]>([]);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [latestFeedStats, setLatestFeedStats] = useState<{ total: number; unread: number } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marketTimezone = useMemo(() => getMarketTimezone(), []);
  const cardWidth = Math.min(width - 56, 360);
  const chromeWidth = Math.min(width - 40, cardWidth + 16);
  const sectionChipWidth = (chromeWidth - spacing.sm) / 2;
  const areaChipWidth = Math.floor((chromeWidth - spacing.sm * 2) / 3);

  const interestByName = useMemo(() => {
    const map = new Map<string, Interest>();
    interests.forEach((interest) => map.set(normalize(interest.name), interest));
    return map;
  }, [interests]);

  const sectionInterests = useMemo(
    () =>
      SECTIONS.map((name) => interestByName.get(normalize(name))).filter(
        (interest): interest is Interest => Boolean(interest)
      ),
    [interestByName]
  );

  const areaInterests = useMemo(
    () =>
      AREAS.map((name) => interestByName.get(normalize(name))).filter(
        (interest): interest is Interest => Boolean(interest)
      ),
    [interestByName]
  );

  const selectedSectionsCount = sectionInterests.filter((interest) =>
    selectedInterestIds.includes(interest.id)
  ).length;
  const selectedAreasCount = areaInterests.filter((interest) =>
    selectedInterestIds.includes(interest.id)
  ).length;
  const signalCounts = profileSummary?.signal_counts;
  const todayFeed = profileSummary?.today_feed;
  const feedStats = latestFeedStats ?? todayFeed;

  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [allInterests, mine, nextSummary, editionResponse] = await Promise.all([
        fetchInterests(apiBaseUrl),
        fetchMyInterests(apiBaseUrl, accessToken),
        fetchProfileSummary(apiBaseUrl, accessToken),
        fetchFeedEditions(apiBaseUrl, accessToken, marketTimezone).catch(() => null),
      ]);
      setInterests(allInterests);
      setSelectedInterestIds(mine.map((interest) => interest.id));
      setProfileSummary(nextSummary);
      const latestEdition = editionResponse
        ? latestReadyEdition(editionResponse.editions)
        : null;
      setLatestFeedStats(
        latestEdition
          ? { total: latestEdition.total, unread: latestEdition.unread }
          : null
      );
    } catch {
      setProfileSummary(null);
      setLatestFeedStats(null);
      setError('Your profile could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, apiBaseUrl, marketTimezone]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionReady) return;
      if (!accessToken) {
        router.replace('/login');
        return;
      }
      void loadProfile();
    }, [accessToken, loadProfile, router, sessionReady])
  );

  async function toggleInterest(interest: Interest) {
    if (!accessToken || savingId !== null) return;
    const previousIds = selectedInterestIds;
    const selected = previousIds.includes(interest.id);
    const nextIds = selected
      ? previousIds.filter((id) => id !== interest.id)
      : [...previousIds, interest.id];

    setSavingId(interest.id);
    setError(null);
    setSelectedInterestIds(nextIds);
    try {
      const saved = await updateInterests(apiBaseUrl, accessToken, nextIds);
      setSelectedInterestIds(saved.map((item) => item.id));
      setProfileSummary((current) =>
        current ? { ...current, interests: saved.map((item) => item.name) } : current
      );
      AccessibilityInfo.announceForAccessibility(
        `${interest.name} ${selected ? 'removed' : 'selected'}`
      );
    } catch {
      setSelectedInterestIds(previousIds);
      setError('Preference changes could not be saved.');
    } finally {
      setSavingId(null);
    }
  }

  function renderChip(interest: Interest, chipWidth: number, displayName = interest.name) {
    const selected = selectedInterestIds.includes(interest.id);
    const saving = savingId === interest.id;
    const disabled = savingId !== null;
    return (
      <Pressable
        key={interest.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={() => void toggleInterest(interest)}
        style={({ pressed }) => [
          styles.chip,
          { width: chipWidth },
          selected && styles.chipSelected,
          disabled && !saving && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Metadata numberOfLines={1} style={[styles.chipText, selected && styles.chipTextSelected]}>
          {displayName}
        </Metadata>
        {saving ? (
          <View style={styles.chipCheck}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : selected ? (
          <Ionicons style={styles.chipCheck} name="checkmark-circle" size={17} color={colors.accent} />
        ) : null}
      </Pressable>
    );
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
        </View>

        {error ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Metadata style={styles.errorText}>{error}</Metadata>
          </View>
        ) : null}

        <View style={styles.readerPanel}>
          <View style={styles.readerTop}>
            <View style={styles.avatar}>
              <Ionicons name="person-circle-outline" size={30} color={colors.accent} />
            </View>
            <View style={styles.readerCopy}>
              <SectionLabel style={styles.sectionLabel}>Reader profile</SectionLabel>
              <Metadata numberOfLines={1} style={styles.email}>
                {userEmail || 'Signed in'}
              </Metadata>
              <Metadata style={styles.profileLine}>
                {selectedInterestIds.length} selected{' '}
                {selectedInterestIds.length === 1 ? 'interest' : 'interests'}
              </Metadata>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
              onPress={() => {
                clearSession();
                router.replace('/login');
              }}
            >
              <Ionicons name="log-out-outline" size={21} color={colors.accent} />
            </Pressable>
          </View>

          <View style={styles.statsGrid}>
            <ProfileStat
              icon="bookmark-outline"
              label="Saved"
              value={formatCount(signalCounts?.saved ?? 0)}
            />
            <ProfileStat
              icon="newspaper-outline"
              label="Read"
              value={formatCount(signalCounts?.viewed ?? 0)}
            />
            <ProfileStat
              icon="thumbs-up-outline"
              label="Liked"
              value={formatCount(signalCounts?.liked ?? 0)}
            />
            <ProfileStat
              icon="time-outline"
              label="Unread"
              value={formatCount(feedStats?.unread ?? 0)}
            />
          </View>
        </View>

        <PreferenceGroup label="Areas" count={selectedAreasCount}>
          <View style={[styles.chipGrid, styles.areaChipGrid]}>
            {areaInterests.map((interest) =>
              renderChip(
                interest,
                areaChipWidth,
                normalize(interest.name) === 'united states' ? 'US' : interest.name
              )
            )}
          </View>
        </PreferenceGroup>

        <PreferenceGroup
          label="Sections"
          count={selectedSectionsCount}
        >
          <View style={styles.chipGrid}>
            {sectionInterests.map((interest) => renderChip(interest, sectionChipWidth))}
          </View>
        </PreferenceGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileStat({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statCell}>
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Metadata numberOfLines={1} style={styles.statValue}>
        {value}
      </Metadata>
      <Metadata numberOfLines={1} style={styles.statLabel}>
        {label}
      </Metadata>
    </View>
  );
}

function PreferenceGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.preferenceGroup}>
      <View style={styles.groupHeader}>
        <SectionLabel style={styles.sectionLabel}>{label}</SectionLabel>
        <Metadata style={styles.groupSummary}>
          {selectedCountLabel(count)}
        </Metadata>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  content: {
    alignSelf: 'center',
    gap: spacing.xl,
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
  banner: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.control,
    padding: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  errorText: { color: colors.error },
  sectionLabel: { color: colors.accent },
  readerPanel: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(21, 20, 18, 0.16)',
    borderRadius: radius.card + 2,
    backgroundColor: colors.surfacePrimary,
    padding: spacing.md,
    ...shadows.card,
  },
  readerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  readerCopy: {
    flex: 1,
    minWidth: 0,
  },
  email: {
    color: colors.inkPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  profileLine: {
    color: colors.inkSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  signOutButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surfacePrimary,
  },
  statsGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  statValue: {
    color: colors.inkPrimary,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.inkSecondary,
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  preferenceGroup: {
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  groupHeader: {
    gap: spacing.xxs,
  },
  groupSummary: {
    color: colors.inkSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  areaChipGrid: {
    flexWrap: 'nowrap',
  },
  chip: {
    position: 'relative',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surfacePrimary,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipText: {
    color: colors.inkSecondary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  chipCheck: {
    position: 'absolute',
    right: spacing.xs,
  },
  chipTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.72 },
});
