const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Default Expo Metro config, plus one thing: three packages that exist only on
 * a phone get replaced by refusing stubs when bundling for web.
 *
 * The web bundle is a PREVIEW target — a design review, a screenshot, a demo to
 * somebody with no phone in front of them. It is not a supported platform and
 * nothing in web-stubs/ fakes a success; see web-stubs/README.md.
 */
const WEB_STUBS = {
  'react-native-google-mobile-ads': 'web-stubs/google-mobile-ads.js',
  'expo-app-integrity': 'web-stubs/app-integrity.js',
  'react-native-view-shot': 'web-stubs/view-shot.js',
};

const config = getDefaultConfig(__dirname);
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, WEB_STUBS[moduleName]),
    };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
