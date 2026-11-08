import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { DubixNative } from 'dubix-native';

import { refreshDevice } from '@/store/engine';

export type PermState = 'granted' | 'denied' | 'blocked' | 'unavailable';

export type PermissionSnapshot = {
  microphone: PermState;
  notifications: PermState;
  overlay: PermState;
  playbackCapture: 'supported' | 'unsupported';
};

const MIC = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
const NOTIF = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
const needsNotifPermission = Platform.OS === 'android' && Number(Platform.Version) >= 33;

async function check(): Promise<PermissionSnapshot> {
  if (Platform.OS !== 'android' || !DubixNative) {
    return { microphone: 'unavailable', notifications: 'unavailable', overlay: 'unavailable', playbackCapture: 'unsupported' };
  }
  const mic = await PermissionsAndroid.check(MIC);
  const notif = needsNotifPermission ? await PermissionsAndroid.check(NOTIF) : true;
  const device = DubixNative.getDeviceInfo();
  return {
    microphone: mic ? 'granted' : 'denied',
    notifications: notif ? 'granted' : 'denied',
    overlay: device.canDrawOverlays ? 'granted' : 'denied',
    playbackCapture: device.playbackCaptureSupported ? 'supported' : 'unsupported',
  };
}

export async function requestMicrophone(): Promise<PermState> {
  const r = await PermissionsAndroid.request(MIC, {
    title: 'Microphone access',
    message: 'DubiX listens only while live translation is running. Audio is processed on this device and never uploaded.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return r === 'granted' ? 'granted' : r === 'never_ask_again' ? 'blocked' : 'denied';
}

export async function requestNotifications(): Promise<PermState> {
  if (!needsNotifPermission) return 'granted';
  const r = await PermissionsAndroid.request(NOTIF);
  return r === 'granted' ? 'granted' : r === 'never_ask_again' ? 'blocked' : 'denied';
}

/** Live permission snapshot that refreshes when the app returns to the foreground (e.g. from Settings). */
export function usePermissions() {
  const [snap, setSnap] = useState<PermissionSnapshot | null>(null);
  const refresh = useCallback(async () => {
    setSnap(await check());
    refreshDevice();
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      check().then((next) => {
        if (alive) setSnap(next);
        refreshDevice();
      });
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return { snap, refresh };
}
