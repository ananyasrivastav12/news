// profile screen for account and quick preference toggles
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ButtonText,
  Masthead,
  Metadata,
  SectionLabel,
} from '@/components/editorial/Typography';
import { useAppSession } from '@/context/AppSessionContext';
import { colors, layout, radius, shadows, spacing } from '@/design/tokens';
import {
  Interest,
  ProfileSummary,
  changePassword,
  createSupportMessage,
  deleteMyAccount,
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

export default function ProfileSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { accessToken, apiBaseUrl, clearSession, sessionReady, userEmail } = useAppSession();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<number[]>([]);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [supportStatus, setSupportStatus] = useState('');
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<'password' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cardWidth = Math.min(width - 56, 360);
  const chromeWidth = Math.min(width - 40, cardWidth + 16);
  const bottomPadding = Math.max(190, layout.tabBarHeight + insets.bottom + 112);
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

  useEffect(() => {
    if (!supportStatus.includes('sent')) return;
    const timeoutId = setTimeout(() => setSupportStatus(''), 3200);
    return () => clearTimeout(timeoutId);
  }, [supportStatus]);

  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [allInterests, mine, nextSummary] = await Promise.all([
        fetchInterests(apiBaseUrl),
        fetchMyInterests(apiBaseUrl, accessToken),
        fetchProfileSummary(apiBaseUrl, accessToken),
      ]);
      setInterests(allInterests);
      setSelectedInterestIds(mine.map((interest) => interest.id));
      setProfileSummary(nextSummary);
    } catch {
      setProfileSummary(null);
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

  async function submitSupportMessage() {
    if (!accessToken || supportSubmitting) return;
    const message = supportMessage.trim();
    setSupportStatus('');
    if (!message) {
      setSupportStatus('Write a short message first.');
      return;
    }
    setSupportSubmitting(true);
    try {
      await createSupportMessage(apiBaseUrl, accessToken, {
        subject: 'Profile support request',
        message,
      });
      setSupportMessage('');
      setSupportOpen(false);
      setSupportStatus('Message sent to admin.');
      AccessibilityInfo.announceForAccessibility('Message sent to admin.');
    } catch {
      setSupportStatus('Message could not be sent. Try again.');
    } finally {
      setSupportSubmitting(false);
    }
  }

  async function submitPasswordChange() {
    if (!accessToken || accountSubmitting) return;
    setAccountStatus('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setAccountStatus('Fill out all password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setAccountStatus('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setAccountStatus('New passwords do not match.');
      return;
    }
    setAccountSubmitting(true);
    try {
      await changePassword(apiBaseUrl, accessToken, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setAccountMode(null);
      setAccountStatus('Password updated.');
    } catch {
      setAccountStatus('Password could not be updated.');
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function submitAccountDelete() {
    if (!accessToken || accountSubmitting) return;
    if (!deletePassword) {
      setAccountStatus('Enter your password to delete the account.');
      return;
    }
    Alert.alert(
      'Delete account?',
      'This removes your account, saved stories, feed cards, and preferences.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void confirmAccountDelete();
          },
        },
      ]
    );
  }

  async function confirmAccountDelete() {
    if (!accessToken || accountSubmitting) return;
    setAccountSubmitting(true);
    setAccountStatus('');
    try {
      await deleteMyAccount(apiBaseUrl, accessToken, { password: deletePassword });
      clearSession();
      router.replace('/login');
    } catch {
      setAccountStatus('Account could not be deleted.');
    } finally {
      setAccountSubmitting(false);
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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { width: chromeWidth, paddingBottom: bottomPadding },
        ]}
      >
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
            <ContactStat
              active={supportOpen}
              onPress={() => {
                setSupportOpen((value) => !value);
                setSupportStatus('');
              }}
            />
          </View>
        </View>

        {supportStatus ? (
          <View style={styles.supportStatus} accessibilityLiveRegion="polite">
            <Metadata
              style={[
                styles.supportStatusText,
                supportStatus.includes('sent') && styles.supportStatusSuccess,
              ]}
            >
              {supportStatus}
            </Metadata>
          </View>
        ) : null}

        {supportOpen ? (
          <View style={styles.supportPanel}>
            <SectionLabel style={styles.sectionLabel}>Contact admin</SectionLabel>
            <TextInput
              value={supportMessage}
              onChangeText={setSupportMessage}
              multiline
              maxLength={2000}
              style={styles.supportInput}
              placeholder="Tell the admin what happened."
              placeholderTextColor={colors.inkMuted}
              textAlignVertical="top"
              accessibilityLabel="Support message"
            />
            <View style={styles.supportActions}>
              <Pressable
                accessibilityRole="button"
                disabled={supportSubmitting}
                style={({ pressed }) => [
                  styles.supportSecondaryButton,
                  supportSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  setSupportOpen(false);
                  setSupportStatus('');
                }}
              >
                <ButtonText style={styles.supportSecondaryText}>Cancel</ButtonText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={supportSubmitting}
                style={({ pressed }) => [
                  styles.supportSendButton,
                  supportSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void submitSupportMessage()}
              >
                {supportSubmitting ? (
                  <ActivityIndicator color={colors.surfacePrimary} />
                ) : (
                  <ButtonText style={styles.supportSendText}>Send</ButtonText>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

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

        <View style={styles.accountPanel}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account settings"
            accessibilityState={{ expanded: accountOpen }}
            style={({ pressed }) => [styles.accountSettingsRow, pressed && styles.pressed]}
            onPress={() => {
              setAccountOpen((value) => !value);
              setAccountMode(null);
              setAccountStatus('');
            }}
          >
            <View style={styles.accountSettingsCopy}>
              <Ionicons name="settings-outline" size={17} color={colors.accent} />
              <Metadata style={styles.accountSettingsText}>Account settings</Metadata>
            </View>
            {accountStatus ? (
              <Metadata
                numberOfLines={1}
                style={[
                  styles.accountInlineStatus,
                  accountStatus.includes('updated') && styles.supportStatusSuccess,
                ]}
              >
                {accountStatus}
              </Metadata>
            ) : (
              <Ionicons
                name={accountOpen ? 'chevron-up' : 'chevron-down'}
                size={17}
                color={colors.inkSecondary}
              />
            )}
          </Pressable>

          {accountOpen ? (
            <View style={styles.accountActionRow}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.accountActionButton,
                  accountMode === 'password' && styles.accountActionActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  setAccountMode((mode) => (mode === 'password' ? null : 'password'));
                  setAccountStatus('');
                }}
              >
                <Ionicons name="key-outline" size={15} color={colors.accent} />
                <Metadata style={styles.accountActionText}>Password</Metadata>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.accountActionButton,
                  styles.accountDeleteButton,
                  accountMode === 'delete' && styles.accountDeleteActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  setAccountMode((mode) => (mode === 'delete' ? null : 'delete'));
                  setAccountStatus('');
                }}
              >
                <Ionicons name="trash-outline" size={15} color={colors.error} />
                <Metadata style={[styles.accountActionText, styles.accountDeleteText]}>
                  Delete
                </Metadata>
              </Pressable>
            </View>
          ) : null}

          {accountOpen && accountMode === 'password' ? (
            <View style={styles.accountForm}>
              <TextInput
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                style={styles.accountInput}
                placeholder="Current password"
                placeholderTextColor={colors.inkMuted}
                textContentType="password"
              />
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                style={styles.accountInput}
                placeholder="New password"
                placeholderTextColor={colors.inkMuted}
                textContentType="newPassword"
              />
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                style={styles.accountInput}
                placeholder="Confirm new password"
                placeholderTextColor={colors.inkMuted}
                textContentType="newPassword"
              />
              <Pressable
                accessibilityRole="button"
                disabled={accountSubmitting}
                style={({ pressed }) => [
                  styles.accountPrimaryButton,
                  accountSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void submitPasswordChange()}
              >
                {accountSubmitting ? (
                  <ActivityIndicator color={colors.surfacePrimary} />
                ) : (
                  <ButtonText style={styles.supportSendText}>Update password</ButtonText>
                )}
              </Pressable>
            </View>
          ) : null}

          {accountOpen && accountMode === 'delete' ? (
            <View style={styles.accountForm}>
              <Metadata style={styles.deleteWarning}>
                This permanently removes your account data.
              </Metadata>
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                style={styles.accountInput}
                placeholder="Password"
                placeholderTextColor={colors.inkMuted}
                textContentType="password"
              />
              <Pressable
                accessibilityRole="button"
                disabled={accountSubmitting}
                style={({ pressed }) => [
                  styles.accountDangerButton,
                  accountSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void submitAccountDelete()}
              >
                {accountSubmitting ? (
                  <ActivityIndicator color={colors.surfacePrimary} />
                ) : (
                  <ButtonText style={styles.supportSendText}>Delete account</ButtonText>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
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

function ContactStat({ active, onPress }: { active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Contact admin"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.statCell,
        styles.contactStat,
        active && styles.contactStatActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
      <Metadata numberOfLines={1} style={styles.contactStatValue}>
        Contact
      </Metadata>
      <Metadata numberOfLines={1} style={styles.statLabel}>
        Admin
      </Metadata>
    </Pressable>
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
  contactStat: {
    minHeight: 64,
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  contactStatActive: {
    backgroundColor: colors.accentSoft,
  },
  contactStatValue: {
    color: colors.inkPrimary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  supportStatus: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surfacePrimary,
    padding: spacing.sm,
  },
  supportStatusText: {
    color: colors.inkSecondary,
  },
  supportStatusSuccess: {
    color: colors.success,
  },
  supportPanel: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.surfacePrimary,
    padding: spacing.md,
  },
  supportInput: {
    minHeight: 112,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.canvas,
    color: colors.inkPrimary,
    padding: spacing.sm,
    fontSize: 15,
    lineHeight: 20,
  },
  supportActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  supportSecondaryButton: {
    minHeight: layout.minTouch,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
  },
  supportSecondaryText: {
    color: colors.inkSecondary,
  },
  supportSendButton: {
    minWidth: 88,
    minHeight: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
  },
  supportSendText: {
    color: colors.surfacePrimary,
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
  accountPanel: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  accountSettingsRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surfacePrimary,
    paddingHorizontal: spacing.sm,
  },
  accountSettingsCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  accountSettingsText: {
    color: colors.inkPrimary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  accountInlineStatus: {
    flex: 1,
    color: colors.inkSecondary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
  },
  accountActionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  accountActionButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surfacePrimary,
    paddingHorizontal: spacing.sm,
  },
  accountActionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  accountDeleteButton: {
    borderColor: 'rgba(163, 58, 50, 0.38)',
  },
  accountDeleteActive: {
    backgroundColor: '#F5E7E3',
  },
  accountActionText: {
    color: colors.inkPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  accountDeleteText: {
    color: colors.error,
  },
  accountForm: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  accountInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.surfacePrimary,
    color: colors.inkPrimary,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    lineHeight: 20,
  },
  accountPrimaryButton: {
    minHeight: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  accountDangerButton: {
    minHeight: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.error,
  },
  deleteWarning: {
    color: colors.error,
  },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.72 },
});
