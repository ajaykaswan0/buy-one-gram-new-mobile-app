/**
 * Reads a JSON reply without exploding on one that is not JSON.
 *
 * A missing route answers with an HTML error page, and calling response.json()
 * on that throws "JSON Parse error: Unexpected character: <" — which tells the
 * salesman nothing and sounds like the app is broken. What actually happened is
 * that the server does not have the feature yet, or something upstream returned
 * a page instead of data, and the message should say so.
 */
export const readJson = async (response, what = 'The server') => {
  const text = await response.text().catch(() => '');

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (body) {
    if (!response.ok) {
      const error = new Error(body.message || `${what} refused the request (${response.status})`);
      error.status = response.status;
      error.data = body.data;
      throw error;
    }
    return body;
  }

  // Not JSON at all.
  if (response.status === 404) {
    throw new Error(`${what} does not have this feature yet. It needs the latest update.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('You do not have access to this.');
  }
  const error = new Error(
    response.ok
      ? `${what} sent something the app could not read.`
      : `${what} returned an error (${response.status}).`
  );
  error.status = response.status;
  throw error;
};
