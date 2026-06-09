import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

type SessionState = {
  apiBaseUrl: string;
  setApiBaseUrl: (value: string) => void;
  accessToken: string | null;
  setAccessToken: (value: string | null) => void;
  userEmail: string;
  setUserEmail: (value: string) => void;
  clearSession: () => void;
  sessionReady: boolean;
};

const AppSessionContext = createContext<SessionState | null>(null);
const ACCESS_TOKEN_KEY = 'news.accessToken';
const USER_EMAIL_KEY = 'news.userEmail';

function getDefaultApiBaseUrl() {
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];

  if (host) {
    return `http://${host}:8000`;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl, setApiBaseUrl] = useState(getDefaultApiBaseUrl());
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    async function restoreSession() {
      try {
        const secureStoreAvailable = await SecureStore.isAvailableAsync();
        if (!secureStoreAvailable) {
          return;
        }
        const [storedToken, storedEmail] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(USER_EMAIL_KEY),
        ]);
        if (storedToken) {
          setAccessToken(storedToken);
        }
        if (storedEmail) {
          setUserEmail(storedEmail);
        }
      } catch (error) {
        console.log(
          `[session] restore failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        );
      } finally {
        setSessionReady(true);
      }
    }

    void restoreSession();
  }, []);

  const updateAccessToken = useCallback((value: string | null) => {
    setAccessToken(value);
    void SecureStore.isAvailableAsync()
      .then((available) => {
        if (!available) return undefined;
        return value
          ? SecureStore.setItemAsync(ACCESS_TOKEN_KEY, value)
          : SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      })
      .catch((error) => {
        console.log(
          `[session] token persist failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        );
      });
  }, []);

  const updateUserEmail = useCallback((value: string) => {
    setUserEmail(value);
    void SecureStore.isAvailableAsync()
      .then((available) => {
        if (!available) return undefined;
        return value
          ? SecureStore.setItemAsync(USER_EMAIL_KEY, value)
          : SecureStore.deleteItemAsync(USER_EMAIL_KEY);
      })
      .catch((error) => {
        console.log(
          `[session] email persist failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        );
      });
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUserEmail('');
    void SecureStore.isAvailableAsync()
      .then((available) => {
        if (!available) return undefined;
        return Promise.all([
          SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.deleteItemAsync(USER_EMAIL_KEY),
        ]);
      })
      .catch((error) => {
        console.log(
          `[session] clear failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        );
      });
  }, []);

  const value = useMemo(
    () => ({
      apiBaseUrl,
      setApiBaseUrl,
      accessToken,
      setAccessToken: updateAccessToken,
      userEmail,
      setUserEmail: updateUserEmail,
      clearSession,
      sessionReady,
    }),
    [
      accessToken,
      apiBaseUrl,
      clearSession,
      sessionReady,
      updateAccessToken,
      updateUserEmail,
      userEmail,
    ]
  );

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  );
}

export function useAppSession() {
  const context = useContext(AppSessionContext);
  if (!context) {
    throw new Error('useAppSession must be used within AppSessionProvider');
  }
  return context;
}
