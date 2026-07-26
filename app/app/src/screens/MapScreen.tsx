import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { api, Device as DeviceInfo } from '../api';
import theme from '../theme';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

type RouteInfo = {
  coords: { latitude: number; longitude: number }[];
  distanceKm: number;
  durationMin: number;
};

export default function MapScreen({
  device,
  onBack,
  canRing = true,
  ownerLabel,
}: {
  device: DeviceInfo;
  onBack: () => void;
  canRing?: boolean;
  ownerLabel?: string;
}) {
  const mapRef = useRef<MapView>(null);
  const [dev, setDev] = useState<DeviceInfo>(device);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routing, setRouting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lockModal, setLockModal] = useState(false);
  const [lockMsg, setLockMsg] = useState('This device has been locked by your organization. Please return it.');
  const [lockContact, setLockContact] = useState('');
  const [lockPin, setLockPin] = useState('');

  const refresh = useCallback(async () => {
    try {
      const all = await api.listDevices();
      const me = all.find((d) => d.id === device.id);
      if (me) setDev(me);
    } catch {
      /* ignore transient errors */
    }
  }, [device.id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000); // live-refresh every 10s
    return () => clearInterval(t);
  }, [refresh]);

  const loc = dev.location;

  const initialRegion = {
    latitude: loc?.lat ?? 5.6037, // fallback: Accra
    longitude: loc?.lng ?? -0.187,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  const getDirections = async () => {
    if (!loc) return Alert.alert('PhoneFinder', 'This device has not reported a location yet.');
    setRouting(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') throw new Error('Location permission needed to route from here.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const from = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const res = await fetch(
        `${OSRM}/${from.lng},${from.lat};${loc.lng},${loc.lat}?overview=full&geometries=geojson`,
      );
      const data = await res.json();
      const r = data.routes?.[0];
      if (!r) throw new Error('No route found.');
      const coords = r.geometry.coordinates.map(([lng, lat]: number[]) => ({ latitude: lat, longitude: lng }));
      const info: RouteInfo = {
        coords,
        distanceKm: r.distance / 1000,
        durationMin: Math.round(r.duration / 60),
      };
      setRoute(info);
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(
          [{ latitude: from.lat, longitude: from.lng }, { latitude: loc.lat, longitude: loc.lng }],
          { edgePadding: { top: 90, right: 60, bottom: 260, left: 60 }, animated: true },
        );
      }, 150);
    } catch (e: any) {
      Alert.alert('Could not get directions', e.message);
    } finally {
      setRouting(false);
    }
  };

  const openTurnByTurn = () => {
    if (!loc) return;
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${loc.lat},${loc.lng}&dirflg=d`
        : `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=driving`;
    Linking.openURL(url);
  };

  const ringPhone = async () => {
    try {
      setRefreshing(true);
      await api.ring(dev.id);
      Alert.alert('🔊 Ring command sent', 'The phone will sound an alarm within a few seconds.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setRefreshing(false);
    }
  };

  /* ---------- MDM-lite controls (owner or admin only) ---------- */
  const sendLock = async () => {
    if (!lockPin.trim()) return Alert.alert('PhoneFinder', 'Set an unlock PIN (the holder of the phone will need it).');
    try {
      await api.lock(dev.id, { message: lockMsg.trim(), contact: lockContact.trim(), pin: lockPin.trim() });
      setLockModal(false);
      setLockPin('');
      Alert.alert('🔒 Lock command sent', 'The device screen will be locked within seconds. Share the PIN only with the rightful holder.');
      refresh();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const sendUnlock = async () => {
    try {
      await api.unlock(dev.id);
      Alert.alert('🔓 Unlock command sent');
      refresh();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const sendWipe = () => {
    Alert.alert('Remote wipe?', `This erases the PhoneFinder account & data from ${dev.name} and stops tracking. Personal data on the phone is NOT touched.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'WIPE',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.wipe(dev.id);
            Alert.alert('🧹 Wipe command sent', 'The device will de-enroll itself within seconds.');
            onBack();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const sendLocate = async () => {
    try {
      await api.locate(dev.id);
      Alert.alert('📍 Locate command sent', 'A fresh GPS fix will arrive within seconds.');
      setTimeout(refresh, 4000);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <View style={styles.root}>
      <MapView ref={mapRef} style={styles.map} initialRegion={initialRegion} showsUserLocation>
        {loc && (
          <>
            {typeof loc.accuracy === 'number' && loc.accuracy > 0 && loc.accuracy < 5000 && (
              <Circle
                center={{ latitude: loc.lat, longitude: loc.lng }}
                radius={loc.accuracy}
                strokeColor="rgba(59,130,246,0.5)"
                fillColor="rgba(59,130,246,0.12)"
              />
            )}
            <Marker
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              title={dev.name}
              description={loc.battery != null ? `Battery ${loc.battery}%` : 'Last known location'}
            />
          </>
        )}
        {route && (
          <Polyline coordinates={route.coords} strokeWidth={4} strokeColor={theme.colors.accent2} />
        )}
      </MapView>

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.pill} onPress={onBack}>
          <Text style={styles.pillText}>‹ Back</Text>
        </Pressable>
        <Pressable style={styles.pill} onPress={refresh}>
          <Text style={styles.pillText}>⟳ Refresh</Text>
        </Pressable>
      </View>

      {/* Bottom panel */}
      <View style={styles.panel}>
        <Text style={styles.devName}>
          {dev.name}
          {dev.locked ? <Text style={styles.lockedTag}>  🔒 LOCKED</Text> : null}
          {dev.wiped_at ? <Text style={styles.wipedTag}>  🧹 WIPED</Text> : null}
        </Text>
        {ownerLabel && <Text style={styles.owner}>Belongs to {ownerLabel}</Text>}
        <Text style={styles.meta}>
          {loc
            ? `Last seen ${new Date(loc.ts + 'Z').toLocaleString()}${loc.battery != null ? ` · 🔋 ${loc.battery}%${loc.charging ? ' ⚡' : ''}` : ''}${typeof loc.accuracy === 'number' ? ` · ±${Math.round(loc.accuracy)} m` : ''}`
            : 'No location reported yet'}
        </Text>

        {route && (
          <Text style={styles.routeInfo}>
            🧭 {route.distanceKm.toFixed(1)} km · ~{route.durationMin} min drive
          </Text>
        )}

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={getDirections} disabled={routing}>
            {routing ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>🧭 Directions</Text>}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={openTurnByTurn}>
            <Text style={styles.btnGhostText}>🚗 Navigate</Text>
          </Pressable>
          {canRing && (
            <Pressable style={[styles.btn, styles.btnRing]} onPress={ringPhone} disabled={refreshing}>
              <Text style={styles.btnRingText}>🔊 Ring</Text>
            </Pressable>
          )}
        </View>

        {canRing && (
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={sendLocate}>
              <Text style={styles.btnGhostText}>📍 Locate</Text>
            </Pressable>
            {dev.locked ? (
              <Pressable style={[styles.btn, styles.btnUnlock]} onPress={sendUnlock}>
                <Text style={styles.btnUnlockText}>🔓 Unlock</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setLockModal(true)}>
                <Text style={styles.btnGhostText}>🔒 Lock</Text>
              </Pressable>
            )}
            <Pressable style={[styles.btn, styles.btnWipe]} onPress={sendWipe}>
              <Text style={styles.btnWipeText}>🧹 Wipe</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Lock configuration modal */}
      <Modal visible={lockModal} transparent animationType="fade">
        <View style={styles.modalBack}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>🔒 Lock {dev.name}</Text>
            <Text style={styles.modalLabel}>Message shown on the locked screen</Text>
            <TextInput style={styles.modalInput} value={lockMsg} onChangeText={setLockMsg} multiline />
            <Text style={styles.modalLabel}>Contact number (optional)</Text>
            <TextInput style={styles.modalInput} value={lockContact} onChangeText={setLockContact} placeholder="+233 …" placeholderTextColor={theme.colors.muted} keyboardType="phone-pad" />
            <Text style={styles.modalLabel}>Unlock PIN (required)</Text>
            <TextInput style={styles.modalInput} value={lockPin} onChangeText={setLockPin} placeholder="e.g. 4821" placeholderTextColor={theme.colors.muted} keyboardType="number-pad" maxLength={8} secureTextEntry />
            <View style={styles.modalActions}>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setLockModal(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnLock]} onPress={sendLock}>
                <Text style={styles.btnLockText}>Send lock</Text>
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
  map: { ...StyleSheet.absoluteFillObject },
  topBar: { position: 'absolute', top: 50, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { backgroundColor: 'rgba(11,15,20,0.85)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border },
  pillText: { color: theme.colors.text, fontWeight: '700' },
  panel: {
    position: 'absolute', left: 12, right: 12, bottom: 18,
    backgroundColor: 'rgba(21,27,35,0.96)', borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  devName: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  owner: { color: theme.colors.accent2, fontSize: 13, marginTop: 2 },
  meta: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  routeInfo: { color: theme.colors.accent2, fontWeight: '700', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: theme.colors.accent },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },
  btnGhost: { backgroundColor: theme.colors.card2, borderWidth: 1, borderColor: theme.colors.border },
  btnGhostText: { color: theme.colors.text, fontWeight: '700' },
  btnRing: { backgroundColor: theme.colors.red },
  btnRingText: { color: '#fff', fontWeight: '800' },
  btnUnlock: { backgroundColor: theme.colors.green },
  btnUnlockText: { color: '#fff', fontWeight: '800' },
  btnWipe: { backgroundColor: theme.colors.card2, borderWidth: 1, borderColor: theme.colors.red },
  btnWipeText: { color: theme.colors.red, fontWeight: '800' },
  btnLock: { backgroundColor: theme.colors.amber },
  btnLockText: { color: '#111', fontWeight: '800' },
  lockedTag: { color: theme.colors.amber, fontSize: 12, fontWeight: '900' },
  wipedTag: { color: theme.colors.red, fontSize: 12, fontWeight: '900' },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: theme.colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  modalLabel: { color: theme.colors.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
  modalInput: { backgroundColor: theme.colors.card2, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.border, fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
