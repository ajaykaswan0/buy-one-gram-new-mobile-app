import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, RefreshControl, Modal, Alert, StyleSheet,
} from 'react-native';
import { useLanguage, LANGUAGES } from '../i18n';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { bottomBarPadding } from '../utils/systemBars';

/**
 * The packing bench.
 *
 * A packer has one job: take an order off the queue, pull each line off the
 * shelf, and either send it out packed or say what is missing. So this screen
 * is the whole app for them — no tabs, no attendance, no rate list. Anything
 * else on screen is a thing to get wrong at seven in the morning with a
 * trolley in one hand.
 *
 * Nothing on an order can be edited here. A packer does not decide what the
 * quantity is, only whether it is on the trolley — so a line is packed or it
 * is not, and a packed line leaves the working list and reappears under
 * Packed. The order goes out only when that list is empty; anything left over
 * goes back to management as a reconciliation request rather than shipping
 * short and being discovered at the customer's door.
 */

/** Everything on an order, in kilograms. `baseQuantity` is always kg. */
const weightOf = (items = []) =>
  items.reduce((total, item) => total + (Number(item.baseQuantity) || 0) * (Number(item.quantity) || 0), 0);

const showKg = (kg) => (kg >= 100 ? Math.round(kg) : Math.round(kg * 10) / 10);

export default function PackerDashboardScreen({ token, apiUrl, user }) {
  const { t, term, name, language, setLanguage } = useLanguage();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const [open, setOpen] = useState(null);          // the order being packed
  const [done, setDone] = useState([]);            // positions of the lines already packed
  const [saving, setSaving] = useState(false);
  const [shortNote, setShortNote] = useState('');
  const [shortVisible, setShortVisible] = useState(false);
  const [langVisible, setLangVisible] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      // The packing queue: what the warehouse has released and nobody has
      // packed yet.
      const response = await fetch(`${apiUrl}/order?status=warehouse&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok || body.success === false) throw new Error(body.message || t('Could not load the packing list.'));
      const rows = Array.isArray(body.data) ? body.data : [];
      // Oldest first: a bench works a queue, not a pile.
      rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      setOrders(rows);
    } catch (e) {
      setError(e.message || t('Could not load the packing list.'));
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl, token, t]);

  useEffect(() => { load(); }, [load]);

  /** Order number, party name, code or phone — whatever is on the paper slip. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => {
      const party = order.partyId || {};
      // The transliterated name too, because that is what is on screen — typing
      // what you can read has to find it.
      return [order.orderNumber, party.partyName, name(party.partyName), party.partyCode, party.mobile]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [orders, query, name]);

  const openOrder = (order) => {
    setDone([]);
    setShortNote('');
    setOpen(order);
  };

  /**
   * Lines are held by position, not by variant id: eight orders carry the same
   * variant twice, and ticking one of them would tick both.
   */
  const toggle = (index) => setDone((current) =>
    current.includes(index) ? current.filter((value) => value !== index) : [...current, index]);

  const items = open?.items || [];
  const rows = items.map((item, index) => ({ item, index }));
  const pending = rows.filter(({ index }) => !done.includes(index));
  const finished = rows.filter(({ index }) => done.includes(index));

  /** Sends the order out as packed. Only possible when nothing is left. */
  const confirmPacked = async () => {
    if (!open) return;
    if (pending.length) {
      Alert.alert(t('Not packed yet'), `${t('Please pack the remaining items first.')} (${pending.length})`);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/order/${open._id}/pack`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          // One entry per line, in order — the API matches positionally.
          itemPackDetails: items.map((item) => ({
            variantId: item.variantId,
            isPacked: true,
            packedQuantity: Number(item.quantity),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok || body.success === false) throw new Error(body.message || t('Could not mark this order packed.'));
      Alert.alert(t('Packed'), `${open.orderNumber} ${t('is ready to go out.')}`);
      setOpen(null);
      load();
    } catch (e) {
      Alert.alert(t('Not packed'), e.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Hands the order back to management with what is missing.
   *
   * The note is built from the lines still unpacked so nobody has to type out
   * the shortfall — and anything the packer adds is kept alongside it.
   */
  const sendBackShort = async () => {
    if (!open) return;
    const summary = pending
      .map(({ item }) => `${item.productName} ${item.variantName || ''} × ${item.quantity}`)
      .join('; ');
    const note = [summary && `${t('Missing')}: ${summary}`, shortNote.trim()].filter(Boolean).join(' — ');
    if (!note) { Alert.alert(t('Required'), t('Say what is short.')); return; }

    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/order/${open._id}/reconcile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note }),
      });
      const body = await response.json();
      if (!response.ok || body.success === false) throw new Error(body.message || t('Could not send this order back.'));
      Alert.alert(t('Sent back'), `${open.orderNumber} ${t('has gone to management.')}`);
      setShortVisible(false);
      setOpen(null);
      load();
    } catch (e) {
      Alert.alert(t('Not sent'), e.message);
    } finally {
      setSaving(false);
    }
  };

  /** One line, in either list. Read-only: quantity is not the packer's call. */
  const itemRow = ({ item, index }, packedRow) => (
    <View key={index} style={[styles.itemRow, packedRow && styles.itemRowDone]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemName, packedRow && styles.itemNameDone]}>{name(item.productName)}</Text>
        <Text style={styles.itemMeta}>
          {name(item.variantName) || `${item.packSize}${item.unit || ''}`}
          {'   ·   '}{t('Qty')} {item.quantity}
          {'   ·   '}{showKg((Number(item.baseQuantity) || 0) * (Number(item.quantity) || 0))} {t('kg')}
        </Text>
      </View>
      <TouchableOpacity
        style={packedRow ? styles.undoBtn : styles.tickBtn}
        onPress={() => toggle(index)}
        activeOpacity={0.8}
      >
        <Text style={packedRow ? styles.undoBtnText : styles.tickBtnText}>
          {packedRow ? t('Undo') : t('Pack')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ── The order being packed ────────────────────────────────────────────────
  if (open) {
    const party = open.partyId || {};
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setOpen(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.back}>‹ {t('Back')}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{open.orderNumber}</Text>
            <Text style={styles.subtitle}>{term(open.packingStatus || 'pending')}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.partyCard}>
            <Text style={styles.partyName}>{name(party.partyName) || t('Unknown party')}</Text>
            <Text style={styles.partyMeta}>
              {party.partyCode ? `${t('Code')}: ${party.partyCode}` : ''}
              {party.mobile ? `   ${party.mobile}` : ''}
            </Text>
            {party.address ? <Text style={styles.partyMeta}>{name(party.address)}</Text> : null}
            <View style={styles.totalsRow}>
              <View style={styles.pill}><Text style={styles.pillText}>{items.length} {t('items')}</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>{showKg(weightOf(items))} {t('kg')}</Text></View>
              <View style={[styles.pill, styles.pillDone]}>
                <Text style={[styles.pillText, styles.pillDoneText]}>{finished.length}/{items.length} {t('packed')}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>{t('To pack')} ({pending.length})</Text>
          {pending.length === 0 ? (
            <View style={styles.allDone}>
              <Text style={styles.allDoneText}>{t('Everything is packed. Submit the order.')}</Text>
            </View>
          ) : (
            pending.map((row) => itemRow(row, false))
          )}

          {finished.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, styles.sectionTitleDone]}>{t('Packed')} ({finished.length})</Text>
              {finished.map((row) => itemRow(row, true))}
            </>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.shortBtn, saving && styles.btnBusy]}
            disabled={saving}
            onPress={() => setShortVisible(true)}
          >
            <Text style={styles.shortBtnText}>{t('Raise issue')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.packBtn, pending.length > 0 && styles.btnDisabled, saving && styles.btnBusy]}
            disabled={saving}
            onPress={confirmPacked}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.packBtnText}>{t('Submit')}</Text>}
          </TouchableOpacity>
        </View>

        <Modal visible={shortVisible} transparent animationType="fade" onRequestClose={() => setShortVisible(false)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <TouchableOpacity
                style={styles.closeX}
                onPress={() => setShortVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.closeXText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>{t('Send back to management')}</Text>
              <Text style={styles.sheetText}>
                {pending.length
                  ? `${pending.length} ${t('unpacked item(s) will be listed automatically.')}`
                  : t('Nothing is left unpacked. Add a note explaining the problem.')}
              </Text>
              <TextInput
                style={styles.noteInput}
                placeholder={t('Anything else they should know')}
                placeholderTextColor="#94A3B8"
                value={shortNote}
                onChangeText={setShortNote}
                multiline
              />
              {/* A flex:1 child collapses to nothing inside an auto-height
                  column, which is what left this button blank — so the sheet
                  uses a button with no flex of its own. */}
              <TouchableOpacity
                style={[styles.sheetBtn, saving && styles.btnBusy]}
                disabled={saving}
                onPress={sendBackShort}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.packBtnText}>{t('Send back')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ── The queue ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('Packing')}</Text>
          <Text style={styles.subtitle}>
            {user?.name ? `${user.name} · ` : ''}{orders.length} {t('orders waiting')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.langBtn}
          onPress={() => setLangVisible(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.langBtnText}>
            {(LANGUAGES.find((option) => option.code === language) || LANGUAGES[0]).native}
          </Text>
        </TouchableOpacity>
      </View>

      {/* The packer has no profile screen, so the language lives here. */}
      <Modal visible={langVisible} transparent animationType="fade" onRequestClose={() => setLangVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <TouchableOpacity
              style={styles.closeX}
              onPress={() => setLangVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeXText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>{t('Choose your language')}</Text>
            {LANGUAGES.map((option) => (
              <TouchableOpacity
                key={option.code}
                style={[styles.langRow, language === option.code && styles.langRowActive]}
                onPress={() => { setLanguage(option.code); setLangVisible(false); }}
              >
                <Text style={[styles.langNative, language === option.code && styles.langActiveText]}>
                  {option.native}
                </Text>
                <Text style={[styles.langLabel, language === option.code && styles.langActiveText]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder={t('Search order, party or code')}
          placeholderTextColor="#94A3B8"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity
            style={styles.searchClear}
            onPress={() => setQuery('')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator size="large" color="#00796B" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {visible.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>{query ? t('Nothing found') : t('Nothing to pack')}</Text>
              <Text style={styles.emptyText}>
                {query ? t('No order matches that search.') : t('No orders are waiting at the warehouse.')}
              </Text>
            </View>
          ) : (
            visible.map((order) => {
              const party = order.partyId || {};
              return (
                <TouchableOpacity key={order._id} style={styles.card} activeOpacity={0.85} onPress={() => openOrder(order)}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardNumber} numberOfLines={1}>{order.orderNumber}</Text>
                    <Text style={styles.cardDate}>
                      {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </Text>
                  </View>

                  <Text style={styles.cardParty} numberOfLines={2}>{name(party.partyName) || t('Unknown party')}</Text>
                  {party.partyCode || party.mobile ? (
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {party.partyCode ? `${t('Code')}: ${party.partyCode}` : ''}
                      {party.mobile ? `   ·   ${party.mobile}` : ''}
                    </Text>
                  ) : null}
                  {party.address ? <Text style={styles.cardMeta} numberOfLines={2}>{name(party.address)}</Text> : null}

                  <View style={styles.cardStats}>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{(order.items || []).length}</Text>
                      <Text style={styles.statLabel}>{t('items')}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{showKg(weightOf(order.items))}</Text>
                      <Text style={styles.statLabel}>{t('kg')}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>
                        {(order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}
                      </Text>
                      <Text style={styles.statLabel}>{t('packs')}</Text>
                    </View>
                  </View>

                  {order.packingStatus === 'reconciliation_requested' ? (
                    <Text style={styles.cardFlag}>{t('Sent back — waiting on management')}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9FC' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: scale(14),
    padding: scale(16), backgroundColor: '#00796B',
  },
  back: { color: '#fff', fontWeight: '800', fontSize: responsiveFontSize(13) },
  title: { color: '#fff', fontSize: responsiveFontSize(17), fontWeight: '900' },
  subtitle: { color: '#B2DFDB', fontSize: responsiveFontSize(11), marginTop: 1 },

  langBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999,
    paddingHorizontal: scale(12), paddingVertical: verticalScale(6),
  },
  langBtnText: { color: '#fff', fontWeight: '900', fontSize: responsiveFontSize(12) },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: scale(14), paddingVertical: verticalScale(12),
  },
  langRowActive: { borderColor: '#00796B', backgroundColor: '#E0F2F1' },
  langNative: { fontSize: responsiveFontSize(15), fontWeight: '900', color: '#0F172A' },
  langLabel: { fontSize: responsiveFontSize(11), color: '#94A3B8', fontWeight: '800' },
  langActiveText: { color: '#00695C' },

  searchWrap: { paddingHorizontal: scale(16), paddingTop: verticalScale(12), justifyContent: 'center' },
  search: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: scale(14), paddingVertical: verticalScale(10), paddingRight: scale(40),
    fontSize: responsiveFontSize(13), color: '#0F172A',
  },
  searchClear: { position: 'absolute', right: scale(28), top: verticalScale(24) },
  searchClearText: { color: '#94A3B8', fontSize: responsiveFontSize(14), fontWeight: '900' },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: scale(16), paddingBottom: verticalScale(24) + bottomBarPadding(), gap: verticalScale(12) },
  error: { color: '#B91C1C', marginBottom: verticalScale(8) },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: scale(16),
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: scale(8) },
  cardNumber: { flex: 1, fontSize: responsiveFontSize(13), fontWeight: '900', color: '#00796B' },
  cardDate: { fontSize: responsiveFontSize(11), color: '#94A3B8', fontWeight: '700' },
  cardParty: { fontSize: responsiveFontSize(17), fontWeight: '900', color: '#0F172A', marginTop: verticalScale(8) },
  cardMeta: { fontSize: responsiveFontSize(12), color: '#64748B', marginTop: 3 },
  cardStats: {
    flexDirection: 'row', alignItems: 'center', marginTop: verticalScale(14),
    borderTopWidth: 1, borderTopColor: '#EEF2F7', paddingTop: verticalScale(12),
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: verticalScale(26), backgroundColor: '#EEF2F7' },
  statValue: { fontSize: responsiveFontSize(17), fontWeight: '900', color: '#0F172A' },
  statLabel: {
    fontSize: responsiveFontSize(10), color: '#94A3B8', fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2,
  },
  cardFlag: { fontSize: responsiveFontSize(11), color: '#B45309', fontWeight: '800', marginTop: verticalScale(10) },

  partyCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: scale(14),
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  partyName: { fontSize: responsiveFontSize(16), fontWeight: '900', color: '#0F172A' },
  partyMeta: { fontSize: responsiveFontSize(12), color: '#64748B', marginTop: 3 },
  totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: scale(8), marginTop: verticalScale(12) },
  pill: {
    backgroundColor: '#F1F5F9', borderRadius: 999,
    paddingHorizontal: scale(12), paddingVertical: verticalScale(6),
  },
  pillText: { fontSize: responsiveFontSize(11), fontWeight: '800', color: '#475569' },
  pillDone: { backgroundColor: '#E0F2F1' },
  pillDoneText: { color: '#00695C' },

  sectionTitle: {
    fontSize: responsiveFontSize(11), fontWeight: '900', color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: verticalScale(6),
  },
  sectionTitleDone: { color: '#00796B' },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: scale(12),
    backgroundColor: '#fff', borderRadius: 10, padding: scale(14),
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  itemRowDone: { borderColor: '#B2DFDB', backgroundColor: '#F1F8F7' },
  itemName: { fontSize: responsiveFontSize(14), fontWeight: '800', color: '#0F172A' },
  itemNameDone: { color: '#00695C' },
  itemMeta: { fontSize: responsiveFontSize(12), color: '#64748B', marginTop: 3 },
  tickBtn: {
    backgroundColor: '#00796B', borderRadius: 8,
    paddingHorizontal: scale(18), paddingVertical: verticalScale(10),
  },
  tickBtnText: { color: '#fff', fontWeight: '900', fontSize: responsiveFontSize(12) },
  undoBtn: {
    backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E0',
    paddingHorizontal: scale(16), paddingVertical: verticalScale(10),
  },
  undoBtnText: { color: '#64748B', fontWeight: '900', fontSize: responsiveFontSize(12) },

  allDone: {
    backgroundColor: '#E0F2F1', borderRadius: 10, padding: scale(14),
    borderWidth: 1, borderColor: '#B2DFDB',
  },
  allDoneText: { fontSize: responsiveFontSize(13), color: '#00695C', fontWeight: '800' },

  footer: {
    flexDirection: 'row', gap: scale(10), padding: scale(14),
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0',
    paddingBottom: verticalScale(14) + bottomBarPadding(),
  },
  packBtn: {
    flex: 1, backgroundColor: '#00796B', borderRadius: 10,
    paddingVertical: verticalScale(14), alignItems: 'center', justifyContent: 'center',
  },
  sheetBtn: {
    backgroundColor: '#00796B', borderRadius: 10,
    paddingVertical: verticalScale(14), alignItems: 'center', justifyContent: 'center',
  },
  packBtnText: { color: '#fff', fontWeight: '900', fontSize: responsiveFontSize(13) },
  btnDisabled: { opacity: 0.45 },
  btnBusy: { opacity: 0.7 },
  shortBtn: {
    flex: 1, backgroundColor: '#FEF2F2', borderRadius: 10, borderWidth: 1, borderColor: '#FCA5A5',
    paddingVertical: verticalScale(14), alignItems: 'center', justifyContent: 'center',
  },
  shortBtnText: { color: '#B91C1C', fontWeight: '900', fontSize: responsiveFontSize(13) },

  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: scale(22) },
  sheet: { backgroundColor: '#fff', borderRadius: 14, padding: scale(18), gap: verticalScale(12) },
  sheetTitle: { fontSize: responsiveFontSize(15), fontWeight: '900', color: '#0F172A' },
  sheetText: { fontSize: responsiveFontSize(12), color: '#64748B', lineHeight: responsiveFontSize(18) },
  noteInput: {
    borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, padding: scale(12),
    minHeight: verticalScale(80), textAlignVertical: 'top',
    fontSize: responsiveFontSize(13), color: '#0F172A',
  },
  closeX: {
    position: 'absolute', top: 10, right: 12, width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center', borderRadius: 16,
    backgroundColor: 'rgba(148,163,184,0.18)', zIndex: 5,
  },
  closeXText: { fontSize: 16, fontWeight: '900', color: '#64748B', lineHeight: 18 },

  empty: { alignItems: 'center', padding: scale(40) },
  emptyIcon: { fontSize: responsiveFontSize(40), marginBottom: verticalScale(10) },
  emptyTitle: { fontSize: responsiveFontSize(16), fontWeight: '800', color: '#0F172A' },
  emptyText: { fontSize: responsiveFontSize(12), color: '#94A3B8', textAlign: 'center', marginTop: verticalScale(6) },
});
