const path = require('path');

// Local Maven repo holding the verified sherpa-onnx AAR (see scripts/fetch-sherpa-onnx.js).
const sherpaRepo = path.resolve(__dirname, 'modules/dubix-native/android/maven').replace(/\\/g, '/');

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: 'DubiX AI',
  slug: 'dubix-ai',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/images/icon.png',
  scheme: 'dubixai',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#F8F9FE',
  platforms: ['android'],
  android: {
    package: 'ai.dubix.app',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#6848F4',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Declared here as well as in the module manifest so they are visible in app review.
    permissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    blockedPermissions: [
      // Files are opened through the system picker (SAF); broad storage access is never needed.
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
    ],
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-font',
    './plugins/withDubixAndroid',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#6848F4',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          extraMavenRepos: [sherpaRepo],
          // Ship only the ABIs sherpa-onnx provides prebuilt libraries for.
          buildArchs: ['arm64-v8a', 'armeabi-v7a', 'x86_64'],
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};
