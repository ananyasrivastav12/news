import Constants from 'expo-constants';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';

type SessionState = {
  apiBaseUrl: string;
  setApiBaseUrl: (value: string) => void;
  accessToken: string | null;
  setAccessToken: (value: string | null) => void;
  userEmail: string;
  setUserEmail: (value: string) => void;
};

const AppSessionContext = createContext<SessionState | null>(null);

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

  const value = useMemo(
    () => ({
      apiBaseUrl,
      setApiBaseUrl,
      accessToken,
      setAccessToken,
      userEmail,
      setUserEmail,
    }),
    [accessToken, apiBaseUrl, userEmail]
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
