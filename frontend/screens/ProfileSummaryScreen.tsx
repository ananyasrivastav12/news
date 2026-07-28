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
  ScreenTitle,
  SectionLabel,
} from '@/components/editorial/Typography';
import { useAppSession } from '@/context/AppSessionContext';
import { colors, layout, radius, spacing } from '@/design/tokens';
import { Interest, fetchInterests, fetchMyInterests, updateInterests } from '@/lib/api';

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

export default function ProfileSummaryScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { accessToken, apiBaseUrl, clearSession, sessionReady, userEmail } = useAppSession();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [allInterests, mine] = await Promise.all([
        fetchInterests(apiBaseUrl),
        fetchMyInterests(apiBaseUrl, accessToken),
      ]);
      setInterests(allInterests);
      setSelectedInterestIds(mine.map((interest) => interest.id));
    } catch {
      setError('Your profile could not be refreshed.');
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
          <ScreenTitle style={styles.screenTitle}>Profile</ScreenTitle>
        </View>

        {error ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Metadata style={styles.errorText}>{error}</Metadata>
          </View>
        ) : null}

        <View style={styles.accountBlock}>
          <SectionLabel style={styles.sectionLabel}>Account</SectionLabel>
          <View style={styles.accountRow}>
            <Metadata numberOfLines={1} style={styles.email}>
              {userEmail || 'Signed in'}
            </Metadata>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
              onPress={() => {
                clearSession();
                router.replace('/login');
              }}
            >
              <Ionicons name="log-out-outline" size={22} color={colors.accent} />
            </Pressable>
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
  screenTitle: {
    alignSelf: 'center',
    fontSize: 28,
    lineHeight: 32,
    textAlign: 'center',
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.control,
    padding: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  errorText: { color: colors.error },
  accountBlock: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionLabel: { color: colors.accent },
  accountRow: {
    minHeight: layout.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  email: {
    flex: 1,
    color: colors.inkSecondary,
    fontSize: 16,
    lineHeight: 22,
  },
  signOutButton: {
    width: layout.minTouch,
    height: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surfacePrimary,
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
