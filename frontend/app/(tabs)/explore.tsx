import * as Google from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppSession } from '@/context/AppSessionContext';
import {
  Interest,
  ProfileSummary,
  SavedArticle,
  createUser,
  fetchInterests,
  fetchMyInterests,
  fetchProfileSummary,
  fetchSavedArticles,
  login,
  loginWithGoogle,
  updateInterests,
} from '@/lib/api';

WebBrowser.maybeCompleteAuthSession();

type Step = 'account' | 'interests' | 'ready';
type Tone = 'info' | 'success' | 'error';

type StatusMessage = {
  tone: Tone;
  text: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function getArticleUrl(article: SavedArticle) {
  const articleUrl = article.url ?? article.original_url;
  return typeof articleUrl === 'string' && articleUrl.length > 0
    ? articleUrl
    : null;
}

function isCredentialError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('could not validate credentials') ||
    normalized.includes('not authenticated') ||
    normalized.includes('invalid token') ||
    normalized.includes('401')
  );
}

export default function SetupScreen() {
  const router = useRouter();
  const {
    accessToken,
    apiBaseUrl,
    clearSession,
    sessionReady,
    setAccessToken,
    userEmail,
    setUserEmail,
  } = useAppSession();
  const [password, setPassword] = useState('TestPassword123');
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>(accessToken ? 'ready' : 'account');
  const [status, setStatus] = useState<StatusMessage>({
    tone: 'info',
    text: 'Start with an account. After that, you will pick topics and build your first feed.',
  });
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const routeToFeedAfterAuth = useRef(false);
  const googleAuthConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
  );
  const [googleRequest, googleResponse, promptGoogleAuth] = Google.useAuthRequest({
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  const newsInterests = useMemo(
    () => interests.filter((interest) => interest.source_type === 'news'),
    [interests]
  );

  const selectedCount = selectedInterestIds.length;

  const addLog = useCallback((message: string) => {
    console.log(`[setup] ${message}`);
  }, []);

  const showStatus = useCallback((tone: Tone, text: string) => {
    setStatus({ tone, text });
  }, []);

  const handleLogout = useCallback(
    (message = 'Signed out. Choose a login method to continue.') => {
      clearSession();
      setSelectedInterestIds([]);
      setSavedArticles([]);
      setProfileSummary(null);
      setStep('account');
      routeToFeedAfterAuth.current = false;
      showStatus('info', message);
    },
    [clearSession, showStatus]
  );

  const loadInterests = useCallback(async () => {
    addLog('Loading interests');
    try {
      const items = await fetchInterests(apiBaseUrl);
      setInterests(items);
      addLog(`Loaded ${items.length} interests`);
      return items;
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Interest load failed: ${message}`);
      showStatus('error', `Could not load interests: ${message}`);
      return [];
    }
  }, [addLog, apiBaseUrl, showStatus]);

  useEffect(() => {
    void loadInterests();
  }, [loadInterests]);

  const loadMyInterests = useCallback(async () => {
    if (!accessToken) {
      setSelectedInterestIds([]);
      return [];
    }

    try {
      const selected = await fetchMyInterests(apiBaseUrl, accessToken);
      setSelectedInterestIds(selected.map((interest) => interest.id));
      if (selected.length > 0) {
        setStep('ready');
        showStatus('success', `Welcome back. Your profile is tuned to ${selected.length} topics.`);
        if (routeToFeedAfterAuth.current) {
          routeToFeedAfterAuth.current = false;
          router.replace('/');
        }
      } else {
        setStep('interests');
        showStatus('info', 'Choose a few topics once, then your profile will remember them.');
      }
      return selected;
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Saved interests failed: ${message}`);
      if (isCredentialError(message)) {
        handleLogout('Your session expired. Please log in again.');
        return [];
      }
      showStatus('error', `Could not load your profile interests: ${message}`);
      return [];
    }
  }, [accessToken, addLog, apiBaseUrl, handleLogout, router, showStatus]);

  useEffect(() => {
    if (accessToken) {
      void loadMyInterests();
    }
  }, [accessToken, loadMyInterests]);

  const loadSavedArticles = useCallback(async () => {
    if (!accessToken) {
      setSavedArticles([]);
      return;
    }
    try {
      const articles = await fetchSavedArticles(apiBaseUrl, accessToken);
      setSavedArticles(articles);
      addLog(`Loaded ${articles.length} saved articles`);
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Saved articles failed: ${message}`);
      if (isCredentialError(message)) {
        handleLogout('Your session expired. Please log in again.');
      }
    }
  }, [accessToken, addLog, apiBaseUrl, handleLogout]);

  useEffect(() => {
    void loadSavedArticles();
  }, [loadSavedArticles]);

  const loadProfileSummary = useCallback(async () => {
    if (!accessToken) {
      setProfileSummary(null);
      return;
    }
    try {
      const summary = await fetchProfileSummary(apiBaseUrl, accessToken);
      setProfileSummary(summary);
      addLog(
        `Profile stats loaded: ${summary.signal_counts.viewed} views, ` +
          `${summary.today_feed.unread} unread cards`
      );
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Profile summary failed: ${message}`);
      if (isCredentialError(message)) {
        handleLogout('Your session expired. Please log in again.');
      }
    }
  }, [accessToken, addLog, apiBaseUrl, handleLogout]);

  useEffect(() => {
    void loadProfileSummary();
  }, [loadProfileSummary]);

  function toggleInterest(id: number) {
    setSelectedInterestIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function loginAndContinue(email: string) {
    addLog(`Logging in ${email}`);
    const response = await login(apiBaseUrl, { email, password });
    routeToFeedAfterAuth.current = true;
    setAccessToken(response.access_token);
    setUserEmail(response.email || email);
    showStatus('success', 'You are in. Loading your profile now.');
    addLog(`Logged in ${email}`);
  }

  useEffect(() => {
    async function finishGoogleLogin(idToken: string) {
      setLoading(true);
      try {
        addLog('Logging in with Google');
        const response = await loginWithGoogle(apiBaseUrl, { id_token: idToken });
        routeToFeedAfterAuth.current = true;
        setAccessToken(response.access_token);
        if (response.email) {
          setUserEmail(response.email);
        }
        showStatus('success', 'Google sign-in complete. Loading your profile now.');
      } catch (error) {
        const message = getErrorMessage(error);
        addLog(`Google login failed: ${message}`);
        showStatus('error', `Could not sign in with Google: ${message}`);
      } finally {
        setLoading(false);
      }
    }

    if (googleResponse?.type !== 'success') return;
    const idToken = googleResponse.authentication?.idToken;
    if (!idToken) {
      showStatus('error', 'Google did not return an ID token.');
      return;
    }
    void finishGoogleLogin(idToken);
  }, [
    addLog,
    apiBaseUrl,
    googleResponse,
    setAccessToken,
    setUserEmail,
    showStatus,
  ]);

  async function handleCreateUser() {
    const email = userEmail.trim();
    if (!email) {
      showStatus('error', 'Enter an email before creating an account.');
      return;
    }

    setLoading(true);
    try {
      addLog(`Creating account ${email}`);
      await createUser(apiBaseUrl, { email, password });
      showStatus('success', 'Account created. Logging you in now.');
      addLog(`Created account ${email}`);
      await loginAndContinue(email);
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Create failed: ${message}`);
      if (message.toLowerCase().includes('already registered')) {
        showStatus('info', 'That account already exists. Tap Log in to continue with it.');
      } else {
        showStatus('error', `Could not create account: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    const email = userEmail.trim();
    if (!email) {
      showStatus('error', 'Enter an email before logging in.');
      return;
    }

    setLoading(true);
    try {
      await loginAndContinue(email);
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Login failed: ${message}`);
      showStatus('error', `Could not log in: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveInterests() {
    if (!accessToken) {
      showStatus('error', 'Log in first, then pick your interests.');
      setStep('account');
      return;
    }
    if (selectedInterestIds.length === 0) {
      showStatus('error', 'Pick at least one topic so the feed has a direction.');
      return;
    }

    setLoading(true);
    try {
      addLog(`Saving ${selectedInterestIds.length} interests`);
      const saved = await updateInterests(apiBaseUrl, accessToken, selectedInterestIds);
      setStep('ready');
      showStatus('success', `Saved ${saved.length} topics. Your feed was rebuilt.`);
      addLog(`Saved ${saved.length} interests and rebuilt the feed`);
      await loadProfileSummary();
      router.replace('/');
    } catch (error) {
      const message = getErrorMessage(error);
      addLog(`Save interests failed: ${message}`);
      showStatus('error', `Could not save interests: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  const canPickInterests = step === 'interests' || step === 'ready';

  if (!sessionReady) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#1268ff" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Personal news, tuned by you</Text>
          <Text style={styles.title}>
            {step === 'account'
              ? 'Create your reader'
              : step === 'interests'
                ? 'Pick your lanes'
                : 'Profile'}
          </Text>
          <Text style={styles.subtitle}>
            {step === 'account'
              ? 'Sign in first. The app will move you forward when the backend confirms it.'
              : step === 'interests'
                ? 'Tap a few topics that should shape your morning cards.'
                : 'Manage interests, check personalization signals, and revisit saved stories.'}
          </Text>
        </View>

        <View style={styles.progressRow}>
          {(['account', 'interests', 'ready'] as Step[]).map((item, index) => {
            const active = item === step;
            const complete =
              (item === 'account' && accessToken) ||
              (item === 'interests' && step === 'ready');
            return (
              <View
                key={item}
                style={[
                  styles.progressDot,
                  active && styles.progressDotActive,
                  complete && styles.progressDotComplete,
                ]}
              >
                <Text style={[styles.progressText, (active || complete) && styles.progressTextActive]}>
                  {index + 1}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={[styles.statusCard, styles[`status_${status.tone}`]]}>
          {loading ? <ActivityIndicator color="#1268ff" /> : null}
          <Text style={styles.statusText}>{status.text}</Text>
          {accessToken ? (
            <Pressable
              disabled={loading}
              style={styles.inlineStatusButton}
              onPress={() => handleLogout()}
            >
              <Text style={styles.inlineStatusButtonText}>Sign out</Text>
            </Pressable>
          ) : null}
        </View>

        {step === 'account' ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Account</Text>
            <TextInput
              value={userEmail}
              onChangeText={setUserEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor="#8a94a6"
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#8a94a6"
            />
            <View style={styles.buttonRow}>
              <Pressable
                disabled={loading}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  loading && styles.buttonDisabled,
                ]}
                onPress={() => void handleCreateUser()}
              >
                <Text style={styles.primaryButtonText}>Create account</Text>
              </Pressable>
              <Pressable
                disabled={loading}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                  loading && styles.buttonDisabled,
                ]}
                onPress={() => void handleLogin()}
              >
                <Text style={styles.secondaryButtonText}>Log in</Text>
              </Pressable>
            </View>
            <Pressable
              disabled={!googleAuthConfigured || !googleRequest || loading}
              style={({ pressed }) => [
                styles.googleButton,
                pressed && styles.buttonPressed,
                (!googleAuthConfigured || !googleRequest || loading) &&
                  styles.buttonDisabled,
              ]}
              onPress={() => void promptGoogleAuth()}
            >
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
            {!googleAuthConfigured ? (
              <Text style={styles.authHint}>
                Add Google OAuth client IDs to enable Google sign-in.
              </Text>
            ) : null}
          </View>
        ) : null}

        {canPickInterests ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.sectionTitle}>Interests</Text>
                <Text style={styles.sectionHint}>{selectedCount} selected</Text>
              </View>
              <Pressable
                disabled={loading}
                style={styles.smallButton}
                onPress={() => void loadInterests()}
              >
                <Text style={styles.smallButtonText}>Refresh</Text>
              </Pressable>
            </View>

            <View style={styles.chipWrap}>
              {newsInterests.map((interest) => {
                const selected = selectedInterestIds.includes(interest.id);
                return (
                  <Pressable
                    key={interest.id}
                    onPress={() => toggleInterest(interest.id)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {interest.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {step === 'interests' ? (
              <Pressable
                disabled={loading}
                style={({ pressed }) => [
                  styles.fullButton,
                  pressed && styles.buttonPressed,
                  loading && styles.buttonDisabled,
                ]}
                onPress={() => void handleSaveInterests()}
              >
                <Text style={styles.primaryButtonText}>Save and continue</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {accessToken && profileSummary ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.sectionTitle}>Personalization</Text>
                <Text style={styles.sectionHint}>
                  {profileSummary.today_feed.unread} unread of{' '}
                  {profileSummary.today_feed.total} cards
                </Text>
              </View>
              <Pressable
                disabled={loading}
                style={styles.smallButton}
                onPress={() => void loadProfileSummary()}
              >
                <Text style={styles.smallButtonText}>Refresh</Text>
              </Pressable>
            </View>
            <View style={styles.statGrid}>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>
                  {profileSummary.today_feed.explicit_interest_matches}
                </Text>
                <Text style={styles.statLabel}>interest matches</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>
                  {profileSummary.signal_counts.viewed}
                </Text>
                <Text style={styles.statLabel}>viewed</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>
                  {profileSummary.signal_counts.liked}
                </Text>
                <Text style={styles.statLabel}>liked</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>
                  {profileSummary.signal_counts.disliked}
                </Text>
                <Text style={styles.statLabel}>disliked</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>
                  {profileSummary.signal_counts.saved}
                </Text>
                <Text style={styles.statLabel}>saved</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>
                  {profileSummary.signal_counts.clicked}
                </Text>
                <Text style={styles.statLabel}>opened</Text>
              </View>
            </View>
            {profileSummary.today_feed.total > 0 &&
            profileSummary.today_feed.explicit_interest_matches === 0 ? (
              <Pressable
                style={styles.warningCard}
                onPress={() =>
                  Alert.alert(
                    'Low category coverage',
                    'Your selected categories do not have matching summarized stories in today’s article pool yet. Run the daily pipeline or add another interest to widen the feed.'
                  )
                }
              >
                <Text style={styles.warningText}>
                  Low coverage for your selected interests
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {accessToken ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.sectionTitle}>Saved articles</Text>
                <Text style={styles.sectionHint}>{savedArticles.length} bookmarked</Text>
              </View>
              <Pressable
                disabled={loading}
                style={styles.smallButton}
                onPress={() => void loadSavedArticles()}
              >
                <Text style={styles.smallButtonText}>Refresh</Text>
              </Pressable>
            </View>
            {savedArticles.length === 0 ? (
              <Text style={styles.bodyText}>Saved stories will show here after you tap 🔖 on a card.</Text>
            ) : (
              savedArticles.map((article) => (
                <Pressable
                  key={article.id}
                  style={styles.savedArticle}
                  onPress={() => {
                    const articleUrl = getArticleUrl(article);
                    if (articleUrl) {
                      void Linking.openURL(articleUrl);
                    }
                  }}
                >
                  <Text style={styles.savedTitle}>{article.title}</Text>
                  <Text style={styles.savedMeta}>{article.source || article.primary_category}</Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fb',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22,
    gap: 16,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    gap: 8,
  },
  kicker: {
    color: '#1268ff',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: '#08090a',
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    color: '#5f6673',
    fontSize: 16,
    lineHeight: 23,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 10,
  },
  progressDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d8dde8',
    backgroundColor: '#ffffff',
  },
  progressDotActive: {
    backgroundColor: '#1268ff',
    borderColor: '#1268ff',
  },
  progressDotComplete: {
    backgroundColor: '#12b981',
    borderColor: '#12b981',
  },
  progressText: {
    color: '#5f6673',
    fontWeight: '800',
  },
  progressTextActive: {
    color: '#fff',
  },
  statusCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  status_info: {
    backgroundColor: '#eef5ff',
    borderColor: '#b8d2ff',
  },
  status_success: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  status_error: {
    backgroundColor: '#fff1f0',
    borderColor: '#ffb4a8',
  },
  statusText: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  inlineStatusButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#ffffff',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#d8dde8',
  },
  inlineStatusButtonText: {
    color: '#0b4fd6',
    fontSize: 13,
    fontWeight: '900',
  },
  panel: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d8dde8',
    padding: 18,
    gap: 14,
    shadowColor: '#0b1220',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: '#08090a',
    fontSize: 22,
    fontWeight: '900',
  },
  sectionHint: {
    color: '#6b7280',
    fontWeight: '700',
    marginTop: 2,
  },
  bodyText: {
    color: '#3b414b',
    fontSize: 15,
    lineHeight: 22,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statTile: {
    width: '30%',
    minWidth: 92,
    borderRadius: 16,
    backgroundColor: '#f4f7fb',
    padding: 12,
    gap: 3,
  },
  statValue: {
    color: '#08090a',
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  warningCard: {
    borderRadius: 16,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: 13,
  },
  warningText: {
    color: '#9a3412',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#ccd4e1',
    backgroundColor: '#fff',
    color: '#08090a',
    fontSize: 16,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#1268ff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#e8f1ff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fullButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#1268ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButton: {
    borderRadius: 999,
    backgroundColor: '#eef5ff',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  smallButtonText: {
    color: '#0b4fd6',
    fontWeight: '800',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.88,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButtonText: {
    color: '#0b4fd6',
    fontSize: 15,
    fontWeight: '900',
  },
  googleButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#08090a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  googleButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  authHint: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ccd4e1',
    backgroundColor: '#fff',
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  chipSelected: {
    backgroundColor: '#e8f1ff',
    borderColor: '#1268ff',
  },
  chipPressed: {
    transform: [{ scale: 0.96 }],
  },
  chipText: {
    color: '#303741',
    fontSize: 15,
    fontWeight: '800',
  },
  chipTextSelected: {
    color: '#0b4fd6',
  },
  savedArticle: {
    borderRadius: 16,
    backgroundColor: '#f4f7fb',
    padding: 14,
    gap: 6,
  },
  savedTitle: {
    color: '#08090a',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  savedMeta: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
});
