const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Enables picture-in-picture for the movie player and makes sure size/orientation changes do not
 * recreate the activity (so playback and native players survive rotation and PiP).
 */
module.exports = function withDubixAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:supportsPictureInPicture'] = 'true';
      main.$['android:resizeableActivity'] = 'true';
      const needed = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation', 'keyboardHidden', 'uiMode'];
      const current = new Set((main.$['android:configChanges'] ?? '').split('|').filter(Boolean));
      needed.forEach((n) => current.add(n));
      main.$['android:configChanges'] = [...current].join('|');
    }
    return cfg;
  });
};
