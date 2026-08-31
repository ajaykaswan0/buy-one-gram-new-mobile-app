import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, SafeAreaView, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, StyleSheet, Dimensions,
} from 'react-native';
import Pdf from 'react-native-pdf';
import { useLanguage } from '../i18n';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { bottomBarPadding } from '../utils/systemBars';

/**
 * The company's policies and papers, read inside the app.
 *
 * The certificates never leave the app: the server hands over a short-lived
 * signed link, the file is drawn on screen, and nothing is written to storage
 * or passed to another application to open. There is deliberately no share or
 * download control — a GST certificate loose in a downloads folder is a
 * company document nobody controls any more.
 *
 * The policies themselves are plain text rather than another PDF, because they
 * get read aloud in a shop and a paragraph beats pinching at a scan.
 */

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const kindOf = (path, url = '') => {
  const name = String(path || url || '').split('?')[0].toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|bmp)$/.test(name)) return 'image';
  if (/\.pdf$/.test(name)) return 'pdf';
  // Nothing conclusive: an image degrades to a blank frame rather than an
  // error from the PDF renderer.
  return 'image';
};

export default function CompanyPolicySheet({ visible, apiUrl, token, onClose }) {
  const { t } = useLanguage();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);   // { url, kind, name, data }
  const [viewerError, setViewerError] = useState('');
  // Which policy is open. One at a time: three long paragraphs unrolled at
  // once is the wall of text this is meant to avoid.
  const [openPolicy, setOpenPolicy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/app-settings/company-info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not load the policies');
      setInfo(data.data);
    } catch (e) {
      setError(e.message || 'Could not load the policies');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, token]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  /**
   * Opens one paper, fetching a PDF into memory first.
   *
   * The PDF component will happily take the link and download it itself, but on
   * Android that download goes through react-native-blob-util, which calls a
   * transfer incomplete whenever the bytes it counted do not equal the
   * Content-Length header and reports only "Download interrupted." Google's
   * storage serves these files with a correct length and no compression — the
   * miscount is on the device — so the file is fetched here instead, where
   * plain fetch is reliable, and handed over as bytes.
   *
   * Nothing about the promise to the user changes: the document is written to
   * the app's own cache by the viewer, never to a downloads folder, and is
   * never handed to another app.
   */
  const openPaper = useCallback(async (paper, label) => {
    const kind = kindOf(paper.path, paper.url);
    setViewerError('');
    setViewing({ kind, name: paper.name || label, url: paper.url, data: '' });

    // An image loads straight from the link; only the PDF path is affected.
    if (kind !== 'pdf') return;

    try {
      const response = await fetch(paper.url);
      if (!response.ok) throw new Error(`The document could not be fetched (${response.status}).`);

      const blob = await response.blob();
      if (!blob.size) throw new Error('The document came back empty.');
      // Held in memory as base64, which costs about a third more than the file
      // itself. A certificate or a brochure is small; something enormous is
      // refused rather than risking the app being killed mid-read.
      if (blob.size > MAX_DOCUMENT_BYTES) {
        throw new Error('This document is too large to open on a phone.');
      }

      const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('The document could not be read.'));
        reader.readAsDataURL(blob);
      });

      // The viewer recognises this one prefix exactly; storage may label the
      // file octet-stream, which would not match.
      const normalised = dataUri.replace(/^data:[^;]*;base64,/i, 'data:application/pdf;base64,');
      if (!/^data:application\/pdf;base64,./i.test(normalised)) {
        throw new Error('The document did not come back as a PDF.');
      }

      // Backing out mid-fetch must not drag the viewer open again.
      setViewing((current) => (current && current.url === paper.url ? { ...current, data: normalised } : current));
    } catch (e) {
      console.log('[CompanyPolicy] could not open', label, String(e?.message || e));
      setViewerError(String(e?.message || e));
    }
  }, []);

  if (!visible) return null;

  const screen = Dimensions.get('window');
  const policies = [
    ['order', t('Order Policy')],
    ['payment', t('Payment Policy')],
    ['returns', t('Return Policy')],
  ];
  const papers = [
    ['gst', t('View GST'), '📄'],
    ['fssai', t('View FSSAI'), '🧾'],
    ['brochure', t('View Brochure'), '📘'],
  ];

  return (
    <Modal visible animationType="slide" onRequestClose={viewing ? () => { setViewing(null); setViewerError(''); } : onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={viewing ? () => { setViewing(null); setViewerError(''); } : onClose}>
            <Text style={styles.back}>‹ {viewing ? t('Back') : t('Close')}</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {viewing ? viewing.name : t('Company Policy')}
          </Text>
        </View>

        {viewing ? (
          <View style={styles.viewer}>
            {viewerError ? (
              // Failing in place, not behind a spinner that never stops. The
              // reason is shown here rather than only on the screen behind,
              // where it was invisible until you backed out.
              <ScrollView contentContainerStyle={styles.viewerFail}>
                <Text style={styles.viewerFailIcon}>📄</Text>
                <Text style={styles.viewerFailTitle}>{t('This document could not be opened.')}</Text>
                <Text style={styles.viewerFailBody}>{viewerError}</Text>
              </ScrollView>
            ) : viewing.kind === 'pdf' ? (
              viewing.data ? (
                <Pdf
                  // Already in hand, so nothing is fetched again here.
                  source={{ uri: viewing.data }}
                  style={{ flex: 1, width: screen.width }}
                  trustAllCerts={false}
                  onError={(e) => {
                    const detail = String((e && e.message) || e || 'unknown');
                    console.log('[CompanyPolicy] PDF failed', detail);
                    setViewerError(detail);
                  }}
                  renderActivityIndicator={() => <ActivityIndicator size="large" color="#00796B" />}
                />
              ) : (
                <View style={styles.viewerFail}>
                  <ActivityIndicator size="large" color="#00796B" />
                  <Text style={styles.viewerFailBody}>{t('Opening the document…')}</Text>
                </View>
              )
            ) : (
              <Image
                source={{ uri: viewing.url }}
                style={styles.image}
                resizeMode="contain"
                onError={(e) => {
                  const detail = String(e?.nativeEvent?.error || 'unknown');
                  console.log('[CompanyPolicy] image failed', detail);
                  setViewerError(detail);
                }}
              />
            )}
          </View>
        ) : loading ? (
          <View style={styles.centre}><ActivityIndicator size="large" color="#00796B" /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {policies.map(([key, label]) => {
              const text = info?.policies?.[key];
              const open = openPolicy === key;
              return (
                <View key={key} style={styles.card}>
                  <TouchableOpacity
                    style={styles.cardHead}
                    activeOpacity={0.7}
                    onPress={() => setOpenPolicy(open ? '' : key)}
                  >
                    <Text style={styles.cardTitle}>{label}</Text>
                    <Text style={styles.cardChevron}>{open ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {open && (
                    text ? (
                      <Text style={styles.cardBody}>{text}</Text>
                    ) : (
                      <Text style={styles.cardEmpty}>{t('Not set yet.')}</Text>
                    )
                  )}
                </View>
              );
            })}

            <Text style={styles.sectionTitle}>{t('Company documents')}</Text>
            <View style={styles.paperRow}>
              {papers.map(([key, label, icon]) => {
                const paper = info?.documents?.[key];
                const available = Boolean(paper?.url);
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.paper, !available && styles.paperOff]}
                    disabled={!available}
                    onPress={() => openPaper(paper, label)}
                  >
                    <Text style={styles.paperIcon}>{icon}</Text>
                    <Text style={styles.paperLabel}>{label}</Text>
                    {!available && <Text style={styles.paperNote}>{t('Not uploaded')}</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.foot}>
              {t('These documents can be read here only. They cannot be downloaded or opened in another app.')}
            </Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9FC' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: scale(14),
    padding: scale(16), backgroundColor: '#00796B',
  },
  back: { color: '#fff', fontWeight: '800', fontSize: responsiveFontSize(13) },
  title: { color: '#fff', fontSize: responsiveFontSize(16), fontWeight: '900', flex: 1 },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: scale(16), paddingBottom: verticalScale(20) + bottomBarPadding() },
  error: { color: '#B91C1C', marginBottom: verticalScale(10) },

  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: scale(14),
    marginBottom: verticalScale(12), borderWidth: 1, borderColor: '#E2E8F0',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: responsiveFontSize(14), fontWeight: '900', color: '#0F172A', flex: 1 },
  cardChevron: { fontSize: responsiveFontSize(11), color: '#94A3B8', marginLeft: scale(8) },
  cardBody: { fontSize: responsiveFontSize(12), color: '#334155', lineHeight: responsiveFontSize(19), marginTop: verticalScale(8) },
  cardEmpty: { fontSize: responsiveFontSize(12), color: '#94A3B8', fontStyle: 'italic', marginTop: verticalScale(8) },

  sectionTitle: {
    fontSize: responsiveFontSize(11), fontWeight: '900', color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: verticalScale(8), marginBottom: verticalScale(8),
  },
  paperRow: { flexDirection: 'row', gap: scale(10) },
  paper: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, paddingVertical: verticalScale(16),
    alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  paperOff: { opacity: 0.45 },
  paperIcon: { fontSize: responsiveFontSize(22) },
  paperLabel: { fontSize: responsiveFontSize(11), fontWeight: '800', color: '#0F172A', marginTop: verticalScale(6), textAlign: 'center' },
  paperNote: { fontSize: responsiveFontSize(9), color: '#94A3B8', marginTop: 2 },

  foot: {
    fontSize: responsiveFontSize(10), color: '#94A3B8', textAlign: 'center',
    marginTop: verticalScale(18), lineHeight: responsiveFontSize(15),
  },

  viewer: { flex: 1, backgroundColor: '#0F172A' },
  viewerFail: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: scale(28) },
  viewerFailIcon: { fontSize: responsiveFontSize(34), marginBottom: verticalScale(10) },
  viewerFailTitle: { color: '#fff', fontSize: responsiveFontSize(14), fontWeight: '800', textAlign: 'center' },
  viewerFailBody: {
    color: '#94A3B8', fontSize: responsiveFontSize(11), textAlign: 'center',
    marginTop: verticalScale(10), lineHeight: responsiveFontSize(17),
  },
  image: { flex: 1, width: '100%' },
});
