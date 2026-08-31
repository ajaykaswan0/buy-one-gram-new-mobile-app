import { Platform, Linking, Alert } from 'react-native';

/**
 * Opens a party's pin in whatever map app the phone uses.
 *
 * A shop's coordinates are only useful if the salesman can be walked to them,
 * and that is the one job a map app does far better than anything we could
 * draw. This is deliberately an external hand-off, unlike the ledger — there
 * is nothing confidential in a street location, and navigation has to keep
 * running while he drives.
 *
 * Coordinates are read from either shape the API returns, since some endpoints
 * nest them under `location` and others put them on the party itself.
 */
export const partyCoordinates = (party) => {
  const latitude = Number(party?.location?.latitude ?? party?.latitude);
  const longitude = Number(party?.location?.longitude ?? party?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)
    ? { latitude, longitude }
    : null;
};

export const openPartyOnMap = async (party, displayName) => {
  const point = partyCoordinates(party);
  if (!point) {
    Alert.alert(
      'No location saved',
      `${displayName || party?.partyName || 'This party'} has no GPS pin yet. It is captured when the party is created, or you can set it from the admin panel.`
    );
    return false;
  }

  const { latitude, longitude } = point;
  const label = encodeURIComponent(displayName || party?.partyName || 'Shop');

  /**
   * `geo:` lets the phone offer whatever map app is installed; the web URL is
   * the fallback for a device with none, which always resolves to a browser.
   */
  const primary = Platform.OS === 'ios'
    ? `maps://?q=${label}&ll=${latitude},${longitude}`
    : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;
  const fallback = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

  try {
    const supported = await Linking.canOpenURL(primary);
    await Linking.openURL(supported ? primary : fallback);
    return true;
  } catch {
    try {
      await Linking.openURL(fallback);
      return true;
    } catch {
      Alert.alert('Could not open a map', 'No map application is available on this phone.');
      return false;
    }
  }
};
