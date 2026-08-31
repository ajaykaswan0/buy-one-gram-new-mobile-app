import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Today's log: whether one is open, and its id if the server can use it.
 *
 * These are two different questions and conflating them caused a real problem.
 * A value left in storage by an older build made the server reject the whole
 * visit — "visit validation failed: Cast to ObjectId failed for dailyLogId" —
 * while the salesman stood in the shop. But refusing to start a visit because
 * that value is unusable would be worse: he *is* checked in, and the id is
 * only a link to the day's log.
 *
 * So: `hasActiveLog` answers "is he checked in", and `getActiveLogId` answers
 * "is there an id worth sending". A bad one is dropped and the visit still
 * goes through, losing only the link.
 */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const readStored = async () => {
  const stored = await AsyncStorage.getItem('active_log_id');
  // A value written with JSON.stringify arrives wrapped in quotes.
  return String(stored || '').trim().replace(/^"|"$/g, '');
};

/** Is a day open at all? Any stored value counts. */
export const hasActiveLog = async () => Boolean(await readStored());

/** The id, but only when it is one Mongo will accept. */
export const getActiveLogId = async () => {
  const value = await readStored();
  if (!value) return null;
  if (OBJECT_ID.test(value)) return value;

  console.warn('[dailyLog] stored active_log_id is unusable, dropping it:', value);
  return null;
};
