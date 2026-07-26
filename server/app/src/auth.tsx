import React, { createContext, useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Profile, setAuthToken } from './api';

const TOKEN_KEY = '@phonefinder/token';

type AuthState = {
  token: string | null;
  initializing: boolean;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await api.me());
    } catch {
      /* offline — profile stays null until reachable */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const t = await AsyncStorage.getItem(TOKEN_KEY);
        if (t) {
          await setAuthToken(t);
          setTokenState(t);
          await refreshProfile();
        }
      } finally {
        setInitializing(false);
      }
    })();
  }, [refreshProfile]);

  const signIn = async (email: string, password: string) => {
    const res = await api.login(email, password);
    await setAuthToken(res.token);
    setTokenState(res.token);
    await refreshProfile();
  };

  const signUp = async (email: string, password: string) => {
    const res = await api.register(email, password);
    await setAuthToken(res.token);
    setTokenState(res.token);
    await refreshProfile();
  };

  const signOut = async () => {
    await setAuthToken(null);
    setTokenState(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ token, initializing, profile, refreshProfile, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
