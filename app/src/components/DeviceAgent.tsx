import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import { api, Command } from '../api';
import { AuthContext } from '../auth';
import { getDeviceId, immediateFix, wipeLocal } from '../location/sharing';
import theme from '../theme';

const RING_PHRASE =
  'This phone has been reported lost. Please keep it safe and return it to its owner. Thank you.';

type LockState = { message: string; contact: string };

/**
 * The on-device agent. While signed in it polls the server every 5s for
 * management commands:
 *   ring   → full-screen spoken alarm
 *   lock   → lost-mode lock screen (unlockable with the admin's PIN)
 *   unlock → release the lock
 *   wipe   → selective corporate wipe (stops sharing, erases app data)
 *   locate → upload an immediate GPS fix
 * It also re-checks the lock flag on startup and while locked, so a lock
 * issued while the app was closed takes over as soon as the app opens.
 */
export default function DeviceAgent() {
  const { signOut } = useContext(AuthContext);
  const [ringing, setRinging] = useState(false);
  const [lock, setLock] = useState<LockState | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const ringStopped = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  /* ---- ring alarm ---- */
  const speakLoop = () => {
    if (ringStopped.current) return;
    Speech.speak(RING_PHRASE, { rate: 0.95, pitch: 1.1, onDone: () => setTimeout(speakLoop, 700) });
  };
  const startRing = () => {
    ringStopped.current = false;
    setRinging(true);
    Vibration.vibrate([0, 600, 300, 600, 300, 600], true);
    speakLoop();
  };
  const stopRing = () => {
    ringStopped.current = true;
    Speech.stop();
    Vibration.cancel();
    setRinging(false);
  };

  /* ---- command polling + startup lock check ---- */
  useEffect(() => {
    let deviceIdCache: string | null = null;

    const applyCommands = async (cmds: Command[]) => {
      for (const cmd of cmds) {
        if (cmd.type === 'ring') startRing();
        else if (cmd.type === 'lock') setLock({ message: cmd.payload?.message || '', contact: cmd.payload?.contact || '' });
        else if (cmd.type === 'unlock') setLock(null);
        else if (cmd.type === 'locate' && deviceIdCache) immediateFix(deviceIdCache);
        else if (cmd.type === 'fence') {
          const left = cmd.payload?.kind === 'exit';
          showToast(`${left ? '⚠️ Left' : '✅ Entered'} zone “${cmd.payload?.fence || ''}”${left ? ' — notify your admin' : ''}`);
        }
        else if (cmd.type === 'wipe') {
          await wipeLocal();
          signOut(); // back to the sign-in screen, fully de-enrolled
        }
      }
    };

    const tick = async () => {
      try {
        if (!deviceIdCache) deviceIdCache = await getDeviceId();

        const cmds = await api.commands(deviceIdCache);
        if (cmds.length) await applyCommands(cmds);

        // State sync (covers locks issued while the app was closed, and acts
        // as a fallback if an unlock command was somehow missed).
        const devices = await api.listDevices();
        const self = devices.find((d) => d.id === deviceIdCache);
        if (!self) return;
        if (self.locked) {
          setLock((cur) => cur ?? { message: self.lock_message || '', contact: self.lock_contact || '' });
        } else if (!cmds.some((c) => c.type === 'lock')) {
          setLock(null);
        }
      } catch {
        /* offline — retry next tick */
      }
    };

    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- block Android back button while locked ---- */
  useEffect(() => {
    if (!lock) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [lock]);

  const tryUnlock = async () => {
    setPinError('');
    try {
      const id = await getDeviceId();
      await api.unlock(id, pin);
      setLock(null);
      setPin('');
    } catch (e: any) {
      setPinError(e.message || 'Invalid PIN');
      setPin('');
    }
  };

  return (
    <>
      {/* Geofence toast */}
      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Ring alarm overlay */}
      {ringing && (
        <View style={styles.ringOverlay}>
          <Text style={styles.bigIcon}>🔊</Text>
          <Text style={styles.lockTitle}>THIS PHONE IS LOST</Text>
          <Text style={styles.lockBody}>
            The owner is trying to locate this device. Please keep it safe and help them get it back.
          </Text>
          <Pressable style={styles.whiteBtn} onPress={stopRing}>
            <Text style={styles.whiteBtnText}>I found this phone — stop alarm</Text>
          </Pressable>
        </View>
      )}

      {/* Lost-mode lock overlay */}
      {lock && (
        <View style={styles.lockOverlay}>
          <Text style={styles.bigIcon}>🔒</Text>
          <Text style={styles.lockTitle}>DEVICE LOCKED</Text>
          <Text style={styles.lockBody}>{lock.message || 'This device has been locked by your organization.'}</Text>
          {!!lock.contact && (
            <Text style={styles.contact}>📞 Contact: {lock.contact}</Text>
          )}
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={setPin}
            placeholder="Enter unlock PIN"
            placeholderTextColor="rgba(255,255,255,0.6)"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
          />
          {!!pinError && <Text style={styles.pinError}>{pinError}</Text>}
          <Pressable style={styles.whiteBtn} onPress={tryUnlock}>
            <Text style={styles.whiteBtnText}>Unlock</Text>
          </Pressable>
          <Text style={styles.lockFootnote}>
            Location sharing continues while locked so the device can be recovered.
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  ringOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.red,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    zIndex: 100,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0c1420',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    zIndex: 100,
  },
  bigIcon: { fontSize: 72 },
  lockTitle: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 14 },
  lockBody: { color: 'rgba(255,255,255,0.92)', fontSize: 16, textAlign: 'center', marginTop: 14, lineHeight: 24 },
  contact: { color: theme.colors.accent2, fontSize: 18, fontWeight: '800', marginTop: 16 },
  pinInput: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    textAlign: 'center',
    minWidth: 200,
    marginTop: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pinError: { color: '#fca5a5', marginTop: 8 },
  whiteBtn: { backgroundColor: '#fff', paddingHorizontal: 26, paddingVertical: 15, borderRadius: 14, marginTop: 22 },
  whiteBtnText: { color: '#111', fontWeight: '800', fontSize: 16 },
  lockFootnote: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 28, textAlign: 'center' },
  toast: {
    position: 'absolute', top: 60, left: 20, right: 20, zIndex: 90,
    backgroundColor: 'rgba(21,27,35,0.97)', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderColor: theme.colors.accent2,
  },
  toastText: { color: theme.colors.text, fontWeight: '700', textAlign: 'center' },
});
