// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Native build output is never imported by JS. Excluding it keeps Metro's crawl, watcher and cache
// small: Gradle writes tens of thousands of files into android/ and node_modules/*/android/build.
const native = [
  /[\\/]android[\\/](build|\.gradle|\.cxx|app[\\/]build)[\\/].*/,
  /[\\/]node_modules[\\/].+[\\/]android[\\/](build|\.cxx|\.gradle)[\\/].*/,
  /[\\/]modules[\\/][^\\/]+[\\/]android[\\/](build|maven|\.cxx)[\\/].*/,
];
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...native];

module.exports = config;
