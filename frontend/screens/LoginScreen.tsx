// beta email and password login screen
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ButtonText,
  Masthead,
  Metadata,
} from '@/components/editorial/Typography';
import { useAppSession } from '@/context/AppSessionContext';
import { colors, layout, radius, spacing, typeScale } from '@/design/tokens';
import { login } from '@/lib/api';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function LoginScreen() {
  const router = useRouter();
  const { apiBaseUrl, setAccessToken, userEmail, setUserEmail } = useAppSession();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    const email = userEmail.trim();
    setEmailError('');
    setPasswordError('');
    setFormError('');

    if (!email) {
      setEmailError('Enter the email from your invitation.');
      return;
    }
    if (!password) {
      setPasswordError('Enter your password.');
      return;
    }

    setLoading(true);
    try {
      const response = await login(apiBaseUrl, { email, password });
      setAccessToken(response.access_token);
      setUserEmail(response.email || email);
      router.replace('/');
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.titleBlock}>
          <Masthead>THE EDIT</Masthead>
          <View style={styles.rule} />
          <Metadata style={styles.subtitle}>Welcome to the beta</Metadata>
          <Metadata style={styles.copy}>
            Please use the email and password provided by the admin.
          </Metadata>
        </View>

        {formError ? (
          <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
            <Metadata style={styles.errorText}>{formError}</Metadata>
          </View>
        ) : null}

        <View style={styles.fieldGroup}>
          <TextInput
            value={userEmail}
            onChangeText={setUserEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={[styles.input, emailError && styles.inputError]}
            placeholder="Email"
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel="Email"
          />
          {emailError ? <Metadata style={styles.validation}>{emailError}</Metadata> : null}

          <View style={[styles.passwordRow, passwordError && styles.inputError]}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textContentType="password"
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel="Password"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              style={styles.visibilityButton}
              onPress={() => setShowPassword((value) => !value)}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={21}
                color={colors.inkSecondary}
              />
            </Pressable>
          </View>
          {passwordError ? <Metadata style={styles.validation}>{passwordError}</Metadata> : null}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={loading}
          style={[styles.continueButton, loading && styles.disabled]}
          onPress={() => void handleContinue()}
        >
          {loading ? (
            <ActivityIndicator color={colors.surfacePrimary} />
          ) : (
            <ButtonText style={styles.continueText}>Continue</ButtonText>
          )}
        </Pressable>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { flex: 1, padding: spacing.xl, gap: spacing.md, justifyContent: 'center' },
  titleBlock: { gap: spacing.sm, marginBottom: spacing.md },
  rule: {
    height: 1,
    backgroundColor: colors.deepBlack,
    opacity: 0.65,
  },
  subtitle: {
    color: colors.inkSecondary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  copy: { color: colors.inkSecondary },
  fieldGroup: { gap: spacing.sm },
  input: {
    minHeight: 54,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfacePrimary,
    paddingHorizontal: spacing.md,
    color: colors.inkPrimary,
    ...typeScale.input,
  },
  passwordRow: {
    minHeight: 54,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfacePrimary,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    color: colors.inkPrimary,
    ...typeScale.input,
  },
  visibilityButton: {
    width: layout.minTouch,
    height: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputError: { borderColor: colors.error },
  validation: { color: colors.error },
  errorBanner: {
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.accentSoft,
    padding: spacing.sm,
  },
  errorText: { color: colors.error },
  continueButton: {
    minHeight: 52,
    borderRadius: radius.control,
    backgroundColor: colors.inkPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: { color: colors.surfacePrimary },
  disabled: { opacity: 0.55 },
});
