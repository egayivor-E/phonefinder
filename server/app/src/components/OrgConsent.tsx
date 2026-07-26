import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { stopSharing } from '../location/sharing';
import theme from '../theme';

/**
 * MANDATORY informed-consent gate for organizational tracking.
 * Shown to every member (admins included) after joining/creating an org.
 * The server independently refuses location uploads until consent_at is set,
 * so this disclosure cannot be skipped by a modified client.
 *
 * This satisfies the notice/transparency requirement of Ghana's Data
 * Protection Act, 2012 (Act 843); the timestamp is stored as evidence.
 */
export default function OrgConsent({
  orgName,
  onDone,
}: {
  orgName: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const consent = async () => {
    setBusy(true);
    try {
      await api.recordConsent();
      onDone();
    } catch (e: any) {
      Alert.alert('PhoneFinder', e.message);
      setBusy(false);
    }
  };

  const leave = () => {
    Alert.alert('Leave organization?', 'You will stop appearing on the team map.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await stopSharing();
          await api.leaveOrg();
          onDone();
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.icon}>📋</Text>
      <Text style={styles.title}>Organization tracking disclosure</Text>
      <Text style={styles.org}>Organization: <Text style={styles.orgName}>{orgName}</Text></Text>

      <View style={styles.card}>
        <Text style={styles.heading}>What will be shared</Text>
        <Text style={styles.item}>• This device’s live location, accuracy & timestamps</Text>
        <Text style={styles.item}>• Battery level and charging state</Text>
        <Text style={styles.item}>• Who can see it: your organization’s admins and team</Text>
        <Text style={styles.item}>• Only while “Protect this phone” is switched ON on this device</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>What is NEVER accessed</Text>
        <Text style={styles.item}>• Camera, microphone, photos, contacts or messages</Text>
        <Text style={styles.item}>• No hidden mode — a persistent notification always shows while sharing</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Your rights</Text>
        <Text style={styles.item}>• Stop sharing any time (the switch in the app)</Text>
        <Text style={styles.item}>• Leave the organization any time</Text>
        <Text style={styles.item}>• Your consent decision is recorded with a timestamp</Text>
      </View>

      <Pressable style={[styles.consentBtn, busy && { opacity: 0.6 }]} onPress={consent} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.consentText}>I understand and consent</Text>}
      </Pressable>
      <Pressable style={styles.leaveBtn} onPress={leave}>
        <Text style={styles.leaveText}>Leave this organization</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 24, paddingTop: 70, paddingBottom: 50 },
  icon: { fontSize: 44, textAlign: 'center' },
  title: { color: theme.colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  org: { color: theme.colors.muted, textAlign: 'center', marginTop: 8 },
  orgName: { color: theme.colors.accent2, fontWeight: '700' },
  card: { backgroundColor: theme.colors.card, borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 1, borderColor: theme.colors.border },
  heading: { color: theme.colors.text, fontWeight: '800', marginBottom: 6 },
  item: { color: theme.colors.muted, lineHeight: 22 },
  consentBtn: { backgroundColor: theme.colors.green, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  consentText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  leaveBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  leaveText: { color: theme.colors.red, fontWeight: '700' },
});
