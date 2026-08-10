import React, { useState, useEffect } from 'react';
import { Image } from 'react-native';

async function safeJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    if (text.startsWith('<')) {
      throw new Error(`Server error (${response.status}): Check backend connection or URL.`);
    }
    throw new Error(text || `HTTP ${response.status} error`);
  }
}

/**
 * Exposes the reusable Firebase Cloud Storage upload handler using signed URLs.
 * 
 * @param {Object} params
 * @param {Object} params.file - The React Native file object { uri, fileName, type, fileSize }
 * @param {string} params.module - The target upload module (e.g. 'collections', 'visits')
 * @param {string} params.relatedModel - The related DB schema model name (e.g. 'Collection')
 * @param {string} [params.relatedId] - The ID of the related model (optional)
 * @param {string} params.token - JWT token for SFA backend
 * @param {string} params.apiUrl - Backend API base URL
 * @param {Function} [params.onProgress] - Callback to report status updates
 */
export async function uploadFile({
  file,
  module,
  relatedModel,
  relatedId,
  token,
  apiUrl,
  onProgress,
}) {
  if (!file || !file.uri) {
    throw new Error('No file selected');
  }

  // 1. Prepare image
  onProgress?.('Preparing image');
  
  // Read local file URI as binary Blob using XMLHttpRequest for maximum React Native compatibility
  const blob = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = function () {
      resolve(xhr.response);
    };
    xhr.onerror = function () {
      reject(new Error('Failed to read local file URI into binary blob'));
    };
    xhr.responseType = 'blob';
    xhr.open('GET', file.uri, true);
    xhr.send();
  });

  // Validate size (5 MB limit)
  const maxBytes = 5 * 1024 * 1024;
  if (blob.size > maxBytes) {
    throw new Error('File size exceeds the 5 MB limit');
  }

  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const contentType = file.type || blob.type || 'image/jpeg';
  if (!allowedTypes.includes(contentType)) {
    throw new Error('Unsupported file format. Please upload JPG, PNG, WebP or PDF');
  }

  const fileName = file.fileName || `upload_${Date.now()}.${contentType.split('/')[1]}`;

  // 2. Request Signed URL
  const signResponse = await fetch(`${apiUrl}/uploads/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      module,
      fileName,
      contentType,
      size: blob.size,
    }),
  });

  const signData = await safeJsonResponse(signResponse);
  if (!signResponse.ok || !signData.success) {
    throw new Error(signData.message || 'Failed to request signed upload URL');
  }

  const { fileId, uploadUrl, storagePath } = signData.data;

  // 3. Upload raw file directly to GCS Signed URL
  onProgress?.('Uploading');
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Firebase GCS upload failed (${uploadResponse.status})`);
  }

  // 4. Confirm upload
  onProgress?.('Confirming upload');
  const confirmResponse = await fetch(`${apiUrl}/uploads/${fileId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      relatedModel,
      relatedId: relatedId || undefined,
    }),
  });

  const confirmData = await safeJsonResponse(confirmResponse);
  if (!confirmResponse.ok || !confirmData.success) {
    throw new Error(confirmData.message || 'File confirmation failed on backend');
  }

  return {
    fileId,
    storagePath,
    contentType,
    size: blob.size,
    originalName: fileName,
  };
}

/**
 * FirebaseImage component resolves and displays private image paths using view-url keys.
 */
export function FirebaseImage({ source, style, token, apiUrl, ...props }) {
  const [resolvedUri, setResolvedUri] = useState(null);

  useEffect(() => {
    let active = true;
    const resolve = async () => {
      const uri = source?.uri;
      if (!uri) {
        setResolvedUri(null);
        return;
      }
      if (/^https?:\/\//i.test(uri)) {
        setResolvedUri(uri);
        return;
      }
      try {
        const res = await fetch(`${apiUrl}/uploads/${encodeURIComponent(uri)}/view-url`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await safeJsonResponse(res);
        if (active && res.ok && data.success) {
          setResolvedUri(data.data.viewUrl);
        }
      } catch (err) {
        console.warn('FirebaseImage resolve error:', err.message);
      }
    };
    resolve();
    return () => {
      active = false;
    };
  }, [source?.uri, token, apiUrl]);

  if (!resolvedUri) return null;

  return <Image source={{ uri: resolvedUri }} style={style} {...props} />;
}
