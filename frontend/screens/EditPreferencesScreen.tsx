// full-screen editor for topic and region preferences
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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

const TOPICS = [
  'Business',
  'Entertainment',
  'Health',
  'Science',
  'Sports',
  'Technology',
  'Politics',
  'Crime',
];

const REGIONS = ['United States', 'India', 'World'];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export default function EditPreferencesScreen() {
  const router = useRouter();
  const { accessToken, apiBaseUrl, sessionReady } = useAppSession();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const interestByName = useMemo(() => {
    const map = new Map<string, Interest>();
    interests.forEach((interest) => map.set(normalize(interest.name), interest));
    return map;
  }, [interests]);

  const loadPreferences = useCallback(async () => {
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
      setError('Preferences could not be refreshed.');
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
      void loadPreferences();
    }, [accessToken, loadPreferences, router, sessionReady])
  );

  async function saveSelection(nextIds: number[]) {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    setSelectedInterestIds(nextIds);
    try {
      const saved = await updateInterests(apiBaseUrl, accessToken, nextIds);
      setSelectedInterestIds(saved.map((interest) => interest.id));
    } catch {
      setError('Preference changes could not be saved.');
      void loadPreferences();
    } finally {
      setSaving(false);
    }
  }

  function toggleNamedInterest(name: string) {
    const interest = interestByName.get(normalize(name));
    if (!interest) return;
    const selected = selectedInterestIds.includes(interest.id);
    const nextIds = selected
      ? selectedInterestIds.filter((id) => id !== interest.id)
      : [...selectedInterestIds, interest.id];
    void saveSelection(nextIds);
  }

  function renderPreference(name: string) {
    const interest = interestByName.get(normalize(name));
    const selected = Boolean(interest && selectedInterestIds.includes(interest.id));
    const disabled = !interest || saving;
    return (
      <Pressable
        key={name}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        style={[styles.preferenceRow, disabled && styles.disabled]}
        onPress={() => toggleNamedInterest(name)}
      >
        <Metadata style={styles.preferenceLabel}>{name}</Metadata>
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={21}
          color={selected ? colors.accent : colors.inkMuted}
        />
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to profile" style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={23} color={colors.inkPrimary} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Masthead>THE EDIT</Masthead>
            <View style={styles.rule} />
            <ScreenTitle>Edit Preferences</ScreenTitle>
          </View>
        </View>

        {error ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Metadata style={styles.errorText}>{error}</Metadata>
          </View>
        ) : null}
        {saving ? <Metadata style={styles.saving}>Saving preferences...</Metadata> : null}

        <View style={styles.section}>
          <SectionLabel>Topics</SectionLabel>
          {TOPICS.map(renderPreference)}
        </View>

        <View style={styles.section}>
          <SectionLabel>Regions</SectionLabel>
          {REGIONS.map(renderPreference)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  content: { padding: layout.margin, gap: spacing.lg, paddingBottom: spacing.xxxl },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  backButton: {
    width: layout.minTouch,
    height: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  rule: {
    height: 1,
    backgroundColor: colors.deepBlack,
    opacity: 0.65,
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
  saving: { color: colors.success },
  section: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  preferenceRow: {
    minHeight: layout.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  preferenceLabel: { color: colors.inkPrimary, fontSize: 16 },
  disabled: { opacity: 0.45 },
});
