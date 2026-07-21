import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AuthContext } from '../auth';
import { api, Device, Geofence, Profile } from '../api';
import { stopSharing } from '../location/sharing';
import theme from '../theme';

function timeAgo(ts?: string): string {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - new Date(ts + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * The team view: every enrolled device in the organization on one list,
 * tap any of them to open the map with directions. Members see each other
 * (mutual transparency); only admins can ring other people's devices.
 */
export default function TeamScreen({
  profile,
  onSelect,
}: {
  profile: Profile;
  onSelect: (d: Device) => void;
}) {
  const { refreshProfile } = useContext(AuthContext);
  const [devices, setDevices] = useState<Device[]>([]);
  const [members, setMembers] = useState<{ id: number; email: string; role: string; consent_at: string | null }[]>([]);
  const [zones, setZones] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [zoneModal, setZoneModal] = useState(false);
  const [zName, setZName] = useState('');
  const [zLat, setZLat] = useState('');
  const [zLng, setZLng] = useState('');
  const [zRadius, setZRadius] = useState('150');
  const [zMode, setZMode] = useState<'enter' | 'exit' | 'both'>('both');

  const isAdmin = profile.user.role === 'admin';

  const load = useCallback(async () => {
    try {
      const [devs, mems, zs] = await Promise.all([api.orgDevices(), api.orgMembers(), api.geofences()]);
      setDevices(devs);
      setMembers(mems);
      setZones(zs);
    } catch {
      /* ignore transient errors */
    } finally {
      setLoading(false);
    }
  }, []);

  const createZone = async () => {
    const lat = parseFloat(zLat);
    const lng = parseFloat(zLng);
    const radius = parseFloat(zRadius);
    if (!zName.trim() || isNaN(lat) || isNaN(lng) || isNaN(radius) || radius < 5) {
      return Alert.alert('PhoneFinder', 'Give the zone a name, a centre point and a radius of at least 5 m.');
    }
    try {
      await api.createGeofence({ name: zName.trim(), lat, lng, radius_m: radius, mode: zMode });
      setZoneModal(false);
      setZName(''); setZLat(''); setZLng(''); setZRadius('150'); setZMode('both');
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const deleteZone = (z: Geofence) => {
    Alert.alert('Delete zone?', `“${z.name}” will stop generating alerts.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await api.deleteGeofence(z.id); load(); } },
    ]);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const leaveOrg = () => {
    Alert.alert(
      'Leave organization?',
      profile.user.role === 'admin'
        ? 'Admins can leave too — the organization remains for other members.'
        : 'You will stop appearing on the team map.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await stopSharing();
            await api.leaveOrg();
            refreshProfile();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{profile.org?.name}</Text>
          <Text style={styles.subtitle}>
            {profile.user.role === 'admin' ? 'Team map · you are an admin' : 'Team map'} · {devices.length} device{devices.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Pressable onPress={leaveOrg}>
          <Text style={styles.leave}>Leave</Text>
        </Pressable>
      </View>

      {profile.user.role === 'admin' && profile.org?.invite_code && (
        <View style={styles.invite}>
          <Text style={styles.inviteText}>
            Invite code: <Text style={styles.inviteCode}>{profile.org.invite_code}</Text>  — share with members
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.colors.accent} />
          }
        >
          <Text style={styles.section}>DEVICES ON THE MAP</Text>
          {devices.length === 0 && (
            <Text style={styles.empty}>No enrolled devices yet. Members join with the invite code, consent, then switch on “Protect this phone”.</Text>
          )}
          {devices.map((d) => {
            const mine = d.owner_email === profile.user.email;
            return (
              <Pressable key={d.id} style={styles.card} onPress={() => onSelect(d)}>
                <View style={styles.row}>
                  <Text style={styles.emoji}>📱</Text>
                  <View style={styles.grow}>
                    <Text style={styles.name}>
                      {d.name}
                      {mine ? <Text style={styles.thisTag}>  YOURS</Text> : null}
                    </Text>
                    <Text style={styles.meta}>
                      {d.owner_email} ·{' '}
                      {d.location
                        ? `seen ${timeAgo(d.location.ts)}${d.location.battery != null ? ` · 🔋 ${d.location.battery}%` : ''}`
                        : 'no location yet'}
                      {d.locked ? ' · 🔒 LOCKED' : ''}
                      {d.wiped_at ? ' · 🧹 WIPED' : ''}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            );
          })}

          {profile.user.role === 'admin' && (
            <>
              <Text style={styles.section}>MEMBERS & CONSENT RECORDS</Text>
              {members.map((m) => (
                <View key={m.id} style={styles.memberCard}>
                  <View style={styles.grow}>
                    <Text style={styles.memberName}>
                      {m.email}
                      {m.role === 'admin' ? <Text style={styles.roleTag}>  ADMIN</Text> : null}
                    </Text>
                    <Text style={styles.meta}>
                      {m.consent_at
                        ? `✅ Consent recorded ${timeAgo(m.consent_at)}`
                        : '⏳ Joined but has not consented yet — not trackable'}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}

          <View style={styles.sectionRow}>
            <Text style={styles.section}>GEOFENCE ZONES</Text>
            {isAdmin && (
              <Pressable onPress={() => setZoneModal(true)}>
                <Text style={styles.addZone}>＋ New zone</Text>
              </Pressable>
            )}
          </View>
          {zones.length === 0 && (
            <Text style={styles.empty}>No zones yet. Admins can create zones (e.g. “Depot”, “Accra CBD”) and get alerted when devices enter or leave.</Text>
          )}
          {zones.map((z) => (
            <View key={z.id} style={styles.memberCard}>
              <View style={styles.grow}>
                <Text style={styles.memberName}>⭕ {z.name}</Text>
                <Text style={styles.meta}>
                  {Math.round(z.radius_m)} m radius · alerts on {z.mode === 'both' ? 'enter & exit' : z.mode} · {z.lat.toFixed(5)}, {z.lng.toFixed(5)}
                </Text>
              </View>
              {isAdmin && (
                <Pressable onPress={() => deleteZone(z)}>
                  <Text style={styles.delZone}>✕</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Zone creation modal */}
      <Modal visible={zoneModal} transparent animationType="fade">
        <View style={styles.modalBack}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>⭕ New geofence zone</Text>
            <Text style={styles.modalLabel}>Zone name</Text>
            <TextInput style={styles.modalInput} value={zName} onChangeText={setZName} placeholder="e.g. Tema Depot" placeholderTextColor={theme.colors.muted} />
            <Text style={styles.modalLabel}>Centre — tap a device to use its live position</Text>
            <View style={styles.chipWrap}>
              {devices.filter((d) => d.location).map((d) => (
                <Pressable
                  key={d.id}
                  style={styles.chip}
                  onPress={() => { setZLat(d.location!.lat.toFixed(6)); setZLng(d.location!.lng.toFixed(6)); }}
                >
                  <Text style={styles.chipText}>📍 {d.name}</Text>
                </Pressable>
              ))}
              {devices.every((d) => !d.location) && <Text style={styles.meta}>No device has reported a location yet.</Text>}
            </View>
            <View style={styles.latRow}>
              <TextInput style={[styles.modalInput, styles.half]} value={zLat} onChangeText={setZLat} placeholder="Latitude" placeholderTextColor={theme.colors.muted} keyboardType="numeric" />
              <TextInput style={[styles.modalInput, styles.half]} value={zLng} onChangeText={setZLng} placeholder="Longitude" placeholderTextColor={theme.colors.muted} keyboardType="numeric" />
            </View>
            <Text style={styles.modalLabel}>Radius (metres)</Text>
            <TextInput style={styles.modalInput} value={zRadius} onChangeText={setZRadius} placeholder="150" placeholderTextColor={theme.colors.muted} keyboardType="numeric" />
            <Text style={styles.modalLabel}>Alert when devices…</Text>
            <View style={styles.modeRow}>
              {(['enter', 'exit', 'both'] as const).map((m) => (
                <Pressable key={m} style={[styles.modeChip, zMode === m && styles.modeChipActive]} onPress={() => setZMode(m)}>
                  <Text style={[styles.modeChipText, zMode === m && styles.modeChipTextActive]}>
                    {m === 'enter' ? '↪ enter' : m === 'exit' ? '↩ exit' : 'both'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modeRow}>
              <Pressable style={[styles.modeChip]} onPress={() => setZoneModal(false)}>
                <Text style={styles.modeChipText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modeChip, styles.modeChipActive]} onPress={createZone}>
                <Text style={styles.modeChipTextActive}>Create zone</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
  title: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, marginTop: 2, fontSize: 13 },
  leave: { color: theme.colors.red, fontSize: 15 },
  invite: { backgroundColor: theme.colors.card2, marginHorizontal: 16, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border },
  inviteText: { color: theme.colors.muted, fontSize: 13 },
  inviteCode: { color: theme.colors.accent2, fontWeight: '900', letterSpacing: 2 },
  list: { padding: 16, paddingBottom: 110 },
  card: { backgroundColor: theme.colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  memberCard: { backgroundColor: theme.colors.card2, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center' },
  emoji: { fontSize: 24, marginRight: 12 },
  grow: { flex: 1 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  thisTag: { color: theme.colors.accent2, fontSize: 11, fontWeight: '800' },
  roleTag: { color: theme.colors.amber, fontSize: 11, fontWeight: '800' },
  memberName: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: theme.colors.muted, marginTop: 3, fontSize: 12 },
  chevron: { color: theme.colors.muted, fontSize: 24, marginLeft: 8 },
  section: { color: theme.colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 10, marginBottom: 8, marginLeft: 4 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addZone: { color: theme.colors.accent2, fontWeight: '800', fontSize: 13 },
  delZone: { color: theme.colors.red, fontSize: 18, paddingHorizontal: 6 },
  empty: { color: theme.colors.muted, textAlign: 'center', marginVertical: 20, lineHeight: 20 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: theme.colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  modalLabel: { color: theme.colors.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
  modalInput: { backgroundColor: theme.colors.card2, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.border, fontSize: 15 },
  latRow: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: theme.colors.card2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.colors.border },
  chipText: { color: theme.colors.accent2, fontSize: 12, fontWeight: '700' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  modeChip: { flex: 1, backgroundColor: theme.colors.card2, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
  modeChipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  modeChipText: { color: theme.colors.muted, fontWeight: '700' },
  modeChipTextActive: { color: '#fff', fontWeight: '800' },
});
