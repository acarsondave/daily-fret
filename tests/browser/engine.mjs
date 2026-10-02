// Which browser engine a browser suite drives, chosen by BROWSER (chromium,
// the default, or webkit).
//
// WebKit is how Safari is checked on a machine with no Mac or iPhone: the same
// engine, with an iPhone's touch, scale and user agent when the suite asks for
// a phone. It is not Safari itself (no iOS audio session, no home-screen
// install), so anything that truly needs the phone still goes in STATUS under
// "needs Acarson's phone".
//
// Chromium's fake microphone and autoplay switches have no WebKit equivalent.
// WebKit is launched without them and given the microphone through
// permissions where it supports that; a suite that needs a captured signal has
// to stub getUserMedia itself, the way tests/browser/tuner.mjs does.

import { chromium, webkit, devices } from 'playwright';

export const ENGINE = (process.env.BROWSER ?? 'chromium').toLowerCase();
if (!['chromium', 'webkit'].includes(ENGINE)) {
  throw new Error(`BROWSER must be chromium or webkit, not ${ENGINE}`);
}
export const isWebKit = ENGINE === 'webkit';

const CHROMIUM_MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

/** Launch the chosen engine; `media` adds Chromium's fake mic and autoplay. */
export function launch({ media = false } = {}) {
  if (isWebKit) return webkit.launch();
  return chromium.launch(media ? { args: CHROMIUM_MEDIA_ARGS } : {});
}

/**
 * Context options for a viewport. A phone-sized viewport in WebKit becomes an
 * iPhone (touch, device scale, Safari's user agent) at the size asked for, so
 * the layout under test is the one the suite meant.
 */
export function contextOptions(viewport, { microphone = false } = {}) {
  const phone = viewport.width < 600;
  const base = isWebKit && phone
    ? { ...devices['iPhone 15'], viewport }
    : { viewport };
  if (microphone && !isWebKit) base.permissions = ['microphone'];
  return base;
}
