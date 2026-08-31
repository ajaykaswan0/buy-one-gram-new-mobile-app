/**
 * Uploads a captured photo and returns the storage path to save on the record.
 *
 * The app used to put the whole image into the field as a base64 data URI. That
 * works until you try to view it: a ~180 KB string ends up in the document, the
 * admin asks storage to sign an object whose *name* is that blob, and the
 * browser refuses the resulting URL. It also bloats every visit, party and
 * collection document by the size of a photograph.
 *
 * This sends the bytes through the existing /uploads/proxy endpoint and hands
 * back a short path the server can sign properly.
 */

/**
 * @returns {Promise<string>} the storage path, or the data URI unchanged if the
 * upload could not be made — a salesman standing in a shop with no signal must
 * still be able to finish what he is doing.
 */
export const uploadPhoto = async ({ base64, apiUrl, token, module = 'visits', fileName }) => {
  const dataUri = String(base64 || '').startsWith('data:')
    ? String(base64)
    : `data:image/jpeg;base64,${base64}`;

  if (!base64) return '';

  try {
    const form = new FormData();
    // React Native accepts a data URI as the file uri, so the bytes never have
    // to be decoded in JS.
    form.append('file', {
      uri: dataUri,
      type: 'image/jpeg',
      name: fileName || `${module}-${Date.now()}.jpg`,
    });
    form.append('module', module);

    const response = await fetch(`${apiUrl}/uploads/proxy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // Content-Type is deliberately omitted: fetch must set the multipart
        // boundary itself, and naming it here breaks the upload.
      },
      body: form,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const path = data?.data?.storagePath || data?.storagePath;
    if (!path) throw new Error('No storage path returned');
    return path;
  } catch (error) {
    console.log('[Photo] upload failed, keeping the image inline:', error.message);
    // Falling back to the data URI keeps the visit or collection saveable. The
    // server understands both, so nothing is lost beyond the document size.
    return dataUri;
  }
};

export default uploadPhoto;
