import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function OrderScreen({ token, apiUrl, user, preSelectedParty, onBack }) {
  const [selectedParty, setSelectedParty] = useState(preSelectedParty || null);
  const [parties, setParties] = useState([]);
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [loadingParties, setLoadingParties] = useState(false);

  // Products & Order creation states
  const [products, setProducts] = useState([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
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

  const PAYMENT_OPTIONS = [
    'Immediate',
    'Advance',
    'Cash on Delivery (COD)',
    'Net 7 Days',
    'Net 15 Days',
    'Net 30 Days',
    'Net 45 Days',
    'Net 60 Days',
  ];

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
    }
  }, [selectedParty]);

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
        fetch(`${apiUrl}/product?limit=100`, { headers }),
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
          nextStock[String(item.variantId)] = Math.max(0, Number(item.availableQuantity ?? (Number(item.quantity || 0) - Number(item.reservedQuantity || 0))));
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
        // Auto-add to order if price is adjusted
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
      Alert.alert('Price Notice', `Price cannot be less than the fixed price of ₹${minPrice}`);
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

  // Filter products by search query
  const filteredProducts = products.filter((p) => {
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
  const taxTotal = itemsArray.reduce((sum, item) => sum + (item.quantity * item.rate * (item.variant.gstPercentage || 0) / 100), 0);
  const grandTotal = subTotal + taxTotal;

  const handleSubmitOrder = async () => {
    if (!selectedParty) {
      Alert.alert('Error', 'Please select a party first.');
      return;
    }

    if (itemsArray.length === 0) {
      Alert.alert('Error', 'Please add at least one item to the order.');
      return;
    }

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
        paymentType: paymentTerms === 'Cash on Delivery (COD)' ? 'cod' : paymentTerms === 'Advance' ? 'prepaid' : 'credit',
        items: payloadItems,
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

      <ScrollView contentContainerStyle={styles.container}>
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
                        <Text style={styles.partyName}>{party.partyName}</Text>
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
            <Text style={styles.selectedPartyName}>{selectedParty.partyName}</Text>
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

        {/* Step 2: Order Catalog & Details */}
        {selectedParty && (
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

            {loadingProducts ? (
              <ActivityIndicator color="#00796B" style={{ marginVertical: 30 }} />
            ) : (
              <View style={styles.productCatalog}>
                {filteredProducts.length === 0 ? (
                  <Text style={styles.emptyText}>No products found in catalog.</Text>
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
                              {product.productName}
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
                              const stockVal = stockMap[v._id];
                              const isOutOfStock = stockVal === 0;

                              return (
                                <View key={v._id} style={styles.variantItemRow}>
                                  {/* Variant details */}
                                  <View style={styles.variantMetaBlock}>
                                    <Text style={styles.catalogVariantName}>{v.variantName}</Text>
                                    <Text style={styles.catalogVariantSku}>
                                      SKU: {v.sku} • {v.packSize} {v.unit}
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
                                        onPress={() => handlePriceChange(product, v, rate - 1, v.salesPrice)}
                                        disabled={rate <= v.salesPrice}
                                      >
                                        <Text style={styles.priceStepText}>−</Text>
                                      </TouchableOpacity>
                                      <TextInput
                                        style={styles.priceTextInput}
                                        keyboardType="numeric"
                                        value={String(currentRateVal)}
                                        onChangeText={(val) => handlePriceTextChange(product, v, val, v.salesPrice)}
                                        onBlur={() => handlePriceBlur(product, v, currentRateVal, v.salesPrice)}
                                      />
                                      <TouchableOpacity
                                        style={styles.priceStepBtn}
                                        onPress={() => handlePriceChange(product, v, rate + 1, v.salesPrice)}
                                      >
                                        <Text style={styles.priceStepText}>+</Text>
                                      </TouchableOpacity>
                                    </View>
                                    <Text style={styles.minPriceWarn}>Min: ₹{v.salesPrice}</Text>
                                  </View>

                                  {/* Quantity Controls */}
                                  <View style={styles.qtyControlBlock}>
                                    {qty === 0 ? (
                                      <TouchableOpacity
                                        style={[
                                          styles.catalogAddBtn,
                                          isOutOfStock && styles.disabledAddBtn
                                        ]}
                                        disabled={isOutOfStock}
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

              <Text style={styles.fieldLabel}>Payment Terms</Text>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setPickerVisible(true)}
              >
                <Text style={styles.dropdownSelectorText}>{paymentTerms}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>

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
                    <Text style={styles.pickerModalTitle}>Select Payment Terms</Text>
                    <ScrollView style={styles.pickerOptionsList}>
                      {PAYMENT_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt}
                          style={[
                            styles.pickerOptionItem,
                            paymentTerms === opt && styles.pickerOptionItemActive,
                          ]}
                          onPress={() => {
                            setPaymentTerms(opt);
                            setPickerVisible(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.pickerOptionText,
                              paymentTerms === opt && styles.pickerOptionTextActive,
                            ]}
                          >
                            {opt}
                          </Text>
                          {paymentTerms === opt && <Text style={styles.pickerCheckmark}>✓</Text>}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <TouchableOpacity
                      style={styles.pickerCloseBtn}
                      onPress={() => setPickerVisible(false)}
                    >
                      <Text style={styles.pickerCloseBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </Modal>

              <Text style={styles.fieldLabel}>Order Notes / Remarks</Text>
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
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Sub Total</Text>
                  <Text style={styles.summaryVal}>₹{subTotal.toFixed(2)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>GST Tax</Text>
                  <Text style={styles.summaryVal}>₹{taxTotal.toFixed(2)}</Text>
                </View>
                <View style={[styles.summaryRow, styles.grandTotalRow]}>
                  <Text style={styles.grandTotalLabel}>Grand Total</Text>
                  <Text style={styles.grandTotalVal}>₹{grandTotal.toFixed(2)}</Text>
                </View>
              </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity 
              style={[
                styles.submitBtn,
                (itemsArray.length === 0 || isSubmitting) && styles.disabledSubmitBtn
              ]} 
              onPress={handleSubmitOrder}
              disabled={itemsArray.length === 0 || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Submit & Place Order</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backBtnText: {
    color: '#00796B',
    fontWeight: '700',
    fontSize: 14.5,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3748',
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  stepContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#00796B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchInput: {
    height: 44,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#2D3748',
    marginVertical: 12,
  },
  partiesList: {
    gap: 10,
  },
  partySelectCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  partyName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#2D3748',
  },
  partyCode: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
    marginTop: 2,
  },
  partyAddr: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  selectArrow: {
    fontSize: 16,
    color: '#00796B',
    fontWeight: '700',
  },
  emptyText: {
    textAlign: 'center',
    color: '#A0AEC0',
    fontSize: 13,
    paddingVertical: 10,
  },
  /* Selected Party Styles */
  selectedPartyCard: {
    backgroundColor: '#E6FFFA',
    borderWidth: 1.5,
    borderColor: '#319795',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  selectedPartyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#B2F5EA',
    paddingBottom: 6,
  },
  selectedPartyLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#008080',
    textTransform: 'uppercase',
  },
  changePartyBtn: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E53E3E',
  },
  selectedPartyName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#234E52',
  },
  selectedPartyCode: {
    fontSize: 12.5,
    color: '#2C7A7B',
    fontWeight: '600',
    marginTop: 2,
  },
  selectedPartyAddr: {
    fontSize: 12.5,
    color: '#2C7A7B',
    marginTop: 4,
  },
  outstandingBadge: {
    backgroundColor: '#FEB2B2',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 8,
  },
  outstandingText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9B2C2C',
  },
  /* Form Container */
  formContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catalogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  saveDraftBtn: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveDraftBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A5568',
  },
  productCatalog: {
    marginBottom: 16,
    gap: 10,
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
    padding: 10,
    alignItems: 'center',
  },
  productThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#EDF2F7',
  },
  productThumbnailPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogProductName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3748',
  },
  catalogProductMeta: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  expandArrow: {
    fontSize: 12,
    color: '#718096',
    paddingHorizontal: 8,
  },
  variantsContainer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 8,
    gap: 8,
  },
  variantItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  variantMetaBlock: {
    flex: 1.5,
    marginRight: 6,
  },
  catalogVariantName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
  },
  catalogVariantSku: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  stockLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#2F855A',
    marginTop: 4,
  },
  outOfStockLabel: {
    color: '#C53030',
  },
  priceAdjustBlock: {
    flex: 1.3,
    alignItems: 'center',
    marginRight: 6,
  },
  priceAdjustLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 6,
    overflow: 'hidden',
    height: 28,
  },
  priceStepBtn: {
    width: 22,
    height: '100%',
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceStepText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#4A5568',
  },
  priceTextInput: {
    width: 42,
    textAlign: 'center',
    fontSize: 12,
    color: '#1A202C',
    fontWeight: '700',
    padding: 0,
    height: '100%',
  },
  minPriceWarn: {
    fontSize: 9.5,
    color: '#718096',
    marginTop: 2,
    fontWeight: '600',
  },
  qtyControlBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  catalogAddBtn: {
    backgroundColor: '#00796B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  disabledAddBtn: {
    backgroundColor: '#CBD5E0',
  },
  catalogAddBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  catalogQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00796B',
    borderRadius: 6,
    overflow: 'hidden',
    height: 28,
  },
  catalogQtyBtn: {
    width: 24,
    height: '100%',
    backgroundColor: '#E6FFFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledQtyBtn: {
    backgroundColor: '#EDF2F7',
  },
  catalogQtyBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#00796B',
  },
  catalogQtyValue: {
    width: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#1A202C',
  },
  additionalInfoBlock: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    height: 44,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    color: '#2D3748',
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  textarea: {
    height: 64,
    textAlignVertical: 'top',
    paddingVertical: 8,
  },
  /* Summary Card */
  summaryCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
    marginBottom: 18,
    marginTop: 10,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4A5568',
    marginBottom: 4,
  },
  summaryItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  summaryItemName: {
    flex: 1.5,
    fontSize: 12,
    color: '#4A5568',
  },
  summaryItemDetails: {
    flex: 1,
    fontSize: 12,
    color: '#718096',
    textAlign: 'center',
  },
  summaryItemTotal: {
    flex: 0.8,
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3748',
    textAlign: 'right',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 12.5,
    color: '#718096',
  },
  summaryVal: {
    fontSize: 12.5,
    color: '#2D3748',
    fontWeight: '600',
  },
  grandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 6,
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
  },
  grandTotalVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#00796B',
  },
  submitBtn: {
    height: 48,
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  disabledSubmitBtn: {
    backgroundColor: '#CBD5E0',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  dropdownSelector: {
    height: 44,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dropdownSelectorText: {
    fontSize: 14,
    color: '#2D3748',
    fontWeight: '600',
  },
  dropdownArrow: {
    fontSize: 10,
    color: '#718096',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerModalContent: {
    width: '90%',
    maxHeight: '60%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 12,
    textAlign: 'center',
  },
  pickerOptionsList: {
    marginBottom: 16,
  },
  pickerOptionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
  },
  pickerOptionItemActive: {
    backgroundColor: '#E6FFFA',
  },
  pickerOptionText: {
    fontSize: 14,
    color: '#4A5568',
    fontWeight: '600',
  },
  pickerOptionTextActive: {
    color: '#00796B',
    fontWeight: '700',
  },
  pickerCheckmark: {
    fontSize: 14,
    color: '#00796B',
    fontWeight: '800',
  },
  pickerCloseBtn: {
    height: 40,
    backgroundColor: '#EDF2F7',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCloseBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4A5568',
  },
});
