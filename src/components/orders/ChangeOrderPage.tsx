import React, { useState, useEffect } from 'react';
import { Order, CustomerInfo, BuildingInfo } from '../../types/order';
import {
  ChangeOrder,
  ChangeOrderFormData,
  ChangeOrderPendingFiles,
  calculateTotal,
  calculateDifferences,
  PricingSnapshot,
  initialChangeOrderPendingFiles,
  computeCustomerChanges,
  computeBuildingChanges,
  CustomerChange,
  BuildingChange,
} from '../../types/changeOrder';
import { AdminOptionType } from '../../types/admin';
import { getAllAdminOptions } from '../../services/adminService';
import { getActiveManufacturerConfigs } from '../../services/manufacturerConfigService';
import { getOrder } from '../../services/orderService';
import {
  getChangeOrder,
  createChangeOrder,
  updateChangeOrder,
} from '../../services/changeOrderService';
import { useAuth } from '../../contexts/AuthContext';
import { CustomerSection } from '../orderForm/CustomerSection';
import { BuildingSection } from '../orderForm/BuildingSection';
import { ChangeOrderFileUpload } from './ChangeOrderFileUpload';

type ChangeOrderMode = 'compact' | 'full';

interface ChangeOrderPageProps {
  orderId: string;
  changeOrderId?: string; // undefined = new, string = editing
  onComplete: () => void;
  onCancel: () => void;
  onSendForSignature?: (changeOrderId: string) => Promise<void>;
}

// Dynamic style functions
const getDiffBadgeStyle = (value: number): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: 500,
  padding: '2px 8px',
  borderRadius: '4px',
  backgroundColor: value === 0 ? '#f5f5f5' : value > 0 ? '#e8f5e9' : '#ffebee',
  color: value === 0 ? '#666' : value > 0 ? '#2e7d32' : '#c62828',
});

export function ChangeOrderPage({
  orderId,
  changeOrderId,
  onComplete,
  onCancel,
  onSendForSignature: _onSendForSignature,
}: ChangeOrderPageProps) {
  const { user, isManager } = useAuth();
  const [mode, setMode] = useState<ChangeOrderMode>('compact');
  const [order, setOrder] = useState<Order | null>(null);
  const [existingChangeOrder, setExistingChangeOrder] = useState<ChangeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  // Admin options for dropdowns
  const [adminOptions, setAdminOptions] = useState<Record<AdminOptionType, string[]>>(
    {} as Record<AdminOptionType, string[]>
  );
  const [optionsLoading, setOptionsLoading] = useState(true);

  // Form data
  const [reason, setReason] = useState('');
  const [newPricing, setNewPricing] = useState({
    subtotalBeforeTax: '',
    extraMoneyFluff: '',
    deposit: '',
  });
  const [editCustomer, setEditCustomer] = useState(false);
  const [editBuilding, setEditBuilding] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [building, setBuilding] = useState<BuildingInfo | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ChangeOrderPendingFiles>(
    initialChangeOrderPendingFiles
  );

  // Show original values toggle
  const [showOriginalCustomer, setShowOriginalCustomer] = useState(false);
  const [showOriginalBuilding, setShowOriginalBuilding] = useState(false);

  // Payment collection for deposit difference
  const [collectPaymentNow, setCollectPaymentNow] = useState(false);
  const [paymentType, setPaymentType] = useState<'stripe_charge_card' | 'stripe_pay_now' | 'stripe_already_paid' | 'check' | 'wire' | 'credit_on_file' | 'other'>('stripe_already_paid');
  const [stripePaymentId, setStripePaymentId] = useState('');
  const [stripeVerifying, setStripeVerifying] = useState(false);
  const [stripeVerified, setStripeVerified] = useState(false);
  const [stripeVerificationResult, setStripeVerificationResult] = useState<{
    verified: boolean;
    amount?: number;
    error?: string;
  } | null>(null);
  const [managerApprovalCode, setManagerApprovalCode] = useState('');
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('');
  const [chargingCard, setChargingCard] = useState(false);
  const [cardChargeResult, setCardChargeResult] = useState<{
    success: boolean;
    paymentId?: string;
    error?: string;
  } | null>(null);

  // Load order and change order data
  useEffect(() => {
    loadData();
  }, [orderId, changeOrderId]);

  // Load admin options
  useEffect(() => {
    loadAdminOptions();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load order
      const orderData = await getOrder(orderId);
      if (!orderData) {
        throw new Error('Order not found');
      }
      setOrder(orderData);

      // Initialize form with order data
      setNewPricing({
        subtotalBeforeTax: orderData.pricing.subtotalBeforeTax.toString(),
        extraMoneyFluff: orderData.pricing.extraMoneyFluff.toString(),
        deposit: orderData.pricing.deposit.toString(),
      });
      setCustomer({ ...orderData.customer });
      setBuilding({ ...orderData.building });

      // Load existing change order if editing
      if (changeOrderId) {
        const changeOrderData = await getChangeOrder(changeOrderId);
        if (changeOrderData) {
          setExistingChangeOrder(changeOrderData);
          setReason(changeOrderData.reason);
          setNewPricing({
            subtotalBeforeTax: changeOrderData.newValues.subtotalBeforeTax.toString(),
            extraMoneyFluff: changeOrderData.newValues.extraMoneyFluff.toString(),
            deposit: changeOrderData.newValues.deposit.toString(),
          });

          // If there were customer/building changes, switch to full mode
          if (changeOrderData.newCustomer) {
            setEditCustomer(true);
            setCustomer(changeOrderData.newCustomer);
            setMode('full');
          }
          if (changeOrderData.newBuilding) {
            setEditBuilding(true);
            setBuilding(changeOrderData.newBuilding);
            setMode('full');
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load order data');
    } finally {
      setLoading(false);
    }
  };

  const loadAdminOptions = async () => {
    try {
      const options = await getAllAdminOptions();
      setAdminOptions(options);
    } catch (err) {
      console.error('Failed to load admin options:', err);
    } finally {
      setOptionsLoading(false);
    }

    // Override manufacturers from manufacturer_config (single source of truth)
    try {
      const configs = await getActiveManufacturerConfigs();
      const manufacturerNames = configs.map(c => c.name).sort();
      if (manufacturerNames.length > 0) {
        setAdminOptions(prev => ({ ...prev, manufacturers: manufacturerNames }));
      }
    } catch (err) {
      console.error('Failed to load manufacturer configs, falling back to admin options:', err);
    }
  };

  // Calculate pricing differences
  const calculatePreviewDifferences = () => {
    if (!order) return null;

    const currentSnapshot: PricingSnapshot = {
      subtotalBeforeTax: order.pricing.subtotalBeforeTax,
      extraMoneyFluff: order.pricing.extraMoneyFluff,
      deposit: order.pricing.deposit,
      total: calculateTotal(order.pricing.subtotalBeforeTax, order.pricing.extraMoneyFluff),
    };

    const newSnapshot: PricingSnapshot = {
      subtotalBeforeTax: parseFloat(newPricing.subtotalBeforeTax) || 0,
      extraMoneyFluff: parseFloat(newPricing.extraMoneyFluff) || 0,
      deposit: parseFloat(newPricing.deposit) || 0,
      total: 0,
    };
    newSnapshot.total = calculateTotal(newSnapshot.subtotalBeforeTax, newSnapshot.extraMoneyFluff);

    return calculateDifferences(currentSnapshot, newSnapshot);
  };

  // Calculate cumulative from original
  const calculateCumulativePreview = () => {
    if (!order) return null;

    const originalPricing = order.originalPricing || order.pricing;
    const originalSnapshot: PricingSnapshot = {
      subtotalBeforeTax: originalPricing.subtotalBeforeTax,
      extraMoneyFluff: originalPricing.extraMoneyFluff,
      deposit: originalPricing.deposit,
      total: calculateTotal(originalPricing.subtotalBeforeTax, originalPricing.extraMoneyFluff),
    };

    const newSnapshot: PricingSnapshot = {
      subtotalBeforeTax: parseFloat(newPricing.subtotalBeforeTax) || 0,
      extraMoneyFluff: parseFloat(newPricing.extraMoneyFluff) || 0,
      deposit: parseFloat(newPricing.deposit) || 0,
      total: 0,
    };
    newSnapshot.total = calculateTotal(newSnapshot.subtotalBeforeTax, newSnapshot.extraMoneyFluff);

    return calculateDifferences(originalSnapshot, newSnapshot);
  };

  const differences = calculatePreviewDifferences();
  const cumulativeDiff = calculateCumulativePreview();

  // Compute customer/building changes for summary
  const getCustomerChanges = (): CustomerChange[] => {
    if (!order || !editCustomer || !customer) return [];
    return computeCustomerChanges(order.customer, customer);
  };

  const getBuildingChanges = (): BuildingChange[] => {
    if (!order || !editBuilding || !building) return [];
    return computeBuildingChanges(order.building, building);
  };

  const customerChanges = getCustomerChanges();
  const buildingChanges = getBuildingChanges();

  // Build form data
  const buildFormData = (): ChangeOrderFormData => {
    return {
      reason,
      newValues: newPricing,
      editCustomer,
      editBuilding,
      customer: editCustomer ? customer || undefined : undefined,
      building: editBuilding ? building || undefined : undefined,
      customerChanges,
      buildingChanges,
      pendingFiles,
    };
  };

  const handleSaveDraft = async () => {
    if (!order || !user) return;

    if (!reason.trim()) {
      setError('Please enter a reason for the change');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const formData = buildFormData();

      if (existingChangeOrder?.id) {
        await updateChangeOrder(existingChangeOrder.id, formData, order);
      } else {
        await createChangeOrder(order, formData, user.uid);
      }

      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to save change order');
    } finally {
      setSaving(false);
    }
  };

  const handleSendForSignature = async () => {
    if (!order || !user) return;

    if (!reason.trim()) {
      setError('Please enter a reason for the change');
      return;
    }

    // Validate payment if deposit is increasing and collecting now
    const depositDiffAmount = Math.abs(differences?.depositDiff || 0);
    const hasDepositIncreaseNow = (differences?.depositDiff || 0) > 0;

    if (hasDepositIncreaseNow && collectPaymentNow) {
      // Stripe Charge Card requires successful charge
      if (paymentType === 'stripe_charge_card') {
        if (!cardChargeResult?.success) {
          setError('Please charge the card on file before sending');
          return;
        }
      }
      // Stripe Already Paid requires verification
      else if (paymentType === 'stripe_already_paid') {
        if (!stripeVerified) {
          setError('Please verify the Stripe payment before sending');
          return;
        }
      }
      // Stripe Pay Now requires payment link to be created
      else if (paymentType === 'stripe_pay_now') {
        // Payment link will be created during send - no validation needed here
      }
      // Manual types require manager approval (skip for logged-in managers)
      else if (['check', 'wire', 'credit_on_file', 'other'].includes(paymentType)) {
        if (!isManager && !managerApprovalCode.trim()) {
          setError('Please enter the manager approval code for manual payment');
          return;
        }
      }
    }

    setSending(true);
    setError(null);
    try {
      const formData = buildFormData();

      let savedChangeOrderId = existingChangeOrder?.id;

      // Save first
      if (existingChangeOrder?.id) {
        await updateChangeOrder(existingChangeOrder.id, formData, order);
      } else {
        const newChangeOrder = await createChangeOrder(order, formData, user.uid);
        savedChangeOrderId = newChangeOrder.id;
      }

      // Send for signature (use test mode if enabled or if parent order is in test mode)
      const useTestMode = testMode || order.isTestMode;

      // Build payment info for deposit difference
      const isManualPayment = ['check', 'wire', 'credit_on_file', 'other'].includes(paymentType);
      const isStripeWithId = paymentType === 'stripe_already_paid' || paymentType === 'stripe_charge_card';

      const paymentInfo = hasDepositIncreaseNow ? {
        depositDifference: depositDiffAmount,
        collectNow: collectPaymentNow,
        paymentType: collectPaymentNow ? paymentType : undefined,
        stripePaymentId: collectPaymentNow && isStripeWithId ? stripePaymentId : undefined,
        managerApprovalCode: collectPaymentNow && isManualPayment && !isManager ? managerApprovalCode : undefined,
        approvedByEmail: collectPaymentNow && isManualPayment && isManager ? user?.email : undefined,
        approvedByRole: collectPaymentNow && isManualPayment && isManager ? 'manager' : undefined,
      } : (differences?.depositDiff || 0) < 0 ? {
        depositDifference: depositDiffAmount,
        isRefund: true,
      } : undefined;

      if (savedChangeOrderId) {
        const response = await fetch(
          `${import.meta.env.VITE_FUNCTIONS_URL || ''}/sendChangeOrderForSignature`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              changeOrderId: savedChangeOrderId,
              testMode: useTestMode,
              paymentInfo,
            }),
          }
        );

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to send for signature');
        }
      }

      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to send for signature');
    } finally {
      setSending(false);
    }
  };

  const formatDiff = (value: number) => {
    if (value === 0) return '$0';
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toLocaleString()}`;
  };

  // Get deposit difference amount
  const depositDiff = differences?.depositDiff || 0;
  const hasDepositIncrease = depositDiff > 0;
  const hasDepositDecrease = depositDiff < 0;
  const depositDiffAmount = Math.abs(depositDiff);

  // Verify Stripe payment for deposit difference
  const handleVerifyStripePayment = async () => {
    if (!stripePaymentId.trim()) {
      setError('Please enter a Stripe Payment ID');
      return;
    }

    setStripeVerifying(true);
    setError(null);
    setStripeVerificationResult(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/verifyStripePaymentRecord`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stripePaymentId: stripePaymentId.trim(),
            expectedAmount: depositDiffAmount,
          }),
        }
      );

      const data = await response.json();

      if (data.success && data.verified) {
        setStripeVerified(true);
        setStripeVerificationResult({
          verified: true,
          amount: data.amountDollars,
        });
      } else {
        setStripeVerificationResult({
          verified: false,
          error: data.error || 'Payment verification failed',
        });
      }
    } catch (err: any) {
      setStripeVerificationResult({
        verified: false,
        error: err.message || 'Failed to verify payment',
      });
    } finally {
      setStripeVerifying(false);
    }
  };

  // Charge the card on file for the additional deposit
  const handleChargeCardOnFile = async () => {
    if (!order?.payment?.stripeCustomerId) {
      setError('No card on file for this customer');
      return;
    }

    setChargingCard(true);
    setError(null);
    setCardChargeResult(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/chargeCardOnFile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: order.payment.stripeCustomerId,
            amount: depositDiffAmount,
            description: `Additional deposit for change order`,
          }),
        }
      );

      const data = await response.json();

      if (data.success) {
        setCardChargeResult({
          success: true,
          paymentId: data.paymentId,
        });
        setStripePaymentId(data.paymentId);
        setStripeVerified(true);
      } else {
        setCardChargeResult({
          success: false,
          error: data.error || 'Failed to charge card',
        });
      }
    } catch (err: any) {
      setCardChargeResult({
        success: false,
        error: err.message || 'Failed to charge card',
      });
    } finally {
      setChargingCard(false);
    }
  };

  // Check if order has a card on file
  const hasCardOnFile = !!order?.payment?.stripeCustomerId;

  const handleCustomerChange = (field: keyof CustomerInfo, value: string) => {
    if (customer) {
      setCustomer({ ...customer, [field]: value });
    }
  };

  const handleBuildingChange = (field: keyof BuildingInfo, value: string | boolean) => {
    if (building) {
      setBuilding({ ...building, [field]: value });
    }
  };

  const switchToFullMode = () => {
    setMode('full');
    // Initialize customer/building from order if not already set
    if (order) {
      if (!customer) setCustomer({ ...order.customer });
      if (!building) setBuilding({ ...order.building });
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <p>Loading order data...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div style={styles.errorContainer}>
        <p>Order not found</p>
        <button onClick={onCancel} style={styles.backButton}>
          Back to Orders
        </button>
      </div>
    );
  }

  // Check if there are any changes
  const hasChanges =
    differences && (differences.subtotalDiff !== 0 || differences.depositDiff !== 0 || differences.extraMoneyFluffDiff !== 0) ||
    customerChanges.length > 0 ||
    buildingChanges.length > 0 ||
    pendingFiles.orderFormPdf !== null ||
    pendingFiles.renderings.length > 0 ||
    pendingFiles.extraFiles.length > 0 ||
    pendingFiles.installerFiles.length > 0;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={onCancel} style={styles.backButton}>
          ← Back to Order
        </button>
        <div style={styles.headerRight}>
          {mode === 'full' && (
            <button onClick={() => setMode('compact')} style={styles.modeSwitchButton}>
              Switch to Simple View
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div style={styles.titleSection}>
        <h1 style={styles.title}>
          {mode === 'full' ? 'FULL ' : ''}CHANGE ORDER for {order.orderNumber}
        </h1>
        {existingChangeOrder && (
          <span style={styles.changeOrderNumber}>{existingChangeOrder.changeOrderNumber}</span>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Main Form Content */}
      <div style={styles.content}>
        {/* Reason Field - Always visible */}
        <div style={styles.section}>
          <label style={styles.label}>
            Reason for Change <span style={styles.required}>*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe what is changing and why..."
            style={styles.textarea}
            rows={3}
          />
        </div>

        {/* Full Mode: Customer Section */}
        {mode === 'full' && (
          <div style={styles.editableSection}>
            <div style={styles.sectionHeader}>
              <div style={styles.sectionHeaderLeft}>
                <input
                  type="checkbox"
                  id="editCustomer"
                  checked={editCustomer}
                  onChange={(e) => setEditCustomer(e.target.checked)}
                  style={styles.checkbox}
                />
                <label htmlFor="editCustomer" style={styles.sectionTitle}>
                  Edit Customer Contact
                </label>
              </div>
              {editCustomer && (
                <button
                  onClick={() => setShowOriginalCustomer(!showOriginalCustomer)}
                  style={styles.showOriginalButton}
                >
                  {showOriginalCustomer ? 'Hide Original' : 'Show Original'}
                </button>
              )}
            </div>

            {editCustomer && customer && (
              <div style={styles.sectionContent}>
                {showOriginalCustomer && (
                  <div style={styles.originalValues}>
                    <h5 style={styles.originalTitle}>Original Values:</h5>
                    <div style={styles.originalGrid}>
                      <div><strong>Name:</strong> {order.customer.firstName} {order.customer.lastName}</div>
                      <div><strong>Address:</strong> {order.customer.deliveryAddress}</div>
                      <div><strong>City/State/Zip:</strong> {order.customer.state} {order.customer.zip}</div>
                      <div><strong>Phone:</strong> {order.customer.phone}</div>
                      <div><strong>Email:</strong> {order.customer.email}</div>
                    </div>
                  </div>
                )}
                <CustomerSection
                  customer={customer}
                  onChange={handleCustomerChange}
                  states={adminOptions.states || []}
                  statesLoading={optionsLoading}
                />
              </div>
            )}
          </div>
        )}

        {/* Full Mode: Building Section */}
        {mode === 'full' && (
          <div style={styles.editableSection}>
            <div style={styles.sectionHeader}>
              <div style={styles.sectionHeaderLeft}>
                <input
                  type="checkbox"
                  id="editBuilding"
                  checked={editBuilding}
                  onChange={(e) => setEditBuilding(e.target.checked)}
                  style={styles.checkbox}
                />
                <label htmlFor="editBuilding" style={styles.sectionTitle}>
                  Edit Building Project
                </label>
              </div>
              {editBuilding && (
                <button
                  onClick={() => setShowOriginalBuilding(!showOriginalBuilding)}
                  style={styles.showOriginalButton}
                >
                  {showOriginalBuilding ? 'Hide Original' : 'Show Original'}
                </button>
              )}
            </div>

            {editBuilding && building && (
              <div style={styles.sectionContent}>
                {showOriginalBuilding && (
                  <div style={styles.originalValues}>
                    <h5 style={styles.originalTitle}>Original Values:</h5>
                    <div style={styles.originalGrid}>
                      <div><strong>Manufacturer:</strong> {order.building.manufacturer}</div>
                      <div><strong>Type:</strong> {order.building.buildingType}</div>
                      <div><strong>Dimensions:</strong> {order.building.overallWidth} x {order.building.buildingLength} x {order.building.buildingHeight}</div>
                      <div><strong>Foundation:</strong> {order.building.foundationType}</div>
                      <div><strong>Lull Lift:</strong> {order.building.lullLiftRequired ? 'Yes' : 'No'}</div>
                      <div><strong>Land Ready:</strong> {order.building.customerLandIsReady ? 'Yes' : 'No'}</div>
                    </div>
                  </div>
                )}
                <BuildingSection
                  building={building}
                  onChange={handleBuildingChange}
                  adminOptions={adminOptions}
                  optionsLoading={optionsLoading}
                />
              </div>
            )}
          </div>
        )}

        {/* Pricing Section - Always visible */}
        <div style={styles.pricingSection}>
          <h3 style={styles.pricingSectionTitle}>NEW PRICING</h3>
          <div style={styles.pricingGrid}>
            <div style={styles.priceField}>
              <label style={styles.priceLabel}>Subtotal</label>
              <div style={styles.inputWrapper}>
                <span style={styles.dollarSign}>$</span>
                <input
                  type="number"
                  value={newPricing.subtotalBeforeTax}
                  onChange={(e) =>
                    setNewPricing({ ...newPricing, subtotalBeforeTax: e.target.value })
                  }
                  style={styles.priceInput}
                />
              </div>
              {differences && (
                <span style={getDiffBadgeStyle(differences.subtotalDiff)}>
                  Δ {formatDiff(differences.subtotalDiff)}
                </span>
              )}
            </div>

            <div style={styles.priceField}>
              <label style={styles.priceLabel}>Extra/Fluff</label>
              <div style={styles.inputWrapper}>
                <span style={styles.dollarSign}>$</span>
                <input
                  type="number"
                  value={newPricing.extraMoneyFluff}
                  onChange={(e) =>
                    setNewPricing({ ...newPricing, extraMoneyFluff: e.target.value })
                  }
                  style={styles.priceInput}
                />
              </div>
              {differences && (
                <span style={getDiffBadgeStyle(differences.extraMoneyFluffDiff)}>
                  Δ {formatDiff(differences.extraMoneyFluffDiff)}
                </span>
              )}
            </div>

            <div style={styles.priceField}>
              <label style={styles.priceLabel}>Deposit</label>
              <div style={styles.inputWrapper}>
                <span style={styles.dollarSign}>$</span>
                <input
                  type="number"
                  value={newPricing.deposit}
                  onChange={(e) =>
                    setNewPricing({ ...newPricing, deposit: e.target.value })
                  }
                  style={styles.priceInput}
                />
              </div>
              {differences && (
                <span style={getDiffBadgeStyle(differences.depositDiff)}>
                  Δ {formatDiff(differences.depositDiff)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Deposit Difference Section */}
        {(hasDepositIncrease || hasDepositDecrease) && (
          <div style={hasDepositIncrease ? styles.depositIncreaseSection : styles.depositDecreaseSection}>
            {hasDepositIncrease ? (
              <>
                <h3 style={styles.depositDiffTitle}>
                  ADDITIONAL DEPOSIT REQUIRED: ${depositDiffAmount.toLocaleString()}
                </h3>
                <p style={styles.depositDiffSubtext}>
                  The deposit is increasing. You can collect payment now or flag for later collection.
                </p>

                <div style={styles.paymentOptions}>
                  <label style={styles.paymentOptionLabel}>
                    <input
                      type="radio"
                      checked={collectPaymentNow}
                      onChange={() => setCollectPaymentNow(true)}
                      style={styles.radioInput}
                    />
                    <span>Collect payment now</span>
                  </label>
                  <label style={styles.paymentOptionLabel}>
                    <input
                      type="radio"
                      checked={!collectPaymentNow}
                      onChange={() => setCollectPaymentNow(false)}
                      style={styles.radioInput}
                    />
                    <span>Collect payment later (will be flagged)</span>
                  </label>
                </div>

                {collectPaymentNow && (
                  <div style={styles.paymentForm}>
                    {/* Payment Type Selection */}
                    <div style={styles.paymentTypeSection}>
                      <label style={styles.inputLabel}>Payment Type</label>
                      <select
                        value={paymentType}
                        onChange={(e) => {
                          setPaymentType(e.target.value as typeof paymentType);
                          // Reset verification state when changing type
                          setStripePaymentId('');
                          setStripeVerified(false);
                          setStripeVerificationResult(null);
                          setPaymentLinkUrl('');
                          setCardChargeResult(null);
                        }}
                        style={styles.paymentTypeSelect}
                      >
                        {hasCardOnFile && (
                          <option value="stripe_charge_card">Stripe - Charge Card on File</option>
                        )}
                        <option value="stripe_pay_now">Stripe - Generate Payment Link</option>
                        <option value="stripe_already_paid">Stripe - Already Paid (Enter ID)</option>
                        <option value="check">Check</option>
                        <option value="wire">Wire Transfer</option>
                        <option value="credit_on_file">Credit on File</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {/* Stripe - Charge Card on File */}
                    {paymentType === 'stripe_charge_card' && (
                      <div style={styles.stripeChargeSection}>
                        {!cardChargeResult?.success ? (
                          <>
                            <p style={styles.chargeCardNote}>
                              Charge the customer's card on file for ${depositDiffAmount.toLocaleString()}
                            </p>
                            <button
                              type="button"
                              onClick={handleChargeCardOnFile}
                              disabled={chargingCard}
                              style={styles.chargeCardButton}
                            >
                              {chargingCard ? 'Charging...' : `Charge $${depositDiffAmount.toLocaleString()} Now`}
                            </button>
                            {cardChargeResult?.error && (
                              <div style={styles.verifyError}>
                                {cardChargeResult.error}
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={styles.chargeSuccess}>
                            <span style={styles.chargeSuccessIcon}>✓</span>
                            <span>Card charged successfully!</span>
                            <span style={styles.chargeSuccessId}>
                              Payment ID: {cardChargeResult.paymentId}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stripe Pay Now - Create Payment Link */}
                    {paymentType === 'stripe_pay_now' && (
                      <div style={styles.stripePayNowSection}>
                        {!paymentLinkUrl ? (
                          <>
                            <p style={styles.stripePayNowNote}>
                              A payment link for ${depositDiffAmount.toLocaleString()} will be created when you send for signature.
                            </p>
                          </>
                        ) : (
                          <div style={styles.paymentLinkCreated}>
                            <span style={styles.paymentLinkLabel}>Payment Link:</span>
                            <a href={paymentLinkUrl} target="_blank" rel="noopener noreferrer" style={styles.paymentLink}>
                              {paymentLinkUrl.substring(0, 50)}...
                            </a>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(paymentLinkUrl)}
                              style={styles.copyButton}
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stripe Already Paid - Enter and Verify ID */}
                    {paymentType === 'stripe_already_paid' && (
                      <div style={styles.stripeSection}>
                        <label style={styles.inputLabel}>Stripe Payment ID</label>
                        <div style={styles.stripeInputRow}>
                          <input
                            type="text"
                            value={stripePaymentId}
                            onChange={(e) => {
                              setStripePaymentId(e.target.value);
                              setStripeVerified(false);
                              setStripeVerificationResult(null);
                            }}
                            placeholder="pi_..."
                            style={styles.stripeInput}
                          />
                          <button
                            type="button"
                            onClick={handleVerifyStripePayment}
                            disabled={stripeVerifying || !stripePaymentId.trim()}
                            style={styles.verifyButton}
                          >
                            {stripeVerifying ? 'Verifying...' : 'Verify'}
                          </button>
                        </div>
                        {stripeVerificationResult && (
                          <div style={stripeVerificationResult.verified ? styles.verifySuccess : styles.verifyError}>
                            {stripeVerificationResult.verified
                              ? `Verified: $${stripeVerificationResult.amount?.toLocaleString()}`
                              : stripeVerificationResult.error}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Manual Payment Types - Check, Wire, Credit on File, Other */}
                    {['check', 'wire', 'credit_on_file', 'other'].includes(paymentType) && (
                      <div style={styles.manualSection}>
                        {isManager ? (
                          <span style={{ fontSize: '13px', color: '#2e7d32' }}>
                            Will be auto-approved as {user?.email}
                          </span>
                        ) : (
                          <>
                            <label style={styles.inputLabel}>Manager Approval Code</label>
                            <input
                              type="password"
                              value={managerApprovalCode}
                              onChange={(e) => setManagerApprovalCode(e.target.value)}
                              placeholder="Enter approval code"
                              style={styles.approvalInput}
                            />
                          </>
                        )}
                        <p style={styles.manualNote}>
                          {paymentType === 'check' && 'Check payment will be recorded. Proof can be uploaded in the Payment Section after the change order is sent.'}
                          {paymentType === 'wire' && 'Wire transfer will be recorded. Proof can be uploaded in the Payment Section after the change order is sent.'}
                          {paymentType === 'credit_on_file' && 'Credit on file will be applied. This uses previously collected customer funds.'}
                          {paymentType === 'other' && 'Payment will be recorded. Proof can be uploaded in the Payment Section after the change order is sent.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <h3 style={styles.depositDiffTitleRefund}>
                  REFUND DUE TO CUSTOMER: ${depositDiffAmount.toLocaleString()}
                </h3>
                <p style={styles.depositDiffSubtext}>
                  The deposit is decreasing. This will be flagged for manual refund processing after the change order is signed.
                </p>
              </>
            )}
          </div>
        )}

        {/* Files Section */}
        <div style={styles.filesSection}>
          <h3 style={styles.filesSectionTitle}>FILES & DOCUMENTS</h3>
          <ChangeOrderFileUpload
            files={pendingFiles}
            onChange={setPendingFiles}
          />
        </div>

        {/* Compact Mode: Switch to Full */}
        {mode === 'compact' && (
          <div style={styles.switchToFullSection}>
            <p style={styles.switchToFullText}>
              Need to edit Customer or Building info?
            </p>
            <button onClick={switchToFullMode} style={styles.switchToFullButton}>
              Switch to Full Change Order →
            </button>
          </div>
        )}

        {/* Full Mode: Change Summary */}
        {mode === 'full' && (customerChanges.length > 0 || buildingChanges.length > 0 || (differences && (differences.subtotalDiff !== 0 || differences.depositDiff !== 0))) && (
          <div style={styles.changeSummarySection}>
            <h3 style={styles.changeSummaryTitle}>CHANGE SUMMARY</h3>
            <ul style={styles.changeSummaryList}>
              {customerChanges.map((change, idx) => (
                <li key={`customer-${idx}`} style={styles.changeSummaryItem}>
                  <strong>Customer:</strong> {change.fieldLabel} changed from "{change.oldValue}" → "{change.newValue}"
                </li>
              ))}
              {buildingChanges.map((change, idx) => (
                <li key={`building-${idx}`} style={styles.changeSummaryItem}>
                  <strong>Building:</strong> {change.fieldLabel} changed from "{change.oldValue}" → "{change.newValue}"
                </li>
              ))}
              {differences && differences.subtotalDiff !== 0 && (
                <li style={styles.changeSummaryItem}>
                  <strong>Pricing:</strong> Subtotal {formatDiff(differences.subtotalDiff)}
                </li>
              )}
              {differences && differences.depositDiff !== 0 && (
                <li style={styles.changeSummaryItem}>
                  <strong>Pricing:</strong> Deposit {formatDiff(differences.depositDiff)}
                </li>
              )}
              {differences && differences.extraMoneyFluffDiff !== 0 && (
                <li style={styles.changeSummaryItem}>
                  <strong>Pricing:</strong> Extra/Fluff {formatDiff(differences.extraMoneyFluffDiff)}
                </li>
              )}
            </ul>
            {order.originalPricing && cumulativeDiff && (
              <div style={styles.cumulativeSummary}>
                <strong>Total from Original Order:</strong>{' '}
                {formatDiff(cumulativeDiff.totalDiff)} total, {formatDiff(cumulativeDiff.depositDiff)} deposit
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={styles.actions}>
        <button onClick={onCancel} style={styles.cancelButton} disabled={saving || sending}>
          Cancel
        </button>
        <div style={styles.rightActions}>
          <button
            onClick={handleSaveDraft}
            style={styles.saveDraftButton}
            disabled={saving || sending || !reason.trim()}
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <div style={styles.sendWithTestMode}>
            <label style={styles.testModeLabel}>
              <input
                type="checkbox"
                checked={testMode || order?.isTestMode}
                onChange={(e) => setTestMode(e.target.checked)}
                disabled={order?.isTestMode}
                style={styles.testModeCheckbox}
              />
              <span style={styles.testModeText}>Test Mode</span>
            </label>
            <button
              onClick={handleSendForSignature}
              style={(testMode || order?.isTestMode) ? styles.sendButtonTest : styles.sendButton}
              disabled={saving || sending || !reason.trim() || !hasChanges}
            >
              {sending ? 'Sending...' : (testMode || order?.isTestMode) ? '⚠️ Test Send' : 'Send for Signature'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    display: 'flex',
    flexDirection: 'column',
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '400px',
    fontSize: '16px',
    color: '#666',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    gap: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: 'white',
    borderBottom: '1px solid #eee',
  },
  headerRight: {
    display: 'flex',
    gap: '12px',
  },
  backButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#2196F3',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  modeSwitchButton: {
    padding: '8px 16px',
    backgroundColor: '#f5f5f5',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  titleSection: {
    padding: '24px',
    backgroundColor: 'white',
    borderBottom: '1px solid #eee',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 600,
    color: '#333',
  },
  changeOrderNumber: {
    marginLeft: '12px',
    fontSize: '14px',
    color: '#666',
    backgroundColor: '#f0f0f0',
    padding: '4px 8px',
    borderRadius: '4px',
  },
  error: {
    margin: '16px 24px',
    padding: '12px 16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '6px',
    fontSize: '14px',
  },
  content: {
    flex: 1,
    padding: '24px',
    maxWidth: '900px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  section: {
    marginBottom: '24px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '8px',
  },
  required: {
    color: '#dc3545',
  },
  textarea: {
    width: '100%',
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  editableSection: {
    marginBottom: '24px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    backgroundColor: '#fafafa',
    borderBottom: '1px solid #eee',
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
    cursor: 'pointer',
  },
  showOriginalButton: {
    padding: '6px 12px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sectionContent: {
    padding: '16px 20px',
  },
  originalValues: {
    padding: '12px 16px',
    backgroundColor: '#fff8e1',
    borderRadius: '6px',
    marginBottom: '16px',
    border: '1px solid #ffe082',
  },
  originalTitle: {
    margin: '0 0 8px 0',
    fontSize: '13px',
    fontWeight: 600,
    color: '#f57c00',
  },
  originalGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    fontSize: '13px',
    color: '#666',
  },
  pricingSection: {
    marginBottom: '24px',
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #e0e0e0',
  },
  pricingSectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2196F3',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
  },
  priceField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  priceLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#666',
  },
  inputWrapper: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  dollarSign: {
    padding: '0 10px',
    color: '#666',
    backgroundColor: '#f5f5f5',
    borderRight: '1px solid #ddd',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
  },
  priceInput: {
    flex: 1,
    padding: '10px 12px',
    border: 'none',
    fontSize: '14px',
    outline: 'none',
  },
  filesSection: {
    marginBottom: '24px',
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #e0e0e0',
  },
  filesSectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2196F3',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  switchToFullSection: {
    padding: '20px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    textAlign: 'center',
    marginBottom: '24px',
    border: '1px dashed #ccc',
  },
  switchToFullText: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#666',
  },
  switchToFullButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#1565c0',
    border: '1px solid #1565c0',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  changeSummarySection: {
    marginBottom: '24px',
    backgroundColor: '#e8f5e9',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #a5d6a7',
  },
  changeSummaryTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2e7d32',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  changeSummaryList: {
    margin: 0,
    padding: '0 0 0 20px',
    listStyle: 'disc',
  },
  changeSummaryItem: {
    fontSize: '14px',
    color: '#333',
    marginBottom: '6px',
  },
  cumulativeSummary: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #a5d6a7',
    fontSize: '14px',
    color: '#2e7d32',
  },
  actions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    backgroundColor: 'white',
    borderTop: '1px solid #eee',
  },
  rightActions: {
    display: 'flex',
    gap: '12px',
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  saveDraftButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#1565c0',
    border: '1px solid #1565c0',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sendButton: {
    padding: '12px 24px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sendButtonTest: {
    padding: '12px 24px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sendWithTestMode: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  testModeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  testModeCheckbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  testModeText: {
    fontSize: '13px',
    color: '#e65100',
    fontWeight: 500,
  },
  // Deposit difference section styles
  depositIncreaseSection: {
    marginBottom: '24px',
    backgroundColor: '#fff3e0',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #ff9800',
  },
  depositDecreaseSection: {
    marginBottom: '24px',
    backgroundColor: '#e8f5e9',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #4caf50',
  },
  depositDiffTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#e65100',
  },
  depositDiffTitleRefund: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#2e7d32',
  },
  depositDiffSubtext: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    color: '#666',
  },
  paymentOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '16px',
  },
  paymentOptionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#333',
    cursor: 'pointer',
  },
  radioInput: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  paymentForm: {
    backgroundColor: 'white',
    borderRadius: '6px',
    padding: '16px',
    border: '1px solid #ddd',
  },
  methodToggle: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  methodButton: {
    flex: 1,
    padding: '10px 16px',
    backgroundColor: 'white',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  methodButtonActive: {
    flex: 1,
    padding: '10px 16px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: '1px solid #1565c0',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  stripeSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  inputLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#333',
  },
  stripeInputRow: {
    display: 'flex',
    gap: '8px',
  },
  stripeInput: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  verifyButton: {
    padding: '10px 16px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  verifySuccess: {
    padding: '8px 12px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 500,
  },
  verifyError: {
    padding: '8px 12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '13px',
  },
  manualSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  approvalInput: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  manualNote: {
    margin: '8px 0 0 0',
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  paymentTypeSection: {
    marginBottom: '16px',
  },
  paymentTypeSelect: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
    cursor: 'pointer',
  },
  stripePayNowSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  stripePayNowNote: {
    margin: 0,
    fontSize: '13px',
    color: '#666',
    fontStyle: 'italic',
    padding: '12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
  },
  paymentLinkCreated: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    flexWrap: 'wrap',
  },
  paymentLinkLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#333',
  },
  paymentLink: {
    fontSize: '12px',
    color: '#1565c0',
    wordBreak: 'break-all',
  },
  copyButton: {
    padding: '4px 10px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  stripeChargeSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#e3f2fd',
    borderRadius: '6px',
    border: '1px solid #90caf9',
  },
  chargeCardNote: {
    margin: 0,
    fontSize: '14px',
    color: '#1565c0',
    fontWeight: 500,
  },
  chargeCardButton: {
    padding: '12px 24px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  chargeSuccess: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '16px',
    backgroundColor: '#e8f5e9',
    borderRadius: '6px',
    color: '#2e7d32',
    fontWeight: 500,
  },
  chargeSuccessIcon: {
    fontSize: '24px',
    color: '#2e7d32',
  },
  chargeSuccessId: {
    fontSize: '12px',
    color: '#666',
    fontFamily: 'monospace',
  },
};
