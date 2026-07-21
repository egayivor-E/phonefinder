import React, { useContext, useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { AuthContext, AuthProvider } from './src/auth';
import AuthScreen from './src/screens/AuthScreen';
import DevicesScreen, { DeviceInfo } from './src/screens/DevicesScreen';
import MapScreen from './src/screens/MapScreen';
import TeamScreen from './src/screens/TeamScreen';
import OrgSetup from './src/screens/OrgSetup';
import OrgConsent from './src/components/OrgConsent';
import DeviceAgent from './src/components/DeviceAgent';
import theme from './src/theme';

type Tab = 'mine' | 'team';

function Root() {
  const { token, initializing, profile, refreshProfile } = useContext(AuthContext);
  const [tab, setTab] = useState<Tab>('mine');
  const [selected, setSelected] = useState<DeviceInfo | null>(null);
  const [orgSetup, setOrgSetup] = useState(false);

  if (initializing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }
  if (!token) return <AuthScreen />;

  const inOrg = !!profile?.org;

  // Mandatory informed-consent gate — nobody (not even the admin) can be
  // tracked by the org until they explicitly accept the disclosure.
  if (inOrg && profile && !profile.user.consent_at) {
    return <OrgConsent orgName={profile.org!.name} onDone={refreshProfile} />;
  }

  if (orgSetup) {
    return (
      <OrgSetup
        onDone={() => {
          setOrgSetup(false);
          refreshProfile();
        }}
      />
    );
  }

  if (selected) {
    const ownDevice = !selected.owner_id || selected.owner_id === profile?.user.id;
    const canRing = ownDevice || profile?.user.role === 'admin';
    return (
      <MapScreen
        device={selected}
        onBack={() => setSelected(null)}
        canRing={canRing}
        ownerLabel={selected.owner_email}
      />
    );
  }

  return (
    <>
      {inOrg && profile && tab === 'team' ? (
        <TeamScreen profile={profile} onSelect={setSelected} />
      ) : (
        <DevicesScreen
          onSelect={setSelected}
          orgName={inOrg ? profile!.org!.name : undefined}
          onOpenOrg={() => setOrgSetup(true)}
        />
      )}

      {inOrg && (
        <View style={styles.tabBar}>
          <Pressable style={[styles.tab, tab === 'mine' && styles.tabActive]} onPress={() => setTab('mine')}>
            <Text style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>📱 My device</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === 'team' && styles.tabActive]} onPress={() => setTab('team')}>
            <Text style={[styles.tabText, tab === 'team' && styles.tabTextActive]}>🗺️ Team map</Text>
          </Pressable>
        </View>
      )}

      {/* On-device management agent: ring alarm, lost-mode lock, wipe, locate */}
      <DeviceAgent />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.bg} />
      <Root />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.bg },
  tabBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', backgroundColor: 'rgba(21,27,35,0.97)',
    borderTopWidth: 1, borderTopColor: theme.colors.border, paddingBottom: 14,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabActive: {},
  tabText: { color: theme.colors.muted, fontWeight: '700' },
  tabTextActive: { color: theme.colors.accent2 },
});
