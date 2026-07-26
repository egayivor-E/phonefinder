import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import theme from '../theme';

/**
 * Create or join an organization. After joining, the app ALWAYS shows the
 * OrgConsent disclosure screen before any team tracking can happen.
 */
export default function OrgSetup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; invite_code: string } | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.createOrg(name.trim() || 'My Organization');
      setCreated(res.org);
    } catch (e: any) {
      Alert.alert('PhoneFinder', e.message);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    try {
      await api.joinOrg(code.trim());
      onDone(); // → app routes to the mandatory consent screen
    } catch (e: any) {
      Alert.alert('PhoneFinder', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>🏢 Organization created</Text>
        <Text style={styles.text}>
          Share this invite code with your team. Each member joins with it, reads the tracking
          disclosure and records their consent before they appear on the map.
        </Text>
        <View style={styles.codeBox}>
          <Text style={styles.code}>{created.invite_code}</Text>
        </View>
        <Pressable style={styles.primary} onPress={onDone}>
          <Text style={styles.primaryText}>Continue</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>🏢 PhoneFinder Teams</Text>
      <Text style={styles.text}>
        Track your organization’s enrolled devices on a live map — transparently, with every
        member’s recorded consent.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Create an organization</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Accra Logistics Ltd"
          placeholderTextColor={theme.colors.muted}
        />
        <Pressable style={styles.primary} onPress={create} disabled={busy}>
          <Text style={styles.primaryText}>Create</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Join with an invite code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="ABCD1234"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="characters"
        />
        <Pressable style={styles.secondary} onPress={join} disabled={busy}>
          <Text style={styles.secondaryText}>Join organization</Text>
        </Pressable>
      </View>

      <Pressable onPress={onDone}>
        <Text style={styles.solo}>Continue without an organization (personal use)</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: theme.colors.bg },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '800', marginTop: 40 },
  text: { color: theme.colors.muted, marginTop: 10, lineHeight: 20 },
  card: { backgroundColor: theme.colors.card, borderRadius: 14, padding: 16, marginTop: 20, borderWidth: 1, borderColor: theme.colors.border },
  label: { color: theme.colors.text, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: theme.colors.card2, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: theme.colors.border },
  primary: { backgroundColor: theme.colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '800' },
  secondary: { backgroundColor: theme.colors.card2, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: theme.colors.border },
  secondaryText: { color: theme.colors.text, fontWeight: '700' },
  solo: { color: theme.colors.muted, textAlign: 'center', marginTop: 26 },
  codeBox: { backgroundColor: theme.colors.card2, borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 22, borderWidth: 1, borderColor: theme.colors.border },
  code: { color: theme.colors.accent2, fontSize: 30, fontWeight: '900', letterSpacing: 4 },
});
