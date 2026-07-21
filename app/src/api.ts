import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';

const TOKEN_KEY = '@phonefinder/token';
let cachedToken: string | null | undefined;

export async function setAuthToken(t: string | null) {
  cachedToken = t;
  if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

async function request(path: string, opts: { method?: string; body?: any } = {}) {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${config.API_BASE}${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${config.API_BASE}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

export type LocationPoint = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  battery?: number | null;
  charging?: number | boolean;
  ts: string;
};

export type Device = {
  id: string;
  name: string;
  model?: string | null;
  location: LocationPoint | null;
  owner_id?: number;
  owner_email?: string;
  locked?: number;
  lock_message?: string | null;
  lock_contact?: string | null;
  wiped_at?: string | null;
};

export type Geofence = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  mode: 'enter' | 'exit' | 'both';
  created_at?: string;
};

export type FenceEvent = {
  id: number;
  kind: 'enter' | 'exit';
  ts: string;
  fence: string | null;
  device: string | null;
  owner: string | null;
};

export type Command = {
  type: 'ring' | 'lock' | 'unlock' | 'wipe' | 'locate' | 'fence';
  payload?: { message?: string; contact?: string; kind?: 'enter' | 'exit'; fence?: string } | null;
};

export type Profile = {
  user: { id: number; email: string; role: 'admin' | 'member'; consent_at: string | null };
  org: { id: number; name: string; invite_code?: string } | null;
};

export const api = {
  register: (email: string, password: string) =>
    request('/api/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) =>
    request('/api/auth/login', { method: 'POST', body: { email, password } }),

  listDevices: (): Promise<Device[]> => request('/api/devices'),
  registerDevice: (payload: { id: string; name: string; model?: string }) =>
    request('/api/devices', { method: 'POST', body: payload }),
  deleteDevice: (id: string) => request(`/api/devices/${id}`, { method: 'DELETE' }),

  postLocation: (id: string, payload: { lat: number; lng: number; accuracy?: number | null; battery?: number | null; charging?: boolean }) =>
    request(`/api/devices/${id}/location`, { method: 'POST', body: payload }),
  history: (id: string): Promise<LocationPoint[]> => request(`/api/devices/${id}/history?limit=100`),

  ring: (id: string) => request(`/api/devices/${id}/ring`, { method: 'POST' }),
  commands: (id: string): Promise<Command[]> => request(`/api/devices/${id}/commands`),

  /* ----- MDM-lite ----- */
  lock: (id: string, payload: { message: string; contact: string; pin?: string }) =>
    request(`/api/devices/${id}/lock`, { method: 'POST', body: payload }),
  unlock: (id: string, pin?: string) =>
    request(`/api/devices/${id}/unlock`, { method: 'POST', body: { pin } }),
  wipe: (id: string) => request(`/api/devices/${id}/wipe`, { method: 'POST' }),
  locate: (id: string) => request(`/api/devices/${id}/locate`, { method: 'POST' }),
  orgAudit: (): Promise<{ action: string; device_id: string | null; actor: string; ts: string }[]> =>
    request('/api/org/audit'),

  /* ----- geofences ----- */
  geofences: (): Promise<Geofence[]> => request('/api/org/geofences'),
  createGeofence: (payload: { name: string; lat: number; lng: number; radius_m: number; mode: string }) =>
    request('/api/org/geofences', { method: 'POST', body: payload }),
  deleteGeofence: (id: number) => request(`/api/org/geofences/${id}`, { method: 'DELETE' }),
  geofenceEvents: (): Promise<FenceEvent[]> => request('/api/org/geofence-events'),

  /* ----- organization (Teams) ----- */
  me: (): Promise<Profile> => request('/api/me'),
  createOrg: (name: string): Promise<{ org: { id: number; name: string; invite_code: string } }> =>
    request('/api/orgs', { method: 'POST', body: { name } }),
  joinOrg: (code: string): Promise<{ org: { id: number; name: string } }> =>
    request('/api/orgs/join', { method: 'POST', body: { code } }),
  recordConsent: () => request('/api/orgs/consent', { method: 'POST' }),
  leaveOrg: () => request('/api/orgs/leave', { method: 'POST' }),
  orgMembers: (): Promise<{ id: number; email: string; role: string; consent_at: string | null }[]> =>
    request('/api/org/members'),
  orgDevices: (): Promise<Device[]> => request('/api/org/devices'),
};
