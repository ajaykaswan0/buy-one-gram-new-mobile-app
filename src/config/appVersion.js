/**
 * This build's own version, as a plain string.
 *
 * Bump this by hand alongside versionName in android/app/build.gradle
 * whenever a new build goes out — there's no automatic way for the JS side
 * to read the native versionName without adding a whole native module for
 * one string. Compared against the admin-set "Latest app version" (App
 * Settings > Business) to nudge anyone on an older build to update.
 */
export const CURRENT_APP_VERSION = '1.86';
