import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import { AuthContext } from '../auth';
import { api, Device as DeviceInfo } from '../api';
import { getDeviceId, isSharing, startSharing, stopSharing } from '../location/sharing';
import theme from '../theme';

export type { DeviceInfo };

function timeAgo(ts?: string): string {
  if (!ts) return 'never reported';
  const s = Math.max(0, (Date.now() - new Date(ts + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function DevicesScreen({
  onSelect,
  orgName,
  onOpenOrg,
}: {
  onSelect: (d: DeviceInfo) => void;
  orgName?: string;
  onOpenOrg?: () => void;
}) {
  const { signOut } = useContext(AuthContext);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [thisId, setThisId] = useState('');
  const [sharing, setSharingState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [id, devs, on] = await Promise.all([getDeviceId(), api.listDevices(), isSharing()]);
      setThisId(id);
      setDevices(devs);
      setSharingState(on);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSharing = async (value: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (value) {
        await api.registerDevice({
          id: thisId,
          name: Device.deviceName || Device.modelName || 'My Phone',
          model: Device.modelName || undefined,
        });
        await startSharing(thisId);
        setSharingState(true);
        await load();
      } else {
        await stopSharing();
        setSharingState(false);
      }
    } catch (e: any) {
      Alert.alert('PhoneFinder', e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = (d: DeviceInfo) => {
    Alert.alert('Remove device?', `${d.name} will stop being tracked.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            if (d.id === thisId) await stopSharing();
            await api.deleteDevice(d.id);
            load();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>PhoneFinder</Text>
          <Text style={styles.subtitle}>Your protected devices</Text>
        </View>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.colors.accent} />
        }
      >
        {/* Organization banner / entry point */}
        {orgName ? (
          <View style={styles.orgBanner}>
            <Text style={styles.orgBannerText}>🏢 Organization: <Text style={styles.orgName}>{orgName}</Text></Text>
          </View>
        ) : (
          <Pressable style={styles.orgCard} onPress={onOpenOrg}>
            <Text style={styles.orgCardTitle}>🏢 PhoneFinder Teams</Text>
            <Text style={styles.meta}>Create or join an organization to track enrolled devices on a team map.</Text>
          </Pressable>
        )}

        {/* Protect THIS phone */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.phoneEmoji}>🛡️</Text>
            <View style={styles.grow}>
              <Text style={styles.name}>Protect this phone</Text>
              <Text style={styles.meta}>
                {busy ? 'Working…' : sharing ? 'Sharing location with your account' : 'Off — this phone can’t be found'}
              </Text>
            </View>
            <Switch
              value={sharing}
              onValueChange={toggleSharing}
              disabled={busy}
              trackColor={{ true: theme.colors.green, false: theme.colors.border }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {!!error && <Text style={styles.error}>⚠️ {error}</Text>}

        <Text style={styles.section}>DEVICES</Text>
        {devices.length === 0 && !error && (
          <Text style={styles.empty}>No devices yet. Turn on “Protect this phone” above to start.</Text>
        )}

        {devices.map((d) => (
          <Pressable key={d.id} style={styles.card} onPress={() => onSelect(d)} onLongPress={() => removeDevice(d)}>
            <View style={styles.row}>
              <Text style={styles.phoneEmoji}>{d.id === thisId ? '📱' : '💻'}</Text>
              <View style={styles.grow}>
                <Text style={styles.name}>
                  {d.name}
                  {d.id === thisId ? <Text style={styles.thisTag}>  THIS PHONE</Text> : null}
                </Text>
                <Text style={styles.meta}>
                  {d.location
                    ? `Seen ${timeAgo(d.location.ts)}${d.location.battery != null ? ` · 🔋 ${d.location.battery}%${d.location.charging ? ' ⚡' : ''}` : ''}`
                    : `No location yet · registered ${timeAgo(d.location?.ts)}`}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        ))}

        <Text style={styles.tip}>Tip: long-press a device to remove it.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, marginTop: 2 },
  signOut: { color: theme.colors.muted, fontSize: 15 },
  list: { padding: 16, paddingBottom: 110 },
  card: { backgroundColor: theme.colors.card, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  phoneEmoji: { fontSize: 26, marginRight: 12 },
  grow: { flex: 1 },
  name: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  thisTag: { color: theme.colors.accent2, fontSize: 11, fontWeight: '800' },
  meta: { color: theme.colors.muted, marginTop: 3, fontSize: 13 },
  chevron: { color: theme.colors.muted, fontSize: 26, marginLeft: 8 },
  section: { color: theme.colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 14, marginBottom: 8, marginLeft: 4 },
  empty: { color: theme.colors.muted, textAlign: 'center', marginVertical: 24, lineHeight: 20 },
  error: { color: theme.colors.red, marginBottom: 10 },
  tip: { color: theme.colors.muted, textAlign: 'center', fontSize: 12, marginTop: 12 },
  orgBanner: { backgroundColor: theme.colors.card2, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  orgBannerText: { color: theme.colors.muted, fontSize: 13 },
  orgName: { color: theme.colors.accent2, fontWeight: '700' },
  orgCard: { backgroundColor: theme.colors.card, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.accent },
  orgCardTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 3 },
});
