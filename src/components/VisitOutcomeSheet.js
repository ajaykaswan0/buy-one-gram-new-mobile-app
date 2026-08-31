import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, StyleSheet,
  Pressable, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLanguage } from '../i18n';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { bottomBarPadding } from '../utils/systemBars';

/**
 * Asked once the visit is open: did it produce an order?
 *
 * A visit with no outcome recorded is a line in a report nobody can act on.
 * Answering yes leads straight into writing the order; answering no has to
 * carry a reason in his own words, because "no order" alone tells a manager
 * nothing he can act on.
 *
 * `mandatory` removes every way out of the question.
 *
 * The visit is already recorded by the time this is shown, so dismissing it
 * would leave a visit nobody can account for — and that is the one thing the
 * question exists to prevent. There is no Cancel, the backdrop does nothing,
 * and the Android back button is swallowed.
 */
export default function VisitOutcomeSheet({ visible, partyName, busy, mandatory = false, onCancel, onSubmit }) {
  const { t } = useLanguage();
  const [answer, setAnswer] = useState(null); // null | 'yes' | 'no'
  const [note, setNote] = useState('');
  // Some reasons are a problem for someone else to fix, not just a note.
  const [raiseIssue, setRaiseIssue] = useState(false);
  const [issueText, setIssueText] = useState('');

  const close = () => {
    if (mandatory) return;
    setAnswer(null);
    setNote('');
    setRaiseIssue(false);
    setIssueText('');
    onCancel();
  };

  /**
   * Written out, not chosen from a list.
   *
   * A fixed list is quicker to tap but it decides in advance what can be wrong,
   * and the answer that actually matters is usually the one that did not fit
   * any of the options. What he types is what the manager reads.
   */
  const reasonText = note.trim();
  const canSubmitNo = reasonText.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={busy || mandatory ? undefined : close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <Text style={styles.title}>{t('Did you get an order?')}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>{partyName}</Text>

          {answer === null && (
            <View style={styles.answerRow}>
              <TouchableOpacity
                style={[styles.answerBtn, styles.answerYes]}
                onPress={() => onSubmit({ orderReceived: true })}
                disabled={busy}
              >
                <Text style={styles.answerBtnText}>{busy ? t('Please wait') : `✓ ${t('Yes')}`}</Text>
                <Text style={styles.answerHint}>{t('Write it now')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.answerBtn, styles.answerNo]}
                onPress={() => setAnswer('no')}
                disabled={busy}
              >
                <Text style={styles.answerBtnText}>{`✕ ${t('No')}`}</Text>
                <Text style={styles.answerHint}>{t('Tell us why')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {answer === 'no' && (
            <ScrollView style={styles.reasonScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.reasonLabel}>{t('Why was there no order?')}</Text>

              <TextInput
                style={styles.reasonInput}
                placeholder={t('Shop closed, owner away, still has stock, price too high…')}
                placeholderTextColor="#A0AEC0"
                value={note}
                onChangeText={setNote}
                multiline
                autoFocus
                editable={!busy}
              />

              {/*
                A reason explains the visit. An issue asks someone to do
                something about it — a price complaint or a delivery problem is
                not the salesman's to solve, and a note on a visit nobody opens
                is not the same as a ticket someone owns.
              */}
              {canSubmitNo ? (
                <TouchableOpacity
                  style={[styles.issueToggle, raiseIssue && styles.issueToggleActive]}
                  onPress={() => setRaiseIssue(!raiseIssue)}
                  disabled={busy}
                >
                  <Text style={[styles.issueToggleText, raiseIssue && styles.issueToggleTextActive]}>
                    {raiseIssue ? '☑' : '☐'}  {t('Raise this with the office')}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {raiseIssue && (
                <TextInput
                  style={styles.noteInput}
                  placeholder={t('What should the office know or do?')}
                  placeholderTextColor="#A0AEC0"
                  value={issueText}
                  onChangeText={setIssueText}
                  multiline
                  editable={!busy}
                />
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setAnswer(null)} disabled={busy}>
                  <Text style={styles.backBtnText}>{t('Back')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitBtn, (!canSubmitNo || busy) && styles.submitBtnDisabled]}
                  onPress={() => onSubmit({
                    orderReceived: false,
                    noOrderReason: reasonText,
                    // Only raised when he asked for it and actually wrote
                    // something; a ticked box with an empty box helps nobody.
                    issue: raiseIssue && issueText.trim()
                      // The reason is the subject; what he writes for the
                      // office is the detail. Category stays "other" because
                      // nothing here reliably says which it is, and guessing
                      // would only file it somewhere wrong.
                      ? { subject: reasonText.slice(0, 120), description: issueText.trim(), category: 'other' }
                      : null,
                  })}
                  disabled={!canSubmitNo || busy}
                >
                  <Text style={styles.submitBtnText}>
                    {busy ? t('Please wait') : t('Save')}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {answer === null && (mandatory ? (
            <Text style={styles.mandatoryNote}>
              {t('This has to be answered before your next visit.')}
            </Text>
          ) : (
            <TouchableOpacity style={styles.cancelRow} onPress={close} disabled={busy}>
              <Text style={styles.cancelText}>{t('Cancel')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: scale(18),
    paddingTop: verticalScale(10),
    // The sheet sits flush to the bottom of the screen, so it has to clear
    // whatever the system draws there — on a three-button phone the Save
    // button was underneath the navigation bar.
    paddingBottom: verticalScale(10) + bottomBarPadding(),
    maxHeight: '85%',
  },
  grabber: {
    alignSelf: 'center', width: scale(42), height: 4, borderRadius: 2,
    backgroundColor: '#CBD5E0', marginBottom: verticalScale(12),
  },
  title: { fontSize: responsiveFontSize(17), fontWeight: '800', color: '#1A202C' },
  subtitle: { fontSize: responsiveFontSize(12), color: '#718096', marginTop: 2, marginBottom: verticalScale(16) },

  answerRow: { flexDirection: 'row', gap: scale(10) },
  answerBtn: { flex: 1, borderRadius: 12, paddingVertical: verticalScale(16), alignItems: 'center' },
  answerYes: { backgroundColor: '#38A169' },
  answerNo: { backgroundColor: '#E53E3E' },
  answerBtnText: { color: '#FFFFFF', fontSize: responsiveFontSize(15), fontWeight: '800' },
  answerHint: { color: 'rgba(255,255,255,0.85)', fontSize: responsiveFontSize(10), marginTop: 3 },

  reasonScroll: { marginTop: verticalScale(2) },
  reasonLabel: { fontSize: responsiveFontSize(12), fontWeight: '700', color: '#4A5568', marginBottom: verticalScale(8) },
  reasonInput: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: scale(12),
    minHeight: verticalScale(78), textAlignVertical: 'top',
    fontSize: responsiveFontSize(12), color: '#2D3748', marginBottom: verticalScale(10),
  },

  issueToggle: {
    paddingVertical: verticalScale(10), paddingHorizontal: scale(12),
    borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0',
    marginBottom: verticalScale(8), marginTop: verticalScale(2),
  },
  issueToggleActive: { borderColor: '#D69E2E', backgroundColor: '#FFFAF0' },
  issueToggleText: { fontSize: responsiveFontSize(12), color: '#4A5568', fontWeight: '600' },
  issueToggleTextActive: { color: '#B7791F', fontWeight: '700' },
  noteInput: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: scale(12),
    minHeight: verticalScale(64), textAlignVertical: 'top',
    fontSize: responsiveFontSize(12), color: '#2D3748', marginBottom: verticalScale(8),
  },

  footerRow: { flexDirection: 'row', gap: scale(10), marginTop: verticalScale(6) },
  backBtn: { paddingVertical: verticalScale(13), paddingHorizontal: scale(18), borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E0' },
  backBtnText: { color: '#4A5568', fontWeight: '700', fontSize: responsiveFontSize(12) },
  submitBtn: { flex: 1, backgroundColor: '#3182CE', paddingVertical: verticalScale(13), borderRadius: 10, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(13) },

  mandatoryNote: {
    textAlign: 'center', marginTop: verticalScale(14),
    fontSize: responsiveFontSize(10), color: '#A0AEC0',
  },
  cancelRow: { alignItems: 'center', marginTop: verticalScale(14) },
  cancelText: { color: '#718096', fontSize: responsiveFontSize(12), fontWeight: '600' },
});
