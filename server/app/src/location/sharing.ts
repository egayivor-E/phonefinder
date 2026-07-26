import { Platform, Vibration } from 'react-native';
import * as Battery from 'expo-battery';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';

export const LOCATION_TASK = 'PHONEFINDER_LOCATION_TASK';
const SHARING_KEY = '@phonefinder/sharing';
const DEVICE_ID_KEY = '@phonefinder/deviceId';

/**
 * Background location task — runs every ~15s / 20m while "Protect this phone"
 * is enabled. Reports GPS + battery to the server and checks for ring commands.
 * NOTE: this executes in a background JS context (no UI available), so a ring
 * received here fires a loud local notification instead of the in-app alarm.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  try {
    const deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) return;

    const loc = data.locations[data.locations.length - 1];
    const level = await Battery.getBatteryLevelAsync();
    const state = await Battery.getBatteryStateAsync();

    await api.postLocation(deviceId, {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
      battery: level != null && level >= 0 ? Math.round(level * 100) : null,
      charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
    });

    const cmds = await api.commands(deviceId);
    for (const cmd of cmds) {
      if (cmd.type === 'ring') {
        Vibration.vibrate([0, 500, 300, 500, 300, 500], true);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🔊 THIS PHONE IS LOST',
            body: 'Someone is trying to locate this device. Open PhoneFinder.',
            sound: 'default',
          },
          trigger: null,
        });
      } else if (cmd.type === 'lock') {
        // App not in foreground — surface the lock as a high-priority notification.
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🔒 DEVICE LOCKED BY ORGANIZATION',
            body: cmd.payload?.message || 'Open PhoneFinder for details.',
            sound: 'default',
          },
          trigger: null,
        });
      } else if (cmd.type === 'locate') {
        await immediateFix(deviceId);
      } else if (cmd.type === 'fence') {
        const kind = cmd.payload?.kind === 'exit' ? 'left' : 'entered';
        await Notifications.scheduleNotificationAsync({
          content: {
            title: cmd.payload?.kind === 'exit' ? '⚠️ Zone exit alert' : '✅ Zone enter alert',
            body: `This device ${kind} the zone “${cmd.payload?.fence || ''}”.`,
            sound: 'default',
          },
          trigger: null,
        });
      }
      // 'wipe' and 'unlock' are handled by the foreground DeviceAgent.
    }
  } catch {
    /* Offline or server unreachable — the next update will retry. */
  }
});

/** Stable id for this physical device (persists across app restarts). */
export async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = await Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function isSharing(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Start sharing this device's location with the owner's account. */
export async function startSharing(deviceId: string): Promise<void> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new Error('Location permission is required to protect this phone.');

  // Ask for "Always" (background) permission. On iOS this shows the
  // "Allow once / While using / Always" upgrade prompt.
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    /* User can keep foreground-only tracking. */
  }

  await Notifications.requestPermissionsAsync();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tracking', {
      name: 'Location sharing',
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  await AsyncStorage.setItem(SHARING_KEY, '1');

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15000,
    distanceInterval: 20,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true, // iOS blue status-bar pill (transparency)
    foregroundService: {
      notificationTitle: 'PhoneFinder is protecting this device',
      notificationBody: 'Your location is shared with your own account so you can find this phone.',
      notificationChannelId: 'tracking',
    },
  });
}

/** Stop sharing and cancel any active alarm vibration. */
export async function stopSharing(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    /* noop */
  }
  await AsyncStorage.removeItem(SHARING_KEY);
  Vibration.cancel();
}

/** Force an immediate GPS fix and upload it (responds to a "locate" command). */
export async function immediateFix(deviceId: string): Promise<void> {
  try {
    const pos = await Location.getLastKnownPositionAsync({ maxAge: 2000 });
    const fresh = pos || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const level = await Battery.getBatteryLevelAsync();
    await api.postLocation(deviceId, {
      lat: fresh.coords.latitude,
      lng: fresh.coords.longitude,
      accuracy: fresh.coords.accuracy,
      battery: level != null && level >= 0 ? Math.round(level * 100) : null,
      charging: false,
    });
  } catch {
    /* location unavailable — next scheduled update will report */
  }
}

/**
 * Selective (corporate) wipe: stops sharing and erases ALL app data on this
 * device (account token, device identity, preferences). The phone's personal
 * data is never touched — this mirrors what real MDM does on BYOD devices.
 */
export async function wipeLocal(): Promise<void> {
  try {
    await stopSharing();
  } finally {
    await AsyncStorage.clear();
  }
}
