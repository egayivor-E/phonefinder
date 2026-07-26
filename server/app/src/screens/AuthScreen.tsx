import React, { useContext, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AuthContext } from '../auth';
import theme from '../theme';

export default function AuthScreen() {
  const { signIn, signUp } = useContext(AuthContext);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>📡</Text>
        <Text style={styles.title}>PhoneFinder</Text>
        <Text style={styles.subtitle}>Find your own phone. Locate it on a map, get directions to it, and make it ring.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={theme.colors.muted}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={theme.colors.muted}
            onSubmitEditing={submit}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={submit} disabled={busy}>
            <Text style={styles.buttonText}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Text>
          </Pressable>
        </View>

        <Pressable onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          <Text style={styles.switch}>
            {mode === 'login' ? "New here? Create an account" : 'Already have an account? Sign in'}
          </Text>
        </Pressable>

        <Text style={styles.consent}>
          🔒 Consent-first: PhoneFinder only tracks devices signed in to your own account
          with location sharing explicitly enabled.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: { fontSize: 56, textAlign: 'center' },
  title: { color: theme.colors.text, fontSize: 32, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  subtitle: { color: theme.colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: { backgroundColor: theme.colors.card, borderRadius: 16, padding: 18, marginTop: 28, borderWidth: 1, borderColor: theme.colors.border },
  label: { color: theme.colors.muted, fontSize: 13, marginBottom: 6, marginTop: 6 },
  input: { backgroundColor: theme.colors.card2, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: theme.colors.border },
  error: { color: theme.colors.red, marginTop: 12 },
  button: { backgroundColor: theme.colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switch: { color: theme.colors.accent2, textAlign: 'center', marginTop: 18, fontSize: 15 },
  consent: { color: theme.colors.muted, textAlign: 'center', marginTop: 28, fontSize: 12, lineHeight: 17, paddingHorizontal: 8 },
});
