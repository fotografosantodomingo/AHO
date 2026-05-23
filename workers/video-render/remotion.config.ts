import { Config } from '@remotion/cli/config';

/**
 * Remotion CLI config — used by `npx remotion render` for local
 * development. The production render path goes through
 * @remotion/renderer's renderMedia() directly (see src/server.ts);
 * this config exists so a developer can run a manual local render
 * to sanity-check composition changes:
 *
 *   npx remotion render src/composition.tsx reel-real-estate-v1 \
 *     out/preview.mp4 --props='{"title":{"text":"Test"}}'
 */
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(1);

// Chromium binary path — defaults to puppeteer's bundled Chromium
// in local dev; container override is in the Dockerfile.
if (process.env.REMOTION_CHROMIUM_PATH) {
  Config.setBrowserExecutable(process.env.REMOTION_CHROMIUM_PATH);
}
