import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');

/**
 * How each status reads, and what colour it carries.
 *
 * Open and in-progress are the two that still need someone; resolved and closed
 * are the two that do not. The colours say which without being read.
 */
const STATUS = {
  open: { label: 'Open', colour: '#B91C1C', tint: '#FEE2E2' },
  in_progress: { label: 'Being looked at', colour: '#B45309', tint: '#FEF3C7' },
  resolved: { label: 'Resolved', colour: '#047857', tint: '#D1FAE5' },
  closed: { label: 'Closed', colour: '#475569', tint: '#E2E8F0' },
};

const PRIORITY = {
  critical: '#B91C1C',
  high: '#EA580C',
  medium: '#B45309',
  low: '#64748B',
};

export const OPEN_STATUSES = ['open', 'in_progress'];

/**
 * What this shop has raised, and where each one stands.
 *
 * The app could raise an issue and then never mention it again — no list, no
 * status, no answer. A salesman standing in the shop being asked "what happened
 * to my complaint?" had nothing to look at, and would raise it a second time.
 *
 * Read-only on purpose. Answering and resolving belong to whoever the issue was
 * assigned to, on the Assigned Issues screen or in the admin panel; this is for
 * the person in front of the shopkeeper to be able to say what is happening.
 */
export default function PartyIssuesSheet({ visible, token, apiUrl, partyId, partyName, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !partyId) return undefined;
    let alive = true;
    setLoading(true);
    setError('');

    fetch(`${apiUrl}/feedback/party/${partyId}?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        if (!data?.success) throw new Error(data?.message || 'Could not load the issues');
        setRows(Array.isArray(data.data) ? data.data : []);
      })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [visible, partyId, apiUrl, token]);

  const open = rows.filter((row) => OPEN_STATUSES.includes(row.status));
  const settled = rows.filter((row) => !OPEN_STATUSES.includes(row.status));

  const card = (row) => {
    const state = STATUS[row.status] || STATUS.open;
    return (
      <View key={row._id} style={s.issue}>
        <View style={s.issueHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.subject}>{row.subject}</Text>
            <Text style={s.meta}>
              {row.issueNumber || '—'} {'·'} {day(row.createdAt)} {'·'} {row.category}
            </Text>
          </View>
          <View style={[s.badge, { backgroundColor: state.tint }]}>
            <Text style={[s.badgeText, { color: state.colour }]}>{state.label}</Text>
          </View>
        </View>

        <Text style={s.description}>{row.description}</Text>

        <View style={s.footRow}>
          <Text style={[s.priority, { color: PRIORITY[row.priority] || PRIORITY.low }]}>
            {String(row.priority || 'low').toUpperCase()}
          </Text>
          <Text style={s.who}>
            {row.assignedTo?.name ? `With ${row.assignedTo.name}` : 'Not assigned yet'}
          </Text>
        </View>

        {/* The answer, when there is one. This is the whole reason a salesman
            opens this screen in front of the shopkeeper. */}
        {row.resolutionRemark ? (
          <View style={s.answer}>
            <Text style={s.answerLabel}>What was done</Text>
            <Text style={s.answerText}>{row.resolutionRemark}</Text>
            {row.resolvedAt ? <Text style={s.answerWhen}>{day(row.resolvedAt)}</Text> : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Issues</Text>
              <Text style={s.subtitle}>{partyName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {loading ? <ActivityIndicator color="#0F766E" style={{ marginVertical: verticalScale(40) }} /> : (
            <ScrollView style={s.body} showsVerticalScrollIndicator>
              {rows.length === 0 && <Text style={s.empty}>Nothing has been raised for this shop.</Text>}

              {open.length > 0 && (
                <>
                  <Text style={s.section}>Still open · {open.length}</Text>
                  {open.map(card)}
                </>
              )}

              {settled.length > 0 && (
                <>
                  <Text style={[s.section, { color: '#64748B', marginTop: verticalScale(6) }]}>
                    Dealt with · {settled.length}
                  </Text>
                  {settled.map(card)}
                </>
              )}
            </ScrollView>
          )}

          <TouchableOpacity style={s.done} onPress={onClose}>
            <Text style={s.doneText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#F7F9FC', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: scale(16), maxHeight: '92%' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: responsiveFontSize(18), fontWeight: '900', color: '#0F172A' },
  subtitle: { fontSize: responsiveFontSize(11), color: '#64748B', fontWeight: '700', marginTop: verticalScale(2) },
  close: { fontSize: responsiveFontSize(18), color: '#64748B', fontWeight: '900' },
  error: { marginTop: verticalScale(10), padding: scale(10), borderRadius: 8, backgroundColor: '#FEE2E2', color: '#B91C1C', fontWeight: '700' },
  body: { marginTop: verticalScale(12), maxHeight: verticalScale(440) },
  section: { fontSize: responsiveFontSize(11), fontWeight: '900', color: '#0F766E', marginBottom: verticalScale(8) },
  empty: { textAlign: 'center', color: '#64748B', padding: scale(24), fontWeight: '600' },
  issue: { backgroundColor: '#fff', borderRadius: 12, padding: scale(12), marginBottom: verticalScale(10), borderWidth: 1, borderColor: '#E2E8F0' },
  issueHead: { flexDirection: 'row', alignItems: 'flex-start', gap: scale(8) },
  subject: { fontSize: responsiveFontSize(13), fontWeight: '900', color: '#0F172A' },
  meta: { fontSize: responsiveFontSize(9), color: '#94A3B8', fontWeight: '700', marginTop: verticalScale(2) },
  badge: { paddingHorizontal: scale(8), paddingVertical: verticalScale(4), borderRadius: 999 },
  badgeText: { fontSize: responsiveFontSize(9), fontWeight: '900' },
  description: { fontSize: responsiveFontSize(11), color: '#334155', marginTop: verticalScale(8), lineHeight: verticalScale(16) },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: verticalScale(8) },
  priority: { fontSize: responsiveFontSize(9), fontWeight: '900' },
  who: { fontSize: responsiveFontSize(9), color: '#64748B', fontWeight: '700' },
  answer: { marginTop: verticalScale(10), padding: scale(10), borderRadius: 8, backgroundColor: '#F0FDFA', borderLeftWidth: 3, borderLeftColor: '#0F766E' },
  answerLabel: { fontSize: responsiveFontSize(9), fontWeight: '900', color: '#0F766E' },
  answerText: { fontSize: responsiveFontSize(11), color: '#134E4A', marginTop: verticalScale(3), lineHeight: verticalScale(16) },
  answerWhen: { fontSize: responsiveFontSize(9), color: '#64748B', fontWeight: '700', marginTop: verticalScale(4) },
  done: { marginTop: verticalScale(14), padding: scale(14), borderRadius: 12, backgroundColor: '#0F766E', alignItems: 'center' },
  doneText: { fontWeight: '900', color: '#fff' },
});
