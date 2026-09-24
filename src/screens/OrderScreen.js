import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../i18n';
import CreditLimitRequestModal from '../components/CreditLimitRequestModal';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  SafeAreaView,
  ScrollView,
  Alert,
  Image,
  Modal,
  RefreshControl,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { packLabel, perKgLabel } from '../utils/packLabel';

// Not a category name anyone can type, so it cannot collide with a real one.
const ALL_CATEGORIES = '__all__';

export default function OrderScreen({ token, apiUrl, user, preSelectedParty, onBack }) {
  const { t, term, name } = useLanguage();
  const [selectedParty, setSelectedParty] = useState(preSelectedParty || null);
  const [parties, setParties] = useState([]);
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [loadingParties, setLoadingParties] = useState(false);

  // Products & Order creation states
  const [products, setProducts] = useState([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(null);
  
  // Stock mapping: { [variantId]: quantity }
  const [stockMap, setStockMap] = useState({});
  const [loadingStockMap, setLoadingStockMap] = useState({});

  // Order Cart state: { [variantId]: { product, variant, quantity, rate } }
  const [orderItems, setOrderItems] = useState({});

  // Custom rates entered by user: { [variantId]: price_string_or_number }
  const [customRates, setCustomRates] = useState({});

  const [orderNotes, setOrderNotes] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Immediate');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Offers this salesman may apply, priced by the server against the basket.
  const [offers, setOffers] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [offerPickerVisible, setOfferPickerVisible] = useState(false);
  const [loadingOffers, setLoadingOffers] = useState(false);
  // The party's ceiling and what it already owes, refreshed on open so the
  // check is against today's figure and not whatever the list was cached with.
  const [creditInfo, setCreditInfo] = useState({ limit: 0, outstanding: 0 });
  const [creditBlock, setCreditBlock] = useState(null);
  const [creditRequestOpen, setCreditRequestOpen] = useState(false);

  /**
   * What the office offers, and the smallest order it will take.
   *
   * Both were written into this screen, so adding "Net 90 Days" or raising the
   * floor meant a release and a reinstall on every phone. They come from
   * Settings now. The list below is only what is shown until the fetch answers,
   * and what is fallen back to if it fails - a salesman standing in a shop with
   * no signal still needs to be able to place an order.
   */
  const [paymentOptions, setPaymentOptions] = useState([
    'Immediate',
    'Advance',
    'Cash on Delivery (COD)',
    'Net 7 Days',
    'Net 15 Days',
    'Net 30 Days',
    'Net 45 Days',
    'Net 60 Days',
  ]);
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(0);
  const [reviewVisible, setReviewVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${apiUrl}/app-settings/company-info`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const rules = data?.data?.ordering;
        if (Array.isArray(rules?.paymentTerms) && rules.paymentTerms.length) {
          setPaymentOptions(rules.paymentTerms);
        }
        setMinimumOrderAmount(Number(rules?.minimumOrderAmount || 0));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [apiUrl, token]);

  const PAYMENT_OPTIONS = paymentOptions;

  // Search parties if not pre-selected
  useEffect(() => {
    if (!selectedParty && partySearchQuery.trim().length > 0) {
      const delayDebounce = setTimeout(() => {
        searchParties();
      }, 300);
      return () => clearTimeout(delayDebounce);
    } else {
      setParties([]);
    }
  }, [partySearchQuery, selectedParty]);

  // Load initial parties initially if no pre-selection and no search query
  useEffect(() => {
    if (!selectedParty && partySearchQuery.trim().length === 0) {
      loadInitialParties();
    }
  }, [selectedParty, partySearchQuery]);

  // Load products when a party is selected
  useEffect(() => {
    if (selectedParty) {
      fetchProducts();
      loadDraftOrder(selectedParty._id);
      // Seed from the party we were handed, then confirm against the server —
      // a cached list can be hours old and the limit has to be current.
      setCreditInfo({
        limit: Number(selectedParty.creditLimit || 0),
        outstanding: Number(selectedParty.currentOutstanding || 0),
      });
      fetch(`${apiUrl}/parties/${selectedParty._id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json())
        .then((body) => {
          const fresh = body?.data;
          if (!fresh) return;
          setCreditInfo({
            limit: Number(fresh.creditLimit || 0),
            outstanding: Number(fresh.currentOutstanding || 0),
          });
        })
        .catch(() => { /* the seeded figures will do */ });
    }
  }, [selectedParty]);

  // Pull down to reload, so the screen can be refreshed in place rather than
  // by navigating away and back.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchProducts();
    } catch (e) {
      console.log('[Refresh] failed:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, [fetchProducts]);

  const loadInitialParties = async () => {
    setLoadingParties(true);
    try {
      const partyEndpoint = user?.role === 'cso' ? '/parties?limit=100' : '/parties/my';
      const response = await fetch(`${apiUrl}${partyEndpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setParties(data.data || []);
      }
    } catch (e) {
      console.warn('Failed to load initial parties:', e.message);
    } finally {
      setLoadingParties(false);
    }
  };

  const searchParties = async () => {
    setLoadingParties(true);
    try {
      const response = await fetch(
        `${apiUrl}/parties?search=${encodeURIComponent(partySearchQuery.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (response.ok) {
        setParties(data.data || []);
      }
    } catch (e) {
      console.warn('Search parties failed:', e.message);
    } finally {
      setLoadingParties(false);
    }
  };

  const handleSelectParty = (party) => {
    setSelectedParty(party);
    setPartySearchQuery('');
    setParties([]);
  };

  const handleClearParty = () => {
    setSelectedParty(null);
    setOrderItems({});
    setOrderNotes('');
    setPaymentTerms('Immediate');
    loadInitialParties();
  };

  const fetchProducts = async () => {
    setLoadingProducts(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [productResponse, priceResponse, stockResponse] = await Promise.all([
        fetch(`${apiUrl}/product?limit=100&productType=finished_goods`, { headers }),
        fetch(`${apiUrl}/price-list/manufacturing?page=1&limit=100`, { headers }),
        fetch(`${apiUrl}/inventory/stock?stockType=finished_goods&limit=100`, { headers }),
      ]);
      const [productData, priceData, stockData] = await Promise.all([
        productResponse.json(), priceResponse.json(), stockResponse.json(),
      ]);
      if (!productResponse.ok || !productData.success) throw new Error(productData.message || 'Products could not be loaded');
      if (!priceResponse.ok || !priceData.success) throw new Error(priceData.message || 'Sales price list could not be loaded');
      if (!stockResponse.ok || !stockData.success) throw new Error(stockData.message || 'Product inventory could not be loaded');

      const prices = new Map((priceData.data || []).map((item) => [String(item.variantId), item]));
      const inventoryRows = stockData.data || [];
      const warehouseId = inventoryRows[0]?.warehouse?._id || inventoryRows[0]?.warehouse || null;
      setSelectedWarehouseId(warehouseId);
      const nextStock = {};
      inventoryRows
        .filter((item) => !warehouseId || String(item.warehouse?._id || item.warehouse) === String(warehouseId))
        .forEach((item) => {
          const rawVId = item.variantId?._id || item.variantId;
          const vKey = rawVId ? String(rawVId) : null;
          const avail = Math.max(0, Number(item.availableQuantity ?? (Number(item.quantity || 0) - Number(item.reservedQuantity || 0))));
          if (vKey) {
            nextStock[vKey] = (nextStock[vKey] || 0) + avail;
          }
          if (item.sku) {
            nextStock[String(item.sku)] = (nextStock[String(item.sku)] || 0) + avail;
          }
        });
      setStockMap(nextStock);

      const enrichedProducts = (productData.data || []).map((product) => ({
        ...product,
        variants: (product.variants || []).map((variant) => {
          const priced = prices.get(String(variant._id));
          return {
            ...variant,
            salesPrice: Number(priced?.finalSellingPrice || 0),
            mrp: Number(priced?.mrp || 0),
            hasActivePrice: Boolean(priced && Number(priced.finalSellingPrice) >= 0),
          };
        }),
      }));
      setProducts(enrichedProducts);

      // Drafts may contain yesterday's price/stock snapshot. Reconcile every
      // draft line with the freshly loaded server catalogue before display.
      setOrderItems((current) => {
        const next = {};
        Object.entries(current).forEach(([variantId, item]) => {
          const product = enrichedProducts.find((entry) => entry.variants?.some((variant) => String(variant._id) === String(variantId)));
          const variant = product?.variants?.find((entry) => String(entry._id) === String(variantId));
          const available = Number(nextStock[String(variantId)] || 0);
          if (!product || !variant?.hasActivePrice || available <= 0) return;
          next[variantId] = {
            ...item,
            product: { _id: product._id, productName: product.productName },
            variant: { ...item.variant, ...variant },
            quantity: Math.min(Number(item.quantity || 0), available),
            rate: variant.salesPrice,
          };
        });
        return next;
      });
      setCustomRates((current) => Object.fromEntries(Object.keys(current).map((variantId) => {
        const product = enrichedProducts.find((entry) => entry.variants?.some((variant) => String(variant._id) === String(variantId)));
        const variant = product?.variants?.find((entry) => String(entry._id) === String(variantId));
        return [variantId, Number(variant?.salesPrice || 0)];
      })));
    } catch (e) {
      console.warn('Failed to fetch products:', e.message);
      Alert.alert('Products unavailable', e.message);
      setProducts([]);
      setStockMap({});
    } finally {
      setLoadingProducts(false);
    }
  };

  const fetchProductStock = async (productId) => {
    // Inventory is loaded in one authoritative warehouse-scoped request with
    // the price list. Never manufacture fallback stock on the device.
    return productId;
  };

  // Draft saving & loading
  const loadDraftOrder = async (partyId) => {
    try {
      const draftStr = await AsyncStorage.getItem(`draft_order_${partyId}`);
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        setOrderItems(draft.orderItems || {});
        setPaymentTerms(draft.paymentTerms || 'Immediate');
        setOrderNotes(draft.orderNotes || '');

        // Rehydrate customRates from loaded orderItems
        const loadedRates = {};
        Object.keys(draft.orderItems || {}).forEach(vId => {
          loadedRates[vId] = draft.orderItems[vId].rate;
        });
        setCustomRates(loadedRates);
        
        Alert.alert('Draft Loaded', 'You have a saved draft order for this customer.');
      }
    } catch (e) {
      console.warn('Failed to load draft:', e.message);
    }
  };

  const saveDraftOrder = async () => {
    if (!selectedParty) return;
    try {
      const draft = {
        orderItems,
        paymentTerms,
        orderNotes,
      };
      await AsyncStorage.setItem(`draft_order_${selectedParty._id}`, JSON.stringify(draft));
      Alert.alert('Draft Saved', 'Your order progress for this party has been saved.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save draft order.');
    }
  };

  const clearDraftOrder = async (partyId) => {
    try {
      await AsyncStorage.removeItem(`draft_order_${partyId}`);
    } catch (e) {
      console.warn('Failed to clear draft:', e.message);
    }
  };

  // Quantity updates
  const updateQuantity = (product, variant, newQty) => {
    const variantId = variant._id;
    const availableStock = stockMap[variantId] !== undefined ? stockMap[variantId] : 0;

    if (newQty > availableStock) {
      Alert.alert('Out of Stock', `Only ${availableStock} units available in stock.`);
      newQty = availableStock;
    }

    /**
     * Stop at the ceiling, not at submit.
     *
     * Only an increase is checked — reducing a quantity or removing a line has
     * to stay possible, otherwise a salesman who tips over the limit would be
     * unable to bring the order back down again.
     */
    const currentQty = Number(orderItems[variantId]?.quantity || 0);
    if (newQty > currentQty) {
      const custom = customRates[variantId] !== undefined ? parseFloat(customRates[variantId]) : variant.salesPrice;
      const rate = isNaN(custom) || custom < variant.salesPrice ? variant.salesPrice : custom;
      const extra = (newQty - currentQty) * Number(rate || 0);
      if (wouldExceedCredit(extra)) {
        setCreditBlock({
          productName: `${name(product.productName)} ${variant.variantName || ''}`.trim(),
          extra,
        });
        return;
      }
    }

    setOrderItems(prev => {
      const updated = { ...prev };
      if (newQty <= 0) {
        delete updated[variantId];
      } else {
        const existing = updated[variantId];
        const customPrice = customRates[variantId] !== undefined ? parseFloat(customRates[variantId]) : variant.salesPrice;
        const rate = isNaN(customPrice) || customPrice < variant.salesPrice ? variant.salesPrice : customPrice;
        updated[variantId] = {
          product: {
            _id: product._id,
            productName: product.productName,
          },
          variant: {
            _id: variant._id,
            variantName: variant.variantName,
            sku: variant.sku,
            packSize: variant.packSize,
            unit: variant.unit,
            salesPrice: variant.salesPrice,
            gstPercentage: variant.gstPercentage || 0,
          },
          quantity: newQty,
          rate: rate,
        };
      }
      return updated;
    });
  };

  // Helper to resolve stock value
  const getResolvedStock = (variantId, sku) => {
    const vIdStr = String(variantId);
    if (stockMap[vIdStr] !== undefined) return stockMap[vIdStr];
    if (sku && stockMap[String(sku)] !== undefined) return stockMap[String(sku)];
    return loadingProducts ? undefined : 0;
  };

  // Price updates
  const handlePriceChange = (product, variant, newPrice, minPrice) => {
    const finalPrice = newPrice < minPrice ? minPrice : newPrice;
    const variantId = variant._id;
    setCustomRates(prev => ({ ...prev, [variantId]: finalPrice }));

    setOrderItems(prev => {
      const updated = { ...prev };
      if (updated[variantId]) {
        updated[variantId] = {
          ...updated[variantId],
          rate: finalPrice,
        };
      } else {
        const avail = getResolvedStock(variant._id, variant.sku);
        if (avail === undefined || avail <= 0) {
          Alert.alert('Out of Stock', `${name(variant.variantName)} is out of stock.`);
          return updated;
        }
        // Auto-add to order if price is adjusted and stock exists
        updated[variantId] = {
          product: {
            _id: product._id,
            productName: product.productName,
          },
          variant: {
            _id: variant._id,
            variantName: variant.variantName,
            sku: variant.sku,
            packSize: variant.packSize,
            unit: variant.unit,
            salesPrice: variant.salesPrice,
            gstPercentage: variant.gstPercentage || 0,
          },
          quantity: 1,
          rate: finalPrice,
        };
      }
      return updated;
    });
  };

  const handlePriceTextChange = (product, variant, text, minPrice) => {
    const variantId = variant._id;
    setCustomRates(prev => ({ ...prev, [variantId]: text }));

    const parsed = parseFloat(text);
    if (!isNaN(parsed)) {
      setOrderItems(prev => {
        const updated = { ...prev };
        if (updated[variantId]) {
          updated[variantId] = {
            ...updated[variantId],
            rate: parsed,
          };
        } else {
          const avail = getResolvedStock(variant._id, variant.sku);
          if (avail === undefined || avail <= 0) {
            return updated;
          }
          // Auto-add to order
          updated[variantId] = {
            product: {
              _id: product._id,
              productName: product.productName,
            },
            variant: {
              _id: variant._id,
              variantName: variant.variantName,
              sku: variant.sku,
              packSize: variant.packSize,
              unit: variant.unit,
              salesPrice: variant.salesPrice,
              gstPercentage: variant.gstPercentage || 0,
            },
            quantity: 1,
            rate: parsed,
          };
        }
        return updated;
      });
    }
  };

  const handlePriceBlur = (product, variant, currentVal, minPrice) => {
    const variantId = variant._id;
    const parsed = parseFloat(currentVal);
    let finalPrice = isNaN(parsed) ? minPrice : parsed;
    if (finalPrice < minPrice) {
      finalPrice = minPrice;
      Alert.alert('Price Notice', `Price cannot be reduced by more than ₹1 below default rate (Min: ₹${minPrice})`);
    }

    setCustomRates(prev => ({ ...prev, [variantId]: finalPrice }));

    setOrderItems(prev => {
      const updated = { ...prev };
      if (updated[variantId]) {
        updated[variantId] = {
          ...updated[variantId],
          rate: finalPrice,
        };
      } else {
        const avail = getResolvedStock(variant._id, variant.sku);
        if (avail === undefined || avail <= 0) {
          return updated;
        }
        // Auto-add to order
        updated[variantId] = {
          product: {
            _id: product._id,
            productName: product.productName,
          },
          variant: {
            _id: variant._id,
            variantName: variant.variantName,
            sku: variant.sku,
            packSize: variant.packSize,
            unit: variant.unit,
            salesPrice: variant.salesPrice,
            gstPercentage: variant.gstPercentage || 0,
          },
          quantity: 1,
          rate: finalPrice,
        };
      }
      return updated;
    });
  };

  /**
   * The categories actually on the shelf, with how many products each holds.
   *
   * Built from the catalogue rather than a fixed list, so a category added in
   * admin turns up here without a release. Counts are shown because "Spices 2"
   * tells a salesman whether it is worth tapping.
   */
  const categories = (() => {
    const counts = new Map();
    for (const product of products) {
      const name = (product.category || '').trim() || 'Uncategorised';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [
      { name: ALL_CATEGORIES, count: products.length },
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
    ];
  })();

  const inSelectedCategory = (product) => {
    if (selectedCategory === ALL_CATEGORIES) return true;
    const name = (product.category || '').trim() || 'Uncategorised';
    return name === selectedCategory;
  };

  // Both filters apply together: a search inside a category searches that
  // category, which is what picking one is for.
  const filteredProducts = products.filter((p) => {
    if (!inSelectedCategory(p)) return false;
    if (!productSearchQuery.trim()) return true;
    const q = productSearchQuery.toLowerCase();
    return (
      p.productName?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.productCode?.toLowerCase().includes(q)
    );
  });

  // Totals calculations
  const itemsArray = Object.values(orderItems);
  const totalQty = itemsArray.reduce((sum, item) => sum + item.quantity, 0);
  const subTotal = itemsArray.reduce((sum, item) => sum + (item.quantity * item.rate), 0);

  // The chosen offer's discount, per line, exactly as the server priced it —
  // the app never works a discount out for itself.
  const chosenOffer = offers.find(o => String(o.offerId) === String(selectedOfferId) && o.eligible) || null;
  // Only what can actually be applied is offered for selection; the rest are
  // shown inside the popup with the reason, never as a pickable row.
  const eligibleOffers = offers.filter(o => o.eligible);
  const blockedOffers = offers.filter(o => !o.eligible);
  const bestOffer = eligibleOffers.reduce(
    (best, o) => (!best || Number(o.discountAmount) > Number(best.discountAmount) ? o : best),
    null,
  );
  const discountByLine = {};
  if (chosenOffer) {
    (chosenOffer.lineDiscounts || []).forEach(entry => { discountByLine[entry.index] = Number(entry.discount || 0); });
  }
  const discountTotal = chosenOffer ? Number(chosenOffer.discountAmount || 0) : 0;

  // GST follows the discount down, matching how the order is totalled on save.
  const taxTotal = itemsArray.reduce((sum, item, index) => {
    const taxable = (item.quantity * item.rate) - (discountByLine[index] || 0);
    return sum + (taxable * (item.variant.gstPercentage || 0) / 100);
  }, 0);
  const grandTotal = subTotal - discountTotal + taxTotal;

  const paymentTypeCode = paymentTerms === 'Cash on Delivery (COD)' ? 'cod'
    : paymentTerms === 'Advance' ? 'prepaid' : 'credit';

  const formatMoney = (value) => Number.isFinite(Number(value))
    ? `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    : '₹0';

  /**
   * What is left on the party's credit, and whether this order fits.
   *
   * Only credit terms consume it — cash on delivery and advance are settled at
   * or before delivery and never become a receivable, which is why the popup
   * offers COD as the way through rather than simply refusing the order.
   */
  const creditLimit = Number(creditInfo.limit || 0);
  const usesCredit = paymentTypeCode === 'credit';
  const availableCredit = creditLimit > 0
    ? Math.max(0, creditLimit - Number(creditInfo.outstanding || 0))
    : Infinity;
  const overCreditLimit = usesCredit && creditLimit > 0 && grandTotal > availableCredit;

  /**
   * Whether one more line would break the ceiling.
   *
   * Checked before the item goes in, so the salesman is stopped at the moment
   * he adds it rather than after he has built the whole order and pressed
   * submit — which is what the server-side check alone would have done.
   */
  const wouldExceedCredit = (addedAmount) => {
    if (!usesCredit || creditLimit <= 0) return false;
    return grandTotal + Number(addedAmount || 0) > availableCredit + 0.01;
  };

  /**
   * Asks the server which offers apply to the basket and what each is worth.
   *
   * Quoted server-side because only it knows the real price-list rates, and
   * because a discount the app worked out for itself could never be trusted.
   * Debounced so changing a quantity does not fire a request per tap.
   */
  useEffect(() => {
    const lines = Object.values(orderItems);
    if (!selectedParty || lines.length === 0) {
      setOffers([]);
      return undefined;
    }
    let active = true;
    setLoadingOffers(true);
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/order/applicable-offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          partyId: selectedParty._id,
          paymentType: paymentTypeCode,
          items: lines.map(item => ({
            productId: item.product._id,
            variantId: item.variant._id,
            quantity: item.quantity,
            rate: item.rate,
          })),
        }),
      })
        .then(res => res.json())
        .then(data => { if (active) setOffers(Array.isArray(data?.data) ? data.data : []); })
        .catch(() => { if (active) setOffers([]); })
        .finally(() => { if (active) setLoadingOffers(false); });
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [orderItems, selectedParty, paymentTypeCode, apiUrl, token]);

  // Editing the basket can make the chosen offer stop qualifying; clearing it
  // keeps the total on screen equal to what the server will charge.
  useEffect(() => {
    if (!selectedOfferId) return;
    const still = offers.find(o => String(o.offerId) === String(selectedOfferId));
    if (offers.length && (!still || !still.eligible)) setSelectedOfferId('');
  }, [offers, selectedOfferId]);

  // The office's floor, against this order's total. Zero means no floor.
  const belowMinimum = minimumOrderAmount > 0 && grandTotal < minimumOrderAmount;

  /**
   * Nothing goes out until it has been read back.
   *
   * An order was placed the moment Submit was tapped, so a wrong quantity or the
   * wrong payment term was only found once the order existed and had to be
   * cancelled and re-entered. The same tap now shows the whole order — shop,
   * every line, the discount, the tax, the total and the terms — and the
   * salesman either confirms it or goes back and changes it.
   *
   * The checks run before the review rather than after: there is no sense
   * reading back an order that is already too small to place.
   */
  const openReview = () => {
    if (!selectedParty) {
      Alert.alert('Error', 'Please select a party first.');
      return;
    }

    if (itemsArray.length === 0) {
      Alert.alert('Error', 'Please add at least one item to the order.');
      return;
    }

    // The office sets a floor in Settings. The server refuses below it
    // too; saying so here means the salesman finds out with the shopkeeper
    // still in front of him, in time to add something.
    if (belowMinimum) {
      Alert.alert(
        'Order is too small',
        `The smallest order we take is ₹${minimumOrderAmount.toLocaleString('en-IN')}. This one is ₹${grandTotal.toLocaleString('en-IN')} — add ₹${(minimumOrderAmount - grandTotal).toLocaleString('en-IN')} more.`,
      );
      return;
    }

    setReviewVisible(true);
  };

  const handleSubmitOrder = async () => {
    setReviewVisible(false);
    setIsSubmitting(true);
    try {
      const payloadItems = itemsArray.map(item => ({
        productId: item.product._id,
        variantId: item.variant._id,
        quantity: item.quantity,
        rate: item.rate,
      }));

      const payload = {
        partyId: selectedParty._id,
        warehouseId: selectedWarehouseId,
        source: 'phone',
        paymentType: paymentTypeCode,
        items: payloadItems,
        offerId: selectedOfferId || null,
        remarks: `Payment Terms: ${paymentTerms}. Notes: ${orderNotes}`,
      };

      const response = await fetch(`${apiUrl}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const resData = await response.json();

      if (response.ok && resData.success) {
        Alert.alert(
          'Order Success',
          `Order ${resData.data?.orderNumber || ''} created successfully!`,
          [{ text: 'OK', onPress: () => {
            clearDraftOrder(selectedParty._id);
            onBack();
          }}]
        );
      } else {
        Alert.alert('Order Failed', resData.message || 'Failed to place order.');
      }
    } catch (e) {
      Alert.alert('Order Error', 'Network error placing order.');
      console.warn('Order place error:', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExpandProduct = (productId) => {
    const isExpanded = expandedProduct === productId;
    setExpandedProduct(isExpanded ? null : productId);
    if (!isExpanded) {
      fetchProductStock(productId);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create New Order</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={['#00796B']} tintColor="#00796B" />
        }
      >
        {/* Step 1: Party Selection */}
        {!selectedParty ? (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Step 1: Select Party / Customer</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Type to search party by Name, Code, Mobile..."
              placeholderTextColor="#A0AEC0"
              value={partySearchQuery}
              onChangeText={setPartySearchQuery}
            />

            {loadingParties ? (
              <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.partiesList}>
                {parties.length === 0 ? (
                  <Text style={styles.emptyText}>No parties found. Type to search.</Text>
                ) : (
                  parties.map((party) => (
                    <TouchableOpacity
                      key={party._id}
                      style={styles.partySelectCard}
                      onPress={() => handleSelectParty(party)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={name(styles.partyName)}>{name(party.partyName)}</Text>
                        <Text style={styles.partyCode}>Code: {party.partyCode} • 📞 {party.mobile}</Text>
                        <Text style={styles.partyAddr}>{party.address}</Text>
                      </View>
                      <Text style={styles.selectArrow}>➔</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}
          </View>
        ) : (
          /* Party Selected Card */
          <View style={styles.selectedPartyCard}>
            <View style={styles.selectedPartyHeader}>
              <Text style={styles.selectedPartyLabel}>Selected Customer</Text>
              <TouchableOpacity onPress={handleClearParty}>
                <Text style={styles.changePartyBtn}>Change Party</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.selectedPartyName}>{name(selectedParty.partyName)}</Text>
            <Text style={styles.selectedPartyCode}>Code: {selectedParty.partyCode} | Mobile: {selectedParty.mobile}</Text>
            <Text style={styles.selectedPartyAddr}>📍 {selectedParty.address}</Text>
            
            {selectedParty.currentOutstanding !== undefined && (
              <View style={styles.outstandingBadge}>
                <Text style={styles.outstandingText}>
                  Outstanding: ₹{selectedParty.currentOutstanding.toLocaleString('en-IN')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* A shop the office has not accepted takes no order. The server
            refuses it too; this stops the salesman building a whole basket
            first and being turned away at the end. */}
        {selectedParty && selectedParty.approvalStatus === 'pending' && (
          <View style={styles.awaitingApproval}>
            <Text style={styles.awaitingApprovalTitle}>Waiting for approval</Text>
            <Text style={styles.awaitingApprovalText}>
              {`${selectedParty.partyName} is new. You can visit it, but an order has to wait until the office accepts it.`}
            </Text>
          </View>
        )}
        {selectedParty && selectedParty.approvalStatus === 'rejected' && (
          <View style={[styles.awaitingApproval, styles.rejectedBox]}>
            <Text style={[styles.awaitingApprovalTitle, { color: '#FFFFFF' }]}>Not accepted</Text>
            <Text style={[styles.awaitingApprovalText, { color: '#FFF5F5' }]}>
              {`The office did not accept ${selectedParty.partyName}${selectedParty.approvalRemarks ? `: ${selectedParty.approvalRemarks}` : ''}. No order can be placed against it.`}
            </Text>
          </View>
        )}

        {/* Step 2: Order Catalog & Details */}
        {selectedParty && !['pending', 'rejected'].includes(selectedParty.approvalStatus) && (
          <View style={styles.formContainer}>
            <View style={styles.catalogHeader}>
              <Text style={styles.stepTitle}>Step 2: Add Products</Text>
              <TouchableOpacity style={styles.saveDraftBtn} onPress={saveDraftOrder}>
                <Text style={styles.saveDraftBtnText}>💾 Save Draft</Text>
              </TouchableOpacity>
            </View>

            {/* Product Search Inside Order */}
            <TextInput
              style={styles.searchInput}
              placeholder="Search products in catalog..."
              placeholderTextColor="#A0AEC0"
              value={productSearchQuery}
              onChangeText={setProductSearchQuery}
            />

            {/*
              * The shelf, split by category.
              *
              * A salesman knows what he wants by aisle before he knows its
              * name, and scrolling one long catalogue in a shop doorway is
              * slow. "All" stays first, so the old behaviour is one tap away.
              */}
            {categories.length > 2 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryStrip}
              >
                {categories.map((category) => {
                  const active = selectedCategory === category.name;
                  return (
                    <TouchableOpacity
                      key={category.name}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                      onPress={() => setSelectedCategory(category.name)}
                    >
                      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                        {category.name === ALL_CATEGORIES ? 'All' : category.name}
                      </Text>
                      <Text style={[styles.categoryChipCount, active && styles.categoryChipCountActive]}>
                        {category.count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {loadingProducts ? (
              <ActivityIndicator color="#00796B" style={{ marginVertical: 30 }} />
            ) : (
              <View style={styles.productCatalog}>
                {filteredProducts.length === 0 ? (
                  <Text style={styles.emptyText}>
                    {selectedCategory === ALL_CATEGORIES
                      ? 'No products found in catalog.'
                      : `Nothing in ${selectedCategory} matches. Tap All to search everything.`}
                  </Text>
                ) : (
                  filteredProducts.map((product) => {
                    const activeVariants = (product.variants || []).filter(
                      (v) => !v.isDeleted && v.isActive !== false
                    );
                    if (activeVariants.length === 0) return null;

                    const isExpanded = expandedProduct === product._id;

                    return (
                      <View key={product._id} style={styles.productCard}>
                        {/* Product Header Row */}
                        <TouchableOpacity
                          style={styles.productCardHeader}
                          activeOpacity={0.7}
                          onPress={() => handleExpandProduct(product._id)}
                        >
                          {product.image ? (
                            <Image
                              source={{ uri: product.image }}
                              style={styles.productThumbnail}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.productThumbnailPlaceholder}>
                              <Text style={{ fontSize: 18 }}>📦</Text>
                            </View>
                          )}
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.catalogProductName} numberOfLines={1}>
                              {name(product.productName)}
                            </Text>
                            <Text style={styles.catalogProductMeta}>
                              {product.brand} • {product.category}
                            </Text>
                          </View>
                          <Text style={styles.expandArrow}>{isExpanded ? '▲' : '▼'}</Text>
                        </TouchableOpacity>

                        {/* Variants List when expanded */}
                        {isExpanded && (
                          <View style={styles.variantsContainer}>
                            {activeVariants.map((v) => {
                              const qty = orderItems[v._id]?.quantity || 0;
                              const currentRateVal = customRates[v._id] !== undefined ? customRates[v._id] : v.salesPrice;
                              const rate = typeof currentRateVal === 'number' ? currentRateVal : (parseFloat(currentRateVal) || v.salesPrice);
                              
                              const stockVal = getResolvedStock(v._id, v.sku);
                              const isOutOfStock = stockVal === 0;
                              const isAddDisabled = stockVal === undefined || stockVal <= 0;

                              const defaultRate = Number(v.salesPrice || 0);
                              const minRate = Math.max(0, defaultRate - 1);

                              return (
                                <View key={v._id} style={styles.variantItemRow}>
                                  {/* Variant details */}
                                  <View style={styles.variantMetaBlock}>
                                    <Text style={styles.catalogVariantName}>
                                      {name(v.variantName)}
                                      {/* What a kilo costs, on the packs where the pack
                                          price alone cannot be compared: a 30kg at 3,150
                                          against a 1kg at 114. */}
                                      {perKgLabel(v.salesPrice, v.packSize, v.unit, v.variantName)
                                        ? '  ' + perKgLabel(v.salesPrice, v.packSize, v.unit, v.variantName)
                                        : ''}
                                    </Text>
                                    <Text style={styles.catalogVariantSku}>
                                      SKU: {v.sku} • {packLabel(v.packSize, v.unit, v.variantName)}
                                    </Text>
                                    <Text style={[
                                      styles.stockLabel,
                                      isOutOfStock && styles.outOfStockLabel
                                    ]}>
                                      {stockVal !== undefined 
                                        ? `Stock: ${stockVal} ${isOutOfStock ? '(Out)' : ''}`
                                        : 'Stock: Loading...'}
                                    </Text>
                                  </View>

                                  {/* Pricing adjust block */}
                                  <View style={styles.priceAdjustBlock}>
                                    <Text style={styles.priceAdjustLabel}>Sales Price</Text>
                                    <View style={styles.priceInputRow}>
                                      <TouchableOpacity
                                        style={styles.priceStepBtn}
                                        onPress={() => handlePriceChange(product, v, rate - 1, minRate)}
                                        disabled={rate <= minRate}
                                      >
                                        <Text style={styles.priceStepText}>−</Text>
                                      </TouchableOpacity>
                                      <TextInput
                                        style={styles.priceTextInput}
                                        keyboardType="numeric"
                                        value={String(currentRateVal)}
                                        onChangeText={(val) => handlePriceTextChange(product, v, val, minRate)}
                                        onBlur={() => handlePriceBlur(product, v, currentRateVal, minRate)}
                                      />
                                      <TouchableOpacity
                                        style={styles.priceStepBtn}
                                        onPress={() => handlePriceChange(product, v, rate + 1, minRate)}
                                      >
                                        <Text style={styles.priceStepText}>+</Text>
                                      </TouchableOpacity>
                                    </View>
                                    <Text style={styles.minPriceWarn}>Min: ₹{minRate}</Text>
                                  </View>

                                  {/* Quantity Controls */}
                                  <View style={styles.qtyControlBlock}>
                                    {qty === 0 ? (
                                      <TouchableOpacity
                                        style={[
                                          styles.catalogAddBtn,
                                          isAddDisabled && styles.disabledAddBtn
                                        ]}
                                        disabled={isAddDisabled}
                                        onPress={() => updateQuantity(product, v, 1)}
                                      >
                                        <Text style={styles.catalogAddBtnText}>+ ADD</Text>
                                      </TouchableOpacity>
                                    ) : (
                                      <View style={styles.catalogQtyRow}>
                                        <TouchableOpacity
                                          style={styles.catalogQtyBtn}
                                          onPress={() => updateQuantity(product, v, qty - 1)}
                                        >
                                          <Text style={styles.catalogQtyBtnText}>−</Text>
                                        </TouchableOpacity>
                                        <Text style={styles.catalogQtyValue}>{qty}</Text>
                                        <TouchableOpacity
                                          style={[
                                            styles.catalogQtyBtn,
                                            qty >= (stockVal !== undefined ? stockVal : 9999) && styles.disabledQtyBtn
                                          ]}
                                          disabled={qty >= (stockVal !== undefined ? stockVal : 9999)}
                                          onPress={() => updateQuantity(product, v, qty + 1)}
                                        >
                                          <Text style={styles.catalogQtyBtnText}>+</Text>
                                        </TouchableOpacity>
                                      </View>
                                    )}
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {/* Step 3: Order info */}
            <View style={styles.additionalInfoBlock}>
              <Text style={styles.blockTitle}>📝 Payment & Notes</Text>

              <Text style={styles.fieldLabel}>{t('Payment Terms')}</Text>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setPickerVisible(true)}
              >
                <Text style={styles.dropdownSelectorText}>{paymentTerms}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>

              {/* Offer Picker Modal */}
              <Modal
                visible={offerPickerVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setOfferPickerVisible(false)}
              >
                <TouchableOpacity
                  style={styles.modalOverlay}
                  activeOpacity={1}
                  onPress={() => setOfferPickerVisible(false)}
                >
                  <View style={styles.pickerModalContent}>
                    <Text style={styles.pickerModalTitle}>Apply an offer</Text>
                    <Text style={styles.offerModalNote}>
                      Priced against this order by the server, so what you see is what comes off.
                    </Text>

                    <ScrollView style={styles.offerModalList}>
                      {/* Selecting nothing is a real choice, so it gets a row. */}
                      <TouchableOpacity
                        style={[styles.offerRow, !selectedOfferId && styles.offerRowActive]}
                        onPress={() => { setSelectedOfferId(''); setOfferPickerVisible(false); }}
                      >
                        <Text style={styles.offerRadio}>{!selectedOfferId ? '\u25cf' : '\u25cb'}</Text>
                        <View style={styles.offerBody}>
                          <Text style={styles.offerName}>No offer</Text>
                          <Text style={styles.offerMeta}>Charge the full price</Text>
                        </View>
                      </TouchableOpacity>

                      {eligibleOffers.map((offer) => {
                        const selected = String(selectedOfferId) === String(offer.offerId);
                        return (
                          <TouchableOpacity
                            key={offer.offerId}
                            style={[styles.offerRow, selected && styles.offerRowActive]}
                            onPress={() => {
                              setSelectedOfferId(selected ? '' : String(offer.offerId));
                              setOfferPickerVisible(false);
                            }}
                          >
                            <Text style={styles.offerRadio}>{selected ? '\u25cf' : '\u25cb'}</Text>
                            <View style={styles.offerBody}>
                              <Text style={styles.offerName}>{offer.name}</Text>
                              <Text style={styles.offerMeta}>
                                {offer.discountPercentage}% off
                                {offer.minAmount > 0 ? ` \u00b7 min \u20b9${offer.minAmount}` : ''}
                              </Text>
                            </View>
                            <Text style={styles.offerSaving}>
                              {`− ₹${Number(offer.discountAmount).toFixed(2)}`}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}

                      {eligibleOffers.length === 0 && (
                        <Text style={styles.offerModalEmpty}>
                          No offer applies to this order yet.
                        </Text>
                      )}

                      {/* Near misses are worth showing: "add ₹500 more" is
                          something the salesman can act on at the counter. */}
                      {blockedOffers.length > 0 && (
                        <>
                          <Text style={styles.offerModalSection}>Not available yet</Text>
                          {blockedOffers.map((offer) => (
                            <View key={offer.offerId} style={[styles.offerRow, styles.offerRowDisabled]}>
                              <Text style={styles.offerRadio}>{'\u25cb'}</Text>
                              <View style={styles.offerBody}>
                                <Text style={styles.offerName}>{offer.name}</Text>
                                <Text style={styles.offerMeta}>{offer.reason}</Text>
                              </View>
                            </View>
                          ))}
                        </>
                      )}
                    </ScrollView>

                    <TouchableOpacity
                      style={styles.offerModalClose}
                      onPress={() => setOfferPickerVisible(false)}
                    >
                      <Text style={styles.offerModalCloseText}>{t('Close')}</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </Modal>

              {/* Credit ceiling reached */}
              <Modal
                visible={!!creditBlock}
                transparent
                animationType="fade"
                onRequestClose={() => setCreditBlock(null)}
              >
                <View style={styles.creditScrim}>
                  <View style={styles.creditCard}>
                    <Text style={styles.creditTitle}>{t('Credit limit reached')}</Text>
                    <Text style={styles.creditBody}>
                      {name(selectedParty?.partyName)} has a credit limit of {formatMoney(creditLimit)} and already owes{' '}
                      {formatMoney(creditInfo.outstanding)}, leaving {formatMoney(availableCredit)}.
                    </Text>
                    <Text style={styles.creditBody}>
                      This order is already {formatMoney(grandTotal)}
                      {creditBlock?.productName ? `, and ${name(creditBlock.productName)} would add ${formatMoney(creditBlock.extra)}` : ''}.
                    </Text>
                    <Text style={styles.creditHint}>
                      To keep going, take this order on Cash on Delivery — it is paid at delivery, so it does not use credit.
                    </Text>

                    <TouchableOpacity
                      style={styles.creditPrimaryBtn}
                      onPress={() => {
                        setPaymentTerms('Cash on Delivery (COD)');
                        setCreditBlock(null);
                      }}
                    >
                      <Text style={styles.creditPrimaryBtnText}>{t('Switch to Cash on Delivery')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.creditSecondaryBtn}
                      onPress={() => {
                        setCreditBlock(null);
                        setCreditRequestOpen(true);
                      }}
                    >
                      <Text style={styles.creditSecondaryBtnText}>{t('Ask admin to raise the limit')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.creditGhostBtn} onPress={() => setCreditBlock(null)}>
                      <Text style={styles.creditGhostBtnText}>{t('Keep the order as it is')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>

              <CreditLimitRequestModal
                visible={creditRequestOpen}
                onClose={() => setCreditRequestOpen(false)}
                party={selectedParty}
                creditLimit={creditLimit}
                currentOutstanding={creditInfo.outstanding}
                // Pre-filled with enough to cover what is already owed plus
                // this order, rounded up — the figure he actually needs.
                suggested={Math.ceil((Number(creditInfo.outstanding || 0) + grandTotal) / 1000) * 1000}
                apiUrl={apiUrl}
                token={token}
              />

              {/* Payment Terms Picker Modal */}
              <Modal
                visible={pickerVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setPickerVisible(false)}
              >
                <TouchableOpacity
                  style={styles.modalOverlay}
                  activeOpacity={1}
                  onPress={() => setPickerVisible(false)}
                >
                  <View style={styles.pickerModalContent}>
                    <Text style={styles.pickerModalTitle}>{t('Select Payment Terms')}</Text>
                    <ScrollView style={styles.pickerOptionsList}>
                      {PAYMENT_OPTIONS.map((opt) => {
                        // A credit term the party cannot afford is not offered.
                        // It stays visible with the reason, rather than being
                        // hidden, so it is clear why the choice is missing.
                        const termIsCredit = opt !== 'Cash on Delivery (COD)' && opt !== 'Advance';
                        const blocked = termIsCredit && creditLimit > 0 && grandTotal > availableCredit + 0.01;
                        return (
                          <TouchableOpacity
                            key={opt}
                            disabled={blocked}
                            style={[
                              styles.pickerOptionItem,
                              paymentTerms === opt && styles.pickerOptionItemActive,
                              blocked && styles.pickerOptionItemBlocked,
                            ]}
                            onPress={() => {
                              setPaymentTerms(opt);
                              setPickerVisible(false);
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.pickerOptionText,
                                  paymentTerms === opt && styles.pickerOptionTextActive,
                                  blocked && styles.pickerOptionTextBlocked,
                                ]}
                              >
                                {opt}
                              </Text>
                              {blocked && (
                                <Text style={styles.pickerOptionBlockedNote}>
                                  Over the credit limit — only {formatMoney(availableCredit)} available
                                </Text>
                              )}
                            </View>
                            {paymentTerms === opt && <Text style={styles.pickerCheckmark}>✓</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <TouchableOpacity
                      style={styles.pickerCloseBtn}
                      onPress={() => setPickerVisible(false)}
                    >
                      <Text style={styles.pickerCloseBtnText}>{t('Cancel')}</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </Modal>

              <Text style={styles.fieldLabel}>{t('Order Notes / Remarks')}</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Enter dispatch instructions or remarks..."
                placeholderTextColor="#A0AEC0"
                multiline
                numberOfLines={3}
                value={orderNotes}
                onChangeText={setOrderNotes}
              />
            </View>

            {/* Pricing Summary Card */}
            {itemsArray.length > 0 && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Order Summary</Text>
                {itemsArray.map(item => (
                  <View key={item.variant._id} style={styles.summaryItemRow}>
                    <Text style={styles.summaryItemName} numberOfLines={1}>
                      {item.product.productName} ({item.variant.variantName})
                    </Text>
                    <Text style={styles.summaryItemDetails}>
                      {item.quantity} × ₹{item.rate}
                    </Text>
                    <Text style={styles.summaryItemTotal}>
                      ₹{(item.quantity * item.rate).toFixed(2)}
                    </Text>
                  </View>
                ))}
                <View style={styles.summaryDivider} />

                {/* One line that opens the picker, rather than a list that
                    pushes the totals off the screen on a phone. */}
                <TouchableOpacity
                  style={styles.offerTrigger}
                  disabled={loadingOffers || eligibleOffers.length === 0}
                  onPress={() => setOfferPickerVisible(true)}
                >
                  <Text style={styles.offerTriggerIcon}>%</Text>
                  <View style={styles.offerTriggerBody}>
                    {chosenOffer ? (
                      <>
                        <Text style={styles.offerTriggerTitle}>{chosenOffer.name}</Text>
                        <Text style={styles.offerTriggerSub}>
                          {chosenOffer.discountPercentage}% off · saving ₹{Number(chosenOffer.discountAmount).toFixed(2)}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.offerTriggerTitle}>
                          {loadingOffers
                            ? 'Checking offers…'
                            : eligibleOffers.length
                              ? `${eligibleOffers.length} offer${eligibleOffers.length === 1 ? '' : 's'} available`
                              : 'No offer applies to this order'}
                        </Text>
                        {!loadingOffers && bestOffer && (
                          <Text style={styles.offerTriggerSub}>
                            Best saves ₹{Number(bestOffer.discountAmount).toFixed(2)}
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                  {chosenOffer ? (
                    <TouchableOpacity onPress={() => setSelectedOfferId('')}>
                      <Text style={styles.offerTriggerClear}>{t('Remove')}</Text>
                    </TouchableOpacity>
                  ) : (
                    eligibleOffers.length > 0 && <Text style={styles.offerTriggerChevron}>›</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('Sub Total')}</Text>
                  <Text style={styles.summaryVal}>₹{subTotal.toFixed(2)}</Text>
                </View>
                {discountTotal > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Offer Discount</Text>
                    <Text style={[styles.summaryVal, styles.offerSaving]}>− ₹{discountTotal.toFixed(2)}</Text>
                  </View>
                )}
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('GST Tax')}</Text>
                  <Text style={styles.summaryVal}>₹{taxTotal.toFixed(2)}</Text>
                </View>
                <View style={[styles.summaryRow, styles.grandTotalRow]}>
                  <Text style={styles.grandTotalLabel}>{t('Grand Total')}</Text>
                  <Text style={styles.grandTotalVal}>₹{grandTotal.toFixed(2)}</Text>
                </View>

                {/* Where this order stands against the party's credit.
                    Shown even when there is no limit, because "nothing is
                    blocking me" and "no limit is set" look identical
                    otherwise — which is exactly how a missing check hides. */}
                {!usesCredit ? (
                  <Text style={styles.creditNote}>
                    {paymentTerms} — this does not use the party's credit.
                  </Text>
                ) : creditLimit > 0 ? (
                  <Text style={[styles.creditNote, overCreditLimit && styles.creditNoteBad]}>
                    {overCreditLimit
                      ? `Over the credit limit. ${formatMoney(availableCredit)} was available; switch to Cash on Delivery to place this.`
                      : `Credit: ${formatMoney(creditInfo.outstanding)} owed of ${formatMoney(creditLimit)} · ${formatMoney(availableCredit - grandTotal)} left after this order.`}
                  </Text>
                ) : (
                  <Text style={styles.creditNoteMuted}>
                    No credit limit is set for {name(selectedParty?.partyName)} — nothing is being checked.
                  </Text>
                )}
              </View>
            )}

            {belowMinimum && (
              <Text style={styles.minimumWarning}>
                {`Add ₹${(minimumOrderAmount - grandTotal).toLocaleString('en-IN')} more — the smallest order we take is ₹${minimumOrderAmount.toLocaleString('en-IN')}.`}
              </Text>
            )}

            {/* Submit Button */}
            <TouchableOpacity 
              style={[
                styles.submitBtn,
                (itemsArray.length === 0 || isSubmitting || belowMinimum) && styles.disabledSubmitBtn
              ]} 
              onPress={openReview}
              disabled={itemsArray.length === 0 || isSubmitting || belowMinimum}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Review & Place Order</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* The whole order, read back before it is placed. Everything shown here
          is the same value that goes into the payload. */}
      <Modal
        visible={reviewVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewVisible(false)}
      >
        <View style={styles.reviewOverlay}>
          <View style={styles.reviewBox}>
            <View style={styles.reviewHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewTitle}>{t('Check this order')}</Text>
                <Text style={styles.reviewSubtitle}>{t('Nothing is placed until you confirm')}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setReviewVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.reviewClose}>\u2715</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.reviewBody} showsVerticalScrollIndicator>
              <View style={styles.reviewCard}>
                <Text style={styles.reviewParty}>{selectedParty?.partyName}</Text>
                <Text style={styles.reviewPartyMeta}>
                  {[selectedParty?.partyCode, selectedParty?.area, selectedParty?.city].filter(Boolean).join(' \u00b7 ')}
                </Text>
                <View style={styles.reviewTermRow}>
                  <Text style={styles.reviewTermLabel}>{t('Payment Terms')}</Text>
                  <Text style={styles.reviewTermValue}>{paymentTerms}</Text>
                </View>
              </View>

              <Text style={styles.reviewSection}>
                {itemsArray.length} {itemsArray.length === 1 ? t('item') : t('items')}
              </Text>

              {itemsArray.map((item, index) => {
                const lineDiscount = discountByLine[index] || 0;
                return (
                  <View key={`${item.product._id}-${item.variant._id}`} style={styles.reviewLine}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reviewLineName}>{item.product.productName}</Text>
                      <Text style={styles.reviewLineVariant}>
                        {packLabel(item.variant.packSize, item.variant.unit, item.variant.variantName)}
                        {'  \u00b7  '}
                        {item.quantity} \u00d7 {formatMoney(item.rate)}
                      </Text>
                      {lineDiscount > 0 && (
                        <Text style={styles.reviewLineOff}>{t('Offer')} \u2212{formatMoney(lineDiscount)}</Text>
                      )}
                    </View>
                    <Text style={styles.reviewLineAmount}>{formatMoney(item.quantity * item.rate)}</Text>
                  </View>
                );
              })}

              <View style={styles.reviewTotals}>
                <View style={styles.reviewTotalRow}>
                  <Text style={styles.reviewTotalLabel}>{t('Subtotal')}</Text>
                  <Text style={styles.reviewTotalValue}>{formatMoney(subTotal)}</Text>
                </View>
                {discountTotal > 0 && (
                  <View style={styles.reviewTotalRow}>
                    <Text style={[styles.reviewTotalLabel, { color: '#047857' }]}>
                      {chosenOffer?.name || t('Discount')}
                    </Text>
                    <Text style={[styles.reviewTotalValue, { color: '#047857' }]}>
                      \u2212{formatMoney(discountTotal)}
                    </Text>
                  </View>
                )}
                <View style={styles.reviewTotalRow}>
                  <Text style={styles.reviewTotalLabel}>{t('GST')}</Text>
                  <Text style={styles.reviewTotalValue}>{formatMoney(taxTotal)}</Text>
                </View>
                <View style={[styles.reviewTotalRow, styles.reviewGrandRow]}>
                  <Text style={styles.reviewGrandLabel}>{t('Total')}</Text>
                  <Text style={styles.reviewGrandValue}>{formatMoney(grandTotal)}</Text>
                </View>
              </View>

              {/* Only for a credit sale: cash and advance never touch the limit. */}
              {paymentTypeCode === 'credit' && creditInfo.limit > 0 && (
                <Text style={styles.reviewCredit}>
                  {`${t('On credit')} \u00b7 ${formatMoney(Math.max(0, creditInfo.limit - creditInfo.outstanding - grandTotal))} ${t('of the limit left after this order')}`}
                </Text>
              )}

              {orderNotes.trim() ? (
                <View style={styles.reviewNotes}>
                  <Text style={styles.reviewNotesLabel}>{t('Notes')}</Text>
                  <Text style={styles.reviewNotesText}>{orderNotes.trim()}</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.reviewActions}>
              <TouchableOpacity
                style={styles.reviewChangeBtn}
                onPress={() => setReviewVisible(false)}
                disabled={isSubmitting}
              >
                <Text style={styles.reviewChangeText}>{t('Change something')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reviewConfirmBtn, isSubmitting && { opacity: 0.6 }]}
                onPress={handleSubmitOrder}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.reviewConfirmText}>{t('Place this order')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    height: verticalScale(56),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    paddingVertical: verticalScale(8),
    paddingRight: scale(16),
  },
  backBtnText: {
    color: '#00796B',
    fontWeight: '700',
    fontSize: responsiveFontSize(14.5),
  },
  headerTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
  },
  container: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
  },
  stepContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: scale(16),
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: verticalScale(16),
  },
  stepTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#00796B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryStrip: {
    gap: scale(8),
    paddingBottom: verticalScale(12),
    paddingRight: scale(4),
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(8),
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryChipActive: { backgroundColor: '#00796B', borderColor: '#00796B' },
  categoryChipText: { fontSize: responsiveFontSize(12), fontWeight: '700', color: '#475569' },
  categoryChipTextActive: { color: '#FFFFFF' },
  categoryChipCount: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
    color: '#94A3B8',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: scale(6),
    paddingVertical: 1,
    overflow: 'hidden',
  },
  categoryChipCountActive: { color: '#00796B', backgroundColor: '#E0F2F1' },
  searchInput: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(14),
    color: '#2D3748',
    marginVertical: verticalScale(12),
  },
  partiesList: {
    gap: verticalScale(10),
  },
  partySelectCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: scale(12),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  partyName: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '700',
    color: '#2D3748',
  },
  partyCode: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    fontWeight: '600',
    marginTop: verticalScale(2),
  },
  partyAddr: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  selectArrow: {
    fontSize: responsiveFontSize(16),
    color: '#00796B',
    fontWeight: '700',
  },
  emptyText: {
    textAlign: 'center',
    color: '#A0AEC0',
    fontSize: responsiveFontSize(13),
    paddingVertical: verticalScale(10),
  },
  /* Selected Party Styles */
  selectedPartyCard: {
    backgroundColor: '#E6FFFA',
    borderWidth: 1.5,
    borderColor: '#319795',
    borderRadius: 14,
    padding: scale(16),
    marginBottom: verticalScale(16),
  },
  selectedPartyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(8),
    borderBottomWidth: 1,
    borderBottomColor: '#B2F5EA',
    paddingBottom: verticalScale(6),
  },
  selectedPartyLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#008080',
    textTransform: 'uppercase',
  },
  changePartyBtn: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#E53E3E',
  },
  selectedPartyName: {
    fontSize: responsiveFontSize(16),
    fontWeight: '800',
    color: '#234E52',
  },
  selectedPartyCode: {
    fontSize: responsiveFontSize(12.5),
    color: '#2C7A7B',
    fontWeight: '600',
    marginTop: verticalScale(2),
  },
  selectedPartyAddr: {
    fontSize: responsiveFontSize(12.5),
    color: '#2C7A7B',
    marginTop: verticalScale(4),
  },
  outstandingBadge: {
    backgroundColor: '#FEB2B2',
    alignSelf: 'flex-start',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(4),
    borderRadius: 6,
    marginTop: verticalScale(8),
  },
  outstandingText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#9B2C2C',
  },
  /* Form Container */
  formContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: scale(16),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catalogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(4),
  },
  saveDraftBtn: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 8,
  },
  saveDraftBtnText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#4A5568',
  },
  productCatalog: {
    marginBottom: verticalScale(16),
    gap: verticalScale(10),
  },
  productCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  productCardHeader: {
    flexDirection: 'row',
    padding: scale(10),
    alignItems: 'center',
  },
  productThumbnail: {
    width: scale(44),
    height: verticalScale(44),
    borderRadius: 6,
    backgroundColor: '#EDF2F7',
  },
  productThumbnailPlaceholder: {
    width: scale(44),
    height: verticalScale(44),
    borderRadius: 6,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogProductName: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
  },
  catalogProductMeta: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  expandArrow: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    paddingHorizontal: scale(8),
  },
  variantsContainer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: scale(8),
    gap: verticalScale(8),
  },
  variantItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(6),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  variantMetaBlock: {
    flex: 1.5,
    marginRight: scale(6),
  },
  catalogVariantName: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#2D3748',
  },
  catalogVariantSku: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  stockLabel: {
    fontSize: responsiveFontSize(10.5),
    fontWeight: '700',
    color: '#2F855A',
    marginTop: verticalScale(4),
  },
  outOfStockLabel: {
    color: '#C53030',
  },
  priceAdjustBlock: {
    flex: 1.3,
    alignItems: 'center',
    marginRight: scale(6),
  },
  priceAdjustLabel: {
    fontSize: responsiveFontSize(9.5),
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(4),
  },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 6,
    overflow: 'hidden',
    height: verticalScale(28),
  },
  priceStepBtn: {
    width: scale(22),
    height: '100%',
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceStepText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#4A5568',
  },
  priceTextInput: {
    width: scale(42),
    textAlign: 'center',
    fontSize: responsiveFontSize(12),
    color: '#1A202C',
    fontWeight: '700',
    padding: 0,
    height: '100%',
  },
  minPriceWarn: {
    fontSize: responsiveFontSize(9.5),
    color: '#718096',
    marginTop: verticalScale(2),
    fontWeight: '600',
  },
  qtyControlBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  catalogAddBtn: {
    backgroundColor: '#00796B',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 6,
  },
  disabledAddBtn: {
    backgroundColor: '#CBD5E0',
  },
  catalogAddBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
  },
  catalogQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00796B',
    borderRadius: 6,
    overflow: 'hidden',
    height: verticalScale(28),
  },
  catalogQtyBtn: {
    width: scale(24),
    height: '100%',
    backgroundColor: '#E6FFFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledQtyBtn: {
    backgroundColor: '#EDF2F7',
  },
  catalogQtyBtnText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#00796B',
  },
  catalogQtyValue: {
    width: scale(24),
    textAlign: 'center',
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#1A202C',
  },
  additionalInfoBlock: {
    marginTop: verticalScale(16),
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: verticalScale(16),
  },
  fieldLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: verticalScale(6),
  },
  input: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    color: '#2D3748',
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(14),
    marginBottom: verticalScale(16),
  },
  textarea: {
    height: verticalScale(64),
    textAlignVertical: 'top',
    paddingVertical: verticalScale(8),
  },
  /* Summary Card */
  summaryCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: scale(12),
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: verticalScale(6),
    marginBottom: verticalScale(18),
    marginTop: verticalScale(10),
  },
  summaryTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#4A5568',
    marginBottom: verticalScale(4),
  },
  summaryItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(4),
  },
  summaryItemName: {
    flex: 1.5,
    fontSize: responsiveFontSize(12),
    color: '#4A5568',
  },
  summaryItemDetails: {
    flex: 1,
    fontSize: responsiveFontSize(12),
    color: '#718096',
    textAlign: 'center',
  },
  summaryItemTotal: {
    flex: 0.8,
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#2D3748',
    textAlign: 'right',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: verticalScale(4),
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
  },
  summaryVal: {
    fontSize: responsiveFontSize(12.5),
    color: '#2D3748',
    fontWeight: '600',
  },
  offerBlock: { marginBottom: 12 },
  offerTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, backgroundColor: '#fff',
  },
  offerTriggerIcon: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#e6f7f5',
    color: '#00796B', textAlign: 'center', lineHeight: 26, fontWeight: '700',
  },
  offerTriggerBody: { flex: 1 },
  offerTriggerTitle: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  offerTriggerSub: { fontSize: 11, color: '#16a34a', marginTop: 2, fontWeight: '600' },
  offerTriggerChevron: { fontSize: 22, color: '#94a3b8' },
  offerTriggerClear: { fontSize: 12, color: '#dc2626', fontWeight: '600' },
  offerModalNote: { fontSize: 11, color: '#64748b', marginBottom: 10, textAlign: 'center' },
  offerModalList: { maxHeight: 340 },
  offerModalEmpty: { fontSize: 12, color: '#64748b', textAlign: 'center', paddingVertical: 18 },
  offerModalSection: {
    fontSize: 10, fontWeight: '700', color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6,
  },
  offerModalClose: {
    marginTop: 12, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#f1f5f9', alignItems: 'center',
  },
  offerModalCloseText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  offerHeading: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 6, textTransform: 'uppercase' },
  offerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6,
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, backgroundColor: '#fff',
  },
  offerRowActive: { borderColor: '#00bfa5', backgroundColor: '#e6f7f5' },
  offerRowDisabled: { opacity: 0.55 },
  offerRadio: { fontSize: 14, color: '#00bfa5' },
  offerBody: { flex: 1 },
  offerName: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  offerMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  offerSaving: { fontSize: 13, fontWeight: '700', color: '#16a34a' },
  offerSavingMuted: { fontSize: 13, color: '#94a3b8' },
  pickerOptionItemBlocked: { opacity: 0.55 },
  pickerOptionTextBlocked: { color: '#A0AEC0' },
  pickerOptionBlockedNote: { fontSize: 10.5, color: '#C05621', marginTop: 3 },

  creditScrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 22,
  },
  creditCard: {
    width: '100%', backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 22, gap: 10,
  },
  creditTitle: { fontSize: 17, fontWeight: '800', color: '#C53030' },
  creditBody: { fontSize: 13, color: '#2D3748', lineHeight: 19 },
  creditHint: { fontSize: 12.5, color: '#00695C', lineHeight: 18, marginTop: 2 },
  creditPrimaryBtn: {
    marginTop: 12, backgroundColor: '#00796B',
    paddingVertical: 14, borderRadius: 10, alignItems: 'center',
  },
  creditPrimaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  creditSecondaryBtn: {
    marginTop: 10, paddingVertical: 13, borderRadius: 10,
    borderWidth: 1, borderColor: '#00796B', alignItems: 'center',
  },
  creditSecondaryBtnText: { color: '#00796B', fontWeight: '800', fontSize: 13.5 },
  creditGhostBtn: { paddingVertical: 10, alignItems: 'center' },
  creditGhostBtnText: { color: '#718096', fontWeight: '600', fontSize: 13 },

  creditNote: {
    marginTop: 10, fontSize: 11.5, color: '#2F855A', lineHeight: 16,
  },
  creditNoteBad: { color: '#C53030', fontWeight: '700' },
  creditNoteMuted: { marginTop: 10, fontSize: 11.5, color: '#A0AEC0', lineHeight: 16 },

  grandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: verticalScale(6),
    marginTop: verticalScale(4),
  },
  grandTotalLabel: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#1A202C',
  },
  grandTotalVal: {
    fontSize: responsiveFontSize(16),
    fontWeight: '800',
    color: '#00796B',
  },
  reviewOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  reviewBox: { backgroundColor: '#F7F9FC', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: scale(16), maxHeight: '92%' },
  reviewHead: { flexDirection: 'row', alignItems: 'flex-start' },
  reviewTitle: { fontSize: responsiveFontSize(18), fontWeight: '900', color: '#0F172A' },
  reviewSubtitle: { fontSize: responsiveFontSize(10), color: '#64748B', fontWeight: '700', marginTop: verticalScale(2) },
  reviewClose: { fontSize: responsiveFontSize(18), color: '#64748B', fontWeight: '900' },
  reviewBody: { marginTop: verticalScale(12), maxHeight: verticalScale(430) },
  reviewCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: scale(12), borderWidth: 1, borderColor: '#E2E8F0' },
  reviewParty: { fontSize: responsiveFontSize(14), fontWeight: '900', color: '#0F172A' },
  reviewPartyMeta: { fontSize: responsiveFontSize(10), color: '#64748B', fontWeight: '700', marginTop: verticalScale(2) },
  reviewTermRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: verticalScale(10), paddingTop: verticalScale(8), borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  reviewTermLabel: { fontSize: responsiveFontSize(10), color: '#64748B', fontWeight: '800' },
  reviewTermValue: { fontSize: responsiveFontSize(11), color: '#0F172A', fontWeight: '900' },
  reviewSection: { fontSize: responsiveFontSize(11), fontWeight: '900', color: '#0F766E', marginTop: verticalScale(14), marginBottom: verticalScale(8) },
  reviewLine: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 10, padding: scale(10), marginBottom: verticalScale(6), borderWidth: 1, borderColor: '#E2E8F0' },
  reviewLineName: { fontSize: responsiveFontSize(12), fontWeight: '800', color: '#0F172A' },
  reviewLineVariant: { fontSize: responsiveFontSize(10), color: '#64748B', fontWeight: '700', marginTop: verticalScale(2) },
  reviewLineOff: { fontSize: responsiveFontSize(9), color: '#047857', fontWeight: '800', marginTop: verticalScale(2) },
  reviewLineAmount: { fontSize: responsiveFontSize(12), fontWeight: '900', color: '#0F172A' },
  reviewTotals: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: scale(12), marginTop: verticalScale(8), borderWidth: 1, borderColor: '#E2E8F0' },
  reviewTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: verticalScale(6) },
  reviewTotalLabel: { fontSize: responsiveFontSize(11), color: '#64748B', fontWeight: '700' },
  reviewTotalValue: { fontSize: responsiveFontSize(11), color: '#0F172A', fontWeight: '800' },
  reviewGrandRow: { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: verticalScale(8), marginTop: verticalScale(4), marginBottom: 0 },
  reviewGrandLabel: { fontSize: responsiveFontSize(13), color: '#0F172A', fontWeight: '900' },
  reviewGrandValue: { fontSize: responsiveFontSize(16), color: '#0F766E', fontWeight: '900' },
  reviewCredit: { fontSize: responsiveFontSize(10), color: '#B45309', fontWeight: '800', marginTop: verticalScale(10) },
  reviewNotes: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: scale(10), marginTop: verticalScale(10), borderWidth: 1, borderColor: '#E2E8F0' },
  reviewNotesLabel: { fontSize: responsiveFontSize(9), color: '#64748B', fontWeight: '900' },
  reviewNotesText: { fontSize: responsiveFontSize(11), color: '#334155', marginTop: verticalScale(3) },
  reviewActions: { flexDirection: 'row', gap: scale(10), marginTop: verticalScale(14) },
  reviewChangeBtn: { flex: 1, padding: scale(14), borderRadius: 12, backgroundColor: '#E2E8F0', alignItems: 'center' },
  reviewChangeText: { fontWeight: '900', color: '#475569' },
  reviewConfirmBtn: { flex: 2, padding: scale(14), borderRadius: 12, backgroundColor: '#0F766E', alignItems: 'center' },
  reviewConfirmText: { fontWeight: '900', color: '#FFFFFF' },
  awaitingApproval: {
    margin: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFF5F5',
    borderWidth: 1.5,
    borderColor: '#FC8181',
  },
  rejectedBox: {
    backgroundColor: '#C53030',
    borderColor: '#9B2C2C',
  },
  awaitingApprovalTitle: {
    color: '#C53030',
    fontWeight: '900',
    fontSize: 14,
  },
  awaitingApprovalText: {
    color: '#742A2A',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  minimumWarning: {
    color: '#B45309',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  submitBtn: {
    height: verticalScale(48),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: verticalScale(10),
  },
  disabledSubmitBtn: {
    backgroundColor: '#CBD5E0',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(14),
  },
  dropdownSelector: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: verticalScale(16),
  },
  dropdownSelectorText: {
    fontSize: responsiveFontSize(14),
    color: '#2D3748',
    fontWeight: '600',
  },
  dropdownArrow: {
    fontSize: responsiveFontSize(10),
    color: '#718096',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: scale(20),
  },
  pickerModalContent: {
    width: '90%',
    maxHeight: '60%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: scale(20),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerModalTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(12),
    textAlign: 'center',
  },
  pickerOptionsList: {
    marginBottom: verticalScale(16),
  },
  pickerOptionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(16),
    borderRadius: 10,
    marginBottom: verticalScale(4),
  },
  pickerOptionItemActive: {
    backgroundColor: '#E6FFFA',
  },
  pickerOptionText: {
    fontSize: responsiveFontSize(14),
    color: '#4A5568',
    fontWeight: '600',
  },
  pickerOptionTextActive: {
    color: '#00796B',
    fontWeight: '700',
  },
  pickerCheckmark: {
    fontSize: responsiveFontSize(14),
    color: '#00796B',
    fontWeight: '800',
  },
  pickerCloseBtn: {
    height: verticalScale(40),
    backgroundColor: '#EDF2F7',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCloseBtnText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#4A5568',
  },
});
