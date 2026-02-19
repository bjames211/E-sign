import React, { useState, useRef, useEffect } from 'react';
import { Order, OrderStatus, MANUAL_PAYMENT_TYPES } from '../../types/order';
import { ChangeOrder, ChangeOrderFormData } from '../../types/changeOrder';
import { Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import {
  getChangeOrdersForOrder,
  createChangeOrder,
  updateChangeOrder,
  deleteChangeOrder,
} from '../../services/changeOrderService';
import { ChangeOrderForm } from './ChangeOrderForm';
import { ChangeOrderCard } from './ChangeOrderCard';
import { OrderInteractionHistory } from './OrderInteractionHistory';
import { PaymentSection } from '../payments/PaymentSection';
import { getOrderAuditLog } from '../../services/orderService';

interface ValidationResponse {
  requiresManagerApproval?: boolean;
  requiresPaymentApproval?: boolean;
  savedAsDraft?: boolean;
  stripeVerificationFailed?: boolean;
  stripeAmountMismatch?: boolean;
  validationErrors?: string[];
  validationWarnings?: string[];
  message?: string;
  error?: string;
  stripeVerification?: {
    verified: boolean;
    paymentAmountDollars: number;
    matchesDeposit: boolean;
    isUnique: boolean;
    duplicateOrderId?: string;
    errorMessage?: string;
  };
}

interface OrderDetailsProps {
  order: Order;
  onClose: () => void;
  onSendForSignature: (orderId: string, managerApprovalCode?: string, testMode?: boolean) => Promise<ValidationResponse | void>;
  onDelete: (orderId: string) => Promise<void>;
  onCancelOrder?: (orderId: string, reason: string) => Promise<void>;
  onCancelSignature?: (orderId: string) => Promise<void>;
  onSendChangeOrderForSignature?: (changeOrderId: string) => Promise<void>;
  openWithPaymentApproval?: boolean;
  onRefresh?: () => void;
  onNavigateToChangeOrder?: (orderId: string, changeOrderId?: string) => void;
}

const STATUS_STYLES: Record<OrderStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f5f5f5', color: '#666', label: 'Draft' },
  pending_payment: { bg: '#fff3e0', color: '#e65100', label: 'Pending Payment' },
  sent_for_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  ready_for_manufacturer: { bg: '#4caf50', color: 'white', label: 'Ready for Manufacturer' },
  cancelled: { bg: '#ffebee', color: '#c62828', label: 'Cancelled' },
};

function formatDate(timestamp: Timestamp | any | undefined): string {
  if (!timestamp) return '-';

  try {
    let date: Date;

    // Handle Firestore Timestamp object with toDate method
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    }
    // Handle plain object with seconds property (from Firestore)
    else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    }
    // Handle Date object
    else if (timestamp instanceof Date) {
      date = timestamp;
    }
    // Handle timestamp number
    else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    }
    else {
      return '-';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (err) {
    console.error('Error formatting date:', err);
    return '-';
  }
}

export function OrderDetails({
  order,
  onClose,
  onSendForSignature,
  onDelete,
  onCancelOrder,
  onCancelSignature,
  onSendChangeOrderForSignature,
  openWithPaymentApproval = false,
  onRefresh,
  onNavigateToChangeOrder,
}: OrderDetailsProps) {
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [showCancelOrderModal, setShowCancelOrderModal] = useState(false);
  const [cancelOrderReason, setCancelOrderReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showManagerApproval, setShowManagerApproval] = useState(openWithPaymentApproval);
  const [managerCode, setManagerCode] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  // Auto-enable test mode if order was created in test mode
  const [esignTestMode, setEsignTestMode] = useState(order.isTestMode || false);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Change order state
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [loadingChangeOrders, setLoadingChangeOrders] = useState(false);
  const [changeOrdersError, setChangeOrdersError] = useState<string | null>(null);
  const [showChangeOrderForm, setShowChangeOrderForm] = useState(false);
  const [editingChangeOrder, setEditingChangeOrder] = useState<ChangeOrder | null>(null);

  // Tab state for Original/CO/Current view - can be 'original', 'current', or a change order ID
  const [orderViewTab, setOrderViewTab] = useState<string>('original');

  // Load change orders when order changes
  useEffect(() => {
    if (order.id) {
      loadChangeOrders();
    }
  }, [order.id]);

  const loadChangeOrders = async () => {
    if (!order.id) return;
    setLoadingChangeOrders(true);
    setChangeOrdersError(null);
    try {
      const cos = await getChangeOrdersForOrder(order.id);
      setChangeOrders(cos);
    } catch (err: any) {
      console.error('Failed to load change orders:', err);
      // Show error to user - especially important for missing Firestore index errors
      setChangeOrdersError(err.message || 'Failed to load change orders');
    } finally {
      setLoadingChangeOrders(false);
    }
  };

  const statusStyle = STATUS_STYLES[order.status] || STATUS_STYLES.draft;
  const isManualPaymentType = MANUAL_PAYMENT_TYPES.includes(order.payment?.type as any);

  const handleSendForSignature = async (withManagerApproval = false) => {
    if (!order.id) return;
    setSending(true);
    setError(null);
    setValidationErrors([]);
    setValidationWarnings([]);

    try {
      const result = await onSendForSignature(
        order.id,
        withManagerApproval ? managerCode : undefined,
        esignTestMode
      );

      // Check if saved as draft needing approval
      if (result?.savedAsDraft && result?.requiresManagerApproval) {
        setValidationErrors(result.validationErrors || []);
        setValidationWarnings(result.validationWarnings || []);
        setError(result.message || 'Order saved. Manager approval required to send.');
        // Close the modal - order is saved, user can re-open to approve
        onClose();
        return;
      }

      // Check if manager approval is required (immediate dialog)
      if (result?.requiresManagerApproval) {
        setShowManagerApproval(true);
        setValidationErrors(result.validationErrors || []);
        setValidationWarnings(result.validationWarnings || []);
        setError(result.message || 'Manager approval required');
        return;
      }

      // Check if payment approval is required
      if (result?.requiresPaymentApproval) {
        setShowManagerApproval(true);
        // Don't show error - just show the approval dialog
        setError(null);
        return;
      }

      // Check if Stripe verification failed
      if (result?.stripeVerificationFailed) {
        setError(result.error || result.message || 'Stripe payment verification failed');
        return;
      }

      // Success - close the modal
      setShowManagerApproval(false);
      setManagerCode('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to send for signature');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleProofFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFile(file);
      // Create preview URL for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setProofPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setProofPreview(null);
      }
    }
  };

  const uploadProofFile = async (): Promise<{ name: string; storagePath: string; downloadUrl: string; size: number; type: string } | null> => {
    if (!proofFile || !order.id) return null;

    setUploadingProof(true);
    try {
      const timestamp = Date.now();
      const sanitizedName = proofFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `orders/${order.orderNumber}/payment-proof/${timestamp}_${sanitizedName}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, proofFile);
      const downloadUrl = await getDownloadURL(storageRef);

      return {
        name: proofFile.name,
        storagePath,
        downloadUrl,
        size: proofFile.size,
        type: proofFile.type,
      };
    } catch (err) {
      console.error('Failed to upload proof file:', err);
      throw new Error('Failed to upload proof file');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleManagerApprovalSubmit = async () => {
    if (!managerCode.trim()) {
      setError('Please enter the manager approval code');
      return;
    }

    // For manual payment types needing payment approval (at any stage)
    const needsPaymentApproval = isManualPaymentType &&
      order.payment?.status !== 'paid' &&
      order.payment?.status !== 'manually_approved';

    if (needsPaymentApproval) {
      // Validate payment amount
      const amount = parseFloat(paymentAmount);
      if (!paymentAmount || isNaN(amount) || amount <= 0) {
        setError('Please enter a valid payment amount');
        return;
      }

      // Validate proof file
      if (!proofFile) {
        setError('Please upload proof of payment (check photo, wire confirmation, etc.)');
        return;
      }

      // Upload proof and call approval endpoint
      setSending(true);
      setError(null);
      try {
        const uploadedProof = await uploadProofFile();

        const response = await fetch(
          `${import.meta.env.VITE_FUNCTIONS_URL || ''}/approveManualPayment`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.id,
              approvalCode: managerCode,
              approvedBy: 'Manager',
              proofFile: uploadedProof,
              amount: amount,
            }),
          }
        );

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to approve payment');
        }

        // Success - close modal and refresh
        setShowManagerApproval(false);
        setManagerCode('');
        setProofFile(null);
        setProofPreview(null);
        setPaymentAmount('');
        onClose();
      } catch (err: any) {
        setError(err.message || 'Failed to approve payment');
      } finally {
        setSending(false);
      }
      return;
    }

    // For deposit discrepancy approval on draft orders, send for signature with manager code
    handleSendForSignature(true);
  };

  const handleDelete = async () => {
    if (!order.id) return;
    if (!window.confirm('Are you sure you want to delete this order?')) return;

    setDeleting(true);
    setError(null);
    try {
      await onDelete(order.id);
      onClose();
    } catch (err) {
      setError('Failed to delete order');
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelSignature = async () => {
    if (!order.id || !onCancelSignature) return;
    if (!window.confirm('Are you sure you want to cancel this signature request? The order will be reverted to draft status.')) return;

    setCancelling(true);
    setError(null);
    try {
      await onCancelSignature(order.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel signature');
      console.error(err);
    } finally {
      setCancelling(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order.id || !onCancelOrder) return;
    if (!cancelOrderReason.trim()) {
      setError('Please enter a reason for cancellation');
      return;
    }

    setCancellingOrder(true);
    setError(null);
    try {
      await onCancelOrder(order.id, cancelOrderReason.trim());
      setShowCancelOrderModal(false);
      setCancelOrderReason('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel order');
      console.error(err);
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleTestSign = async () => {
    if (!order.id || !order.isTestMode) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/testSignOrder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id }),
        }
      );

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to test sign order');
      }

      // Refresh to show updated status
      if (onRefresh) {
        onRefresh();
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to test sign order');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleTestSignChangeOrder = async (changeOrderId: string) => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/testSignChangeOrder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changeOrderId }),
        }
      );

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to test sign change order');
      }

      // Refresh to show updated status
      await loadChangeOrders();
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to test sign change order');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  // Change order handlers
  const handleCreateChangeOrder = () => {
    if (onNavigateToChangeOrder && order.id) {
      // Navigate to dedicated page
      onClose();
      onNavigateToChangeOrder(order.id, undefined);
    } else {
      // Fallback to inline form
      setEditingChangeOrder(null);
      setShowChangeOrderForm(true);
    }
  };

  const handleEditChangeOrder = (changeOrder: ChangeOrder) => {
    if (onNavigateToChangeOrder && order.id && changeOrder.id) {
      // Navigate to dedicated page
      onClose();
      onNavigateToChangeOrder(order.id, changeOrder.id);
    } else {
      // Fallback to inline form
      setEditingChangeOrder(changeOrder);
      setShowChangeOrderForm(true);
    }
  };

  const handleSaveChangeOrder = async (formData: ChangeOrderFormData) => {
    if (!order.id) return;

    try {
      if (editingChangeOrder?.id) {
        // Update existing change order
        await updateChangeOrder(editingChangeOrder.id, formData, order);
      } else {
        // Create new change order
        await createChangeOrder(order, formData, order.createdBy || 'unknown');
      }

      await loadChangeOrders();
      setError(null);
    } catch (err: any) {
      console.error('Failed to save change order:', err);
      setError(err.message || 'Failed to save change order');
    }
  };

  const handleSendChangeOrderForSignature = async () => {
    if (!editingChangeOrder?.id && changeOrders.length === 0) {
      setError('No change order to send');
      return;
    }

    // Get the active change order (either the one being edited or the most recent draft)
    const activeChangeOrder = editingChangeOrder ||
      changeOrders.find(co => co.status === 'draft');

    if (!activeChangeOrder?.id) {
      setError('No draft change order to send');
      return;
    }

    if (onSendChangeOrderForSignature) {
      await onSendChangeOrderForSignature(activeChangeOrder.id);
      setShowChangeOrderForm(false);
      setEditingChangeOrder(null);
      await loadChangeOrders();
      if (onRefresh) onRefresh();
    } else {
      // Fallback: call the cloud function directly
      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/sendChangeOrderForSignature`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changeOrderId: activeChangeOrder.id }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to send change order for signature');
      }

      setShowChangeOrderForm(false);
      setEditingChangeOrder(null);
      await loadChangeOrders();
      if (onRefresh) onRefresh();
      onClose();
    }
  };

  const handleCancelChangeOrderForm = () => {
    setShowChangeOrderForm(false);
    setEditingChangeOrder(null);
  };

  const handleDeleteChangeOrder = async () => {
    if (!editingChangeOrder?.id) return;

    await deleteChangeOrder(editingChangeOrder.id);
    setShowChangeOrderForm(false);
    setEditingChangeOrder(null);
    await loadChangeOrders();
  };

  // Check if we can create change orders (not ready for manufacturer)
  const canCreateChangeOrder = order.status !== 'ready_for_manufacturer' && order.status !== 'cancelled';

  // Get active draft change order (only drafts block new creation)
  // pending_signature change orders don't block - user can create new CO which will cancel the pending one
  const activeDraftChangeOrder = changeOrders.find(co => co.status === 'draft');

  // Check the order's activeChangeOrderStatus for draft only
  const hasDraftChangeOrder = order.activeChangeOrderStatus === 'draft' || !!activeDraftChangeOrder;

  // Get pending_signature change order for display purposes
  const pendingSignatureChangeOrder = changeOrders.find(co => co.status === 'pending_signature');

  // Only block new change order creation if there's a DRAFT (user should edit it)
  const shouldBlockNewChangeOrder = hasDraftChangeOrder;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <span style={styles.orderNumber}>{order.orderNumber}</span>
            <span
              style={{
                ...styles.status,
                backgroundColor: statusStyle.bg,
                color: statusStyle.color,
              }}
            >
              {statusStyle.label}
            </span>
            {order.isTestMode && (
              <span style={styles.testModeBadge}>
                ⚠️ TEST MODE
              </span>
            )}
            {/* Prominent Cancel Order button in header */}
            {onCancelOrder &&
             (order.status === 'draft' || order.status === 'pending_payment' || order.status === 'sent_for_signature') && (
              <button
                onClick={() => setShowCancelOrderModal(true)}
                style={styles.cancelOrderHeaderButton}
              >
                Cancel Order
              </button>
            )}
          </div>
          <button onClick={onClose} style={styles.closeButton}>
            ×
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Cancelled Order Banner */}
        {order.status === 'cancelled' && (
          <div style={styles.cancelledBanner}>
            <div style={styles.cancelledBannerTitle}>Order Cancelled</div>
            <div style={styles.cancelledBannerReason}>
              <strong>Reason:</strong> {order.cancelReason || 'No reason provided'}
            </div>
            <div style={styles.cancelledBannerMeta}>
              Cancelled by {order.cancelledByEmail || 'unknown'} on {formatDate(order.cancelledAt)}
              {order.previousStatus && <> &middot; Previous status: {STATUS_STYLES[order.previousStatus]?.label || order.previousStatus}</>}
            </div>
          </div>
        )}

        {/* Cancel Order Modal */}
        {showCancelOrderModal && (
          <div style={styles.cancelOrderModal}>
            <h4 style={styles.cancelOrderModalTitle}>Cancel Order</h4>
            <p style={styles.cancelOrderModalText}>
              This will permanently cancel this order. Active change orders and signature requests will also be cancelled. Payment records will be preserved.
            </p>
            <textarea
              value={cancelOrderReason}
              onChange={(e) => setCancelOrderReason(e.target.value)}
              placeholder="Enter reason for cancellation..."
              style={styles.cancelOrderTextarea}
              rows={3}
            />
            <div style={styles.cancelOrderModalButtons}>
              <button
                onClick={() => { setShowCancelOrderModal(false); setCancelOrderReason(''); setError(null); }}
                style={styles.cancelButton}
              >
                Back
              </button>
              <button
                onClick={handleCancelOrder}
                disabled={cancellingOrder || !cancelOrderReason.trim()}
                style={{
                  ...styles.confirmCancelButton,
                  opacity: cancellingOrder || !cancelOrderReason.trim() ? 0.6 : 1,
                }}
              >
                {cancellingOrder ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        )}

        <div style={styles.content}>
          {/* ═══════════════════════════════════════════════════════════ */}
          {/* ORDER DETAILS with Original/Current Tabs */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div style={styles.majorSection}>
            <div style={styles.majorSectionHeader}>
              <h3 style={styles.majorSectionTitle}>ORDER DETAILS</h3>
            </div>

            {(() => {
              // Get signed change orders sorted by creation date (oldest first for tab order)
              const signedChangeOrders = changeOrders
                .filter(co => co.status === 'signed')
                .sort((a, b) => {
                  const aTime = a.createdAt?.seconds || 0;
                  const bTime = b.createdAt?.seconds || 0;
                  return aTime - bTime;
                });

              const hasSignedCOs = signedChangeOrders.length > 0;

              // Determine what tab is selected
              const isOriginal = orderViewTab === 'original';
              const isCurrent = orderViewTab === 'current';
              const selectedCO = signedChangeOrders.find(co => co.id === orderViewTab);

              // Determine pricing to display
              const originalPricing = order.originalPricing || order.pricing;
              let displayPricing = originalPricing;

              if (isCurrent) {
                displayPricing = order.pricing;
              } else if (selectedCO) {
                displayPricing = selectedCO.newValues;
              }

              // Determine customer/building to display
              // For a specific CO, show the newCustomer/newBuilding from that CO or fallback to previous
              let displayCustomer = order.customer;
              let displayBuilding = order.building;

              if (isCurrent) {
                // Use the most recent signed CO's values if available
                const latestCO = signedChangeOrders[signedChangeOrders.length - 1];
                if (latestCO?.newCustomer) displayCustomer = latestCO.newCustomer;
                if (latestCO?.newBuilding) displayBuilding = latestCO.newBuilding;
              } else if (selectedCO) {
                // For a specific CO, show the new values from that CO
                if (selectedCO.newCustomer) displayCustomer = selectedCO.newCustomer;
                if (selectedCO.newBuilding) displayBuilding = selectedCO.newBuilding;
              }

              // Determine which fields changed in this specific view
              const customerChangedFields = new Set<string>();
              const buildingChangedFields = new Set<string>();
              const pricingChanges = { subtotal: false, deposit: false, fluff: false };

              if (isCurrent && hasSignedCOs) {
                // Current view: show all changes from original
                signedChangeOrders.forEach(co => {
                  (co.customerChanges || []).forEach(c => customerChangedFields.add(c.field as string));
                  (co.buildingChanges || []).forEach(c => buildingChangedFields.add(c.field));
                });
                pricingChanges.subtotal = order.pricing.subtotalBeforeTax !== originalPricing.subtotalBeforeTax;
                pricingChanges.deposit = order.pricing.deposit !== originalPricing.deposit;
                pricingChanges.fluff = order.pricing.extraMoneyFluff !== originalPricing.extraMoneyFluff;
              } else if (selectedCO) {
                // Specific CO view: show only changes from this CO
                (selectedCO.customerChanges || []).forEach(c => customerChangedFields.add(c.field as string));
                (selectedCO.buildingChanges || []).forEach(c => buildingChangedFields.add(c.field));
                pricingChanges.subtotal = selectedCO.differences.subtotalDiff !== 0;
                pricingChanges.deposit = selectedCO.differences.depositDiff !== 0;
                pricingChanges.fluff = selectedCO.differences.extraMoneyFluffDiff !== 0;
              }

              const showChanges = isCurrent || !!selectedCO;
              const isCustomerFieldChanged = (field: string) => showChanges && customerChangedFields.has(field);
              const isBuildingFieldChanged = (field: string) => showChanges && buildingChangedFields.has(field);
              const isPricingChanged = (field: 'subtotal' | 'deposit' | 'fluff') => showChanges && pricingChanges[field];

              const displayCustomerName = `${displayCustomer.firstName} ${displayCustomer.lastName}`.trim();

              return (
                <>
                  {/* Tabs - only show if there are signed change orders */}
                  {hasSignedCOs && (
                    <div style={styles.viewTabsContainer}>
                      <div style={styles.viewTabs}>
                        <button
                          onClick={() => setOrderViewTab('original')}
                          style={{
                            ...styles.viewTab,
                            ...(isOriginal ? styles.viewTabActive : {}),
                          }}
                        >
                          Original
                        </button>
                        {signedChangeOrders.map((co) => (
                          <button
                            key={co.id}
                            onClick={() => setOrderViewTab(co.id!)}
                            style={{
                              ...styles.viewTab,
                              ...(orderViewTab === co.id ? styles.viewTabActive : {}),
                            }}
                          >
                            {co.changeOrderNumber}
                          </button>
                        ))}
                        <button
                          onClick={() => setOrderViewTab('current')}
                          style={{
                            ...styles.viewTab,
                            ...(isCurrent ? styles.viewTabActive : {}),
                          }}
                        >
                          Current
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Tab info banner */}
                  {isOriginal && hasSignedCOs && (
                    <div style={styles.originalViewBanner}>
                      Showing original order values before any change orders
                    </div>
                  )}
                  {selectedCO && (
                    <div style={styles.coViewBanner}>
                      <strong>{selectedCO.changeOrderNumber}</strong>: {selectedCO.reason || 'No reason provided'}
                      <span style={styles.coViewDate}>Signed {formatDate(selectedCO.signedAt)}</span>
                    </div>
                  )}
                  {isCurrent && hasSignedCOs && (
                    <div style={styles.currentViewBanner}>
                      Showing current values after {signedChangeOrders.length} signed change order{signedChangeOrders.length !== 1 ? 's' : ''}
                    </div>
                  )}

                  {/* Customer */}
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Customer</h4>
                    <div style={styles.grid}>
                      <div style={styles.field}>
                        <span style={styles.label}>Name</span>
                        <span style={{
                          ...styles.value,
                          ...(isCustomerFieldChanged('firstName') || isCustomerFieldChanged('lastName') ? styles.changedValue : {}),
                        }}>
                          {displayCustomerName}
                          {(isCustomerFieldChanged('firstName') || isCustomerFieldChanged('lastName')) && (
                            <span style={styles.changedBadge}>changed</span>
                          )}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Email</span>
                        <span style={{
                          ...styles.value,
                          ...(isCustomerFieldChanged('email') ? styles.changedValue : {}),
                        }}>
                          {displayCustomer.email}
                          {isCustomerFieldChanged('email') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Phone</span>
                        <span style={{
                          ...styles.value,
                          ...(isCustomerFieldChanged('phone') ? styles.changedValue : {}),
                        }}>
                          {displayCustomer.phone}
                          {isCustomerFieldChanged('phone') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Address</span>
                        <span style={{
                          ...styles.value,
                          ...(isCustomerFieldChanged('deliveryAddress') || isCustomerFieldChanged('state') || isCustomerFieldChanged('zip') ? styles.changedValue : {}),
                        }}>
                          {displayCustomer.deliveryAddress}, {displayCustomer.state} {displayCustomer.zip}
                          {(isCustomerFieldChanged('deliveryAddress') || isCustomerFieldChanged('state') || isCustomerFieldChanged('zip')) && (
                            <span style={styles.changedBadge}>changed</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Building */}
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Building</h4>
                    <div style={styles.grid}>
                      <div style={styles.field}>
                        <span style={styles.label}>Manufacturer</span>
                        <span style={{
                          ...styles.value,
                          ...(isBuildingFieldChanged('manufacturer') ? styles.changedValue : {}),
                        }}>
                          {displayBuilding.manufacturer}
                          {isBuildingFieldChanged('manufacturer') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Type</span>
                        <span style={{
                          ...styles.value,
                          ...(isBuildingFieldChanged('buildingType') ? styles.changedValue : {}),
                        }}>
                          {displayBuilding.buildingType}
                          {isBuildingFieldChanged('buildingType') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Dimensions</span>
                        <span style={{
                          ...styles.value,
                          ...(isBuildingFieldChanged('overallWidth') || isBuildingFieldChanged('buildingLength') || isBuildingFieldChanged('buildingHeight') ? styles.changedValue : {}),
                        }}>
                          {displayBuilding.overallWidth} x {displayBuilding.buildingLength} x {displayBuilding.buildingHeight}
                          {(isBuildingFieldChanged('overallWidth') || isBuildingFieldChanged('buildingLength') || isBuildingFieldChanged('buildingHeight')) && (
                            <span style={styles.changedBadge}>changed</span>
                          )}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Foundation</span>
                        <span style={{
                          ...styles.value,
                          ...(isBuildingFieldChanged('foundationType') ? styles.changedValue : {}),
                        }}>
                          {displayBuilding.foundationType}
                          {isBuildingFieldChanged('foundationType') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Lull Lift Required</span>
                        <span style={{
                          ...styles.value,
                          ...(isBuildingFieldChanged('lullLiftRequired') ? styles.changedValue : {}),
                        }}>
                          {displayBuilding.lullLiftRequired ? 'Yes' : 'No'}
                          {isBuildingFieldChanged('lullLiftRequired') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Land Ready</span>
                        <span style={{
                          ...styles.value,
                          ...(isBuildingFieldChanged('customerLandIsReady') ? styles.changedValue : {}),
                        }}>
                          {displayBuilding.customerLandIsReady ? 'Yes' : 'No'}
                          {isBuildingFieldChanged('customerLandIsReady') && <span style={styles.changedBadge}>changed</span>}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Pricing</h4>
                    <div style={styles.priceGrid}>
                      <div style={{
                        ...styles.priceRow,
                        ...(isPricingChanged('subtotal') ? styles.changedPriceRow : {}),
                      }}>
                        <span>Subtotal</span>
                        <span>
                          ${displayPricing.subtotalBeforeTax.toLocaleString()}
                          {isPricingChanged('subtotal') && (
                            <span style={styles.priceDiff}>
                              ({order.pricing.subtotalBeforeTax > originalPricing.subtotalBeforeTax ? '+' : ''}
                              ${(order.pricing.subtotalBeforeTax - originalPricing.subtotalBeforeTax).toLocaleString()})
                            </span>
                          )}
                        </span>
                      </div>
                      {displayPricing.extraMoneyFluff > 0 && (
                        <div style={{
                          ...styles.priceRow,
                          ...(isPricingChanged('fluff') ? styles.changedPriceRow : {}),
                        }}>
                          <span>Extra/Fluff</span>
                          <span>
                            ${displayPricing.extraMoneyFluff.toLocaleString()}
                            {isPricingChanged('fluff') && (
                              <span style={styles.priceDiff}>
                                ({order.pricing.extraMoneyFluff > originalPricing.extraMoneyFluff ? '+' : ''}
                                ${(order.pricing.extraMoneyFluff - originalPricing.extraMoneyFluff).toLocaleString()})
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      {/* Order Total - Subtotal + Extra/Fluff */}
                      <div style={{ ...styles.priceRow, ...styles.orderTotalRow }}>
                        <span style={{ fontWeight: 700 }}>ORDER TOTAL</span>
                        <span style={{ fontWeight: 700, fontSize: '16px' }}>
                          ${(displayPricing.subtotalBeforeTax + (displayPricing.extraMoneyFluff || 0)).toLocaleString()}
                        </span>
                      </div>
                      <div style={styles.priceDivider} />
                      <div style={{
                        ...styles.priceRow,
                        ...(isPricingChanged('deposit') ? styles.changedPriceRow : {}),
                      }}>
                        <span>Deposit Required</span>
                        <span>
                          ${displayPricing.deposit.toLocaleString()}
                          {isPricingChanged('deposit') && (
                            <span style={styles.priceDiff}>
                              ({order.pricing.deposit > originalPricing.deposit ? '+' : ''}
                              ${(order.pricing.deposit - originalPricing.deposit).toLocaleString()})
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={styles.priceRow}>
                        <span>Balance Due at Delivery</span>
                        <span>
                          ${(displayPricing.subtotalBeforeTax + (displayPricing.extraMoneyFluff || 0) - displayPricing.deposit).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Order Form PDF */}
                  {order.files?.orderFormPdf && (
                    <div style={styles.orderFormSection}>
                      <h4 style={styles.sectionTitle}>Order Form</h4>
                      <div style={styles.orderFormCard}>
                        <div style={styles.orderFormInfo}>
                          <span style={styles.orderFormName}>{order.files.orderFormPdf.name}</span>
                          <span style={styles.orderFormSize}>
                            {(order.files.orderFormPdf.size / 1024).toFixed(1)} KB
                          </span>
                        </div>
                        <div style={styles.orderFormActions}>
                          <a
                            href={order.files.orderFormPdf.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={styles.viewButton}
                          >
                            View PDF
                          </a>
                          <a
                            href={order.files.orderFormPdf.downloadUrl}
                            download={order.files.orderFormPdf.name}
                            style={styles.downloadButton}
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Additional Files */}
                  {order.files && (order.files.renderings?.length > 0 || order.files.extraFiles?.length > 0 || order.files.installerFiles?.length > 0) && (
                    <div style={styles.section}>
                      <h4 style={styles.sectionTitle}>Additional Files</h4>
                      <div style={styles.filesList}>
                        {order.files.renderings?.length > 0 && (
                          <div style={styles.fileGroup}>
                            <span style={styles.fileLabel}>Renderings ({order.files.renderings.length}):</span>
                            {order.files.renderings.map((file, i) => (
                              <a
                                key={i}
                                href={file.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={styles.fileLink}
                              >
                                {file.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {order.files.extraFiles?.length > 0 && (
                          <div style={styles.fileGroup}>
                            <span style={styles.fileLabel}>Extra Files ({order.files.extraFiles.length}):</span>
                            {order.files.extraFiles.map((file, i) => (
                              <a
                                key={i}
                                href={file.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={styles.fileLink}
                              >
                                {file.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {order.files.installerFiles?.length > 0 && (
                          <div style={styles.fileGroup}>
                            <span style={styles.fileLabel}>Installer Files ({order.files.installerFiles.length}):</span>
                            {order.files.installerFiles.map((file, i) => (
                              <a
                                key={i}
                                href={file.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={styles.fileLink}
                              >
                                {file.name}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Additional Info */}
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Additional Info</h4>
                    <div style={styles.grid}>
                      <div style={styles.field}>
                        <span style={styles.label}>Sales Person</span>
                        <span style={styles.value}>{order.salesPerson || '-'}</span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Referred By</span>
                        <span style={styles.value}>{order.referredBy || '-'}</span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Created</span>
                        <span style={styles.value}>{formatDate(order.createdAt)}</span>
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Updated</span>
                        <span style={styles.value}>{formatDate(order.updatedAt)}</span>
                      </div>
                      {order.specialNotes && (
                        <div style={styles.fieldFull}>
                          <span style={styles.label}>Special Notes</span>
                          <span style={styles.value}>{order.specialNotes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* CHANGE ORDERS */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div style={styles.majorSection}>
            <div style={styles.majorSectionHeader}>
              <h3 style={styles.majorSectionTitle}>
                CHANGE ORDERS {changeOrders.length > 0 && `(${changeOrders.length} total)`}
              </h3>
              <div style={styles.changeOrderHeaderActions}>
                {/* Show "Edit Draft" if there's a draft change order */}
                {canCreateChangeOrder && !showChangeOrderForm && activeDraftChangeOrder && (
                  <button
                    onClick={() => handleEditChangeOrder(activeDraftChangeOrder)}
                    style={styles.editChangeOrderButton}
                  >
                    Edit Draft ({activeDraftChangeOrder.changeOrderNumber})
                  </button>
                )}
                {/* Show "+ New Change Order" if no draft exists */}
                {canCreateChangeOrder && !showChangeOrderForm && !shouldBlockNewChangeOrder && (
                  <button onClick={handleCreateChangeOrder} style={styles.createChangeOrderButton}>
                    + New Change Order
                  </button>
                )}
              </div>
            </div>

            {/* Pending Signature Notice */}
            {pendingSignatureChangeOrder && !showChangeOrderForm && !activeDraftChangeOrder && (
              <div style={styles.pendingSignatureNotice}>
                <span style={styles.awaitingSignatureBadge}>
                  {pendingSignatureChangeOrder.changeOrderNumber} Awaiting Signature
                </span>
                {(pendingSignatureChangeOrder.isTestMode || order.isTestMode) && (
                  <button
                    onClick={() => pendingSignatureChangeOrder.id && handleTestSignChangeOrder(pendingSignatureChangeOrder.id)}
                    disabled={sending}
                    style={styles.testSignChangeOrderButton}
                  >
                    {sending ? 'Signing...' : 'Test Sign CO'}
                  </button>
                )}
              </div>
            )}

            {/* Change Order Form - only show if not using dedicated page */}
            {showChangeOrderForm && !onNavigateToChangeOrder && (
              <ChangeOrderForm
                order={order}
                existingChangeOrder={editingChangeOrder}
                onSave={handleSaveChangeOrder}
                onSendForSignature={handleSendChangeOrderForSignature}
                onCancel={handleCancelChangeOrderForm}
                onDelete={editingChangeOrder ? handleDeleteChangeOrder : undefined}
              />
            )}

            {/* Change Order Cards */}
            {loadingChangeOrders ? (
              <div style={styles.loadingChangeOrders}>Loading change orders...</div>
            ) : changeOrdersError ? (
              <div style={styles.changeOrdersError}>
                Error loading change orders: {changeOrdersError}
              </div>
            ) : changeOrders.length === 0 ? (
              <div style={styles.noChangeOrders}>
                No change orders yet
              </div>
            ) : (
              <div style={styles.changeOrdersList}>
                {changeOrders.map((co) => (
                  <ChangeOrderCard
                    key={co.id}
                    changeOrder={co}
                    onEdit={canCreateChangeOrder ? handleEditChangeOrder : undefined}
                    onTestSign={handleTestSignChangeOrder}
                    isTestMode={order.isTestMode}
                    sending={sending}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* PAYMENT */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div style={styles.majorSection}>
            <h3 style={styles.majorSectionTitle}>PAYMENT</h3>
            <PaymentSection order={order} onRefresh={onRefresh} readOnly={order.status === 'cancelled'} />
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* AI VALIDATION - Only show if validation data exists */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {order.validation && (
            <div style={styles.majorSection}>
              <h3 style={styles.majorSectionTitle}>AI VALIDATION</h3>

              {/* Deposit Check */}
              <div style={styles.validationBlock}>
                <span style={styles.validationLabel}>Deposit Check:</span>
                <div style={{
                  ...styles.depositCheckResult,
                  backgroundColor: order.validation.depositCheck.isDiscrepancy ? '#ffebee' : '#e8f5e9',
                  color: order.validation.depositCheck.isDiscrepancy ? '#c62828' : '#2e7d32',
                }}>
                  {order.validation.depositCheck.isDiscrepancy ? (
                    <>
                      Discrepancy: Expected {order.validation.depositCheck.expectedPercent}%,
                      Actual {order.validation.depositCheck.actualPercent}%
                    </>
                  ) : (
                    <>Deposit OK ({order.validation.depositCheck.actualPercent}%)</>
                  )}
                </div>
              </div>

              {/* Manager Approval */}
              {order.validation.managerApprovalRequired && (
                <div style={styles.validationBlock}>
                  <span style={styles.validationLabel}>Manager Approval:</span>
                  <span style={{
                    ...styles.approvalBadge,
                    backgroundColor: order.validation.managerApprovalGiven ? '#e8f5e9' : '#fff3e0',
                    color: order.validation.managerApprovalGiven ? '#2e7d32' : '#e65100',
                  }}>
                    {order.validation.managerApprovalGiven ? 'Approved' : 'Required'}
                  </span>
                </div>
              )}

              {/* Warnings */}
              {order.validation.warnings?.length > 0 && (
                <div style={styles.validationBlock}>
                  <span style={styles.validationLabel}>Warnings:</span>
                  <ul style={styles.warningsList}>
                    {order.validation.warnings.map((warning, i) => (
                      <li key={i} style={styles.warningItem}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* PDF Extracted Data */}
              {order.validation.pdfExtractedData && (
                <div style={styles.validationBlock}>
                  <span style={styles.validationLabel}>PDF Extracted Data:</span>
                  <div style={styles.extractedDataGrid}>
                    <div style={styles.extractedItem}>
                      <span>Customer:</span>
                      <span>{order.validation.pdfExtractedData.customerName || '-'}</span>
                    </div>
                    <div style={styles.extractedItem}>
                      <span>Email:</span>
                      <span>{order.validation.pdfExtractedData.email || '-'}</span>
                    </div>
                    <div style={styles.extractedItem}>
                      <span>Subtotal:</span>
                      <span>${order.validation.pdfExtractedData.subtotal?.toLocaleString() || '-'}</span>
                    </div>
                    <div style={styles.extractedItem}>
                      <span>Deposit:</span>
                      <span>${order.validation.pdfExtractedData.deposit?.toLocaleString() || '-'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* INTERACTION HISTORY */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div style={styles.majorSection}>
            <h3 style={styles.majorSectionTitle}>INTERACTION HISTORY</h3>
            <OrderInteractionHistory order={order} changeOrders={changeOrders} />
          </div>

          {/* EDIT AUDIT TRAIL */}
          <div style={styles.majorSection}>
            <h3 style={styles.majorSectionTitle}>EDIT AUDIT TRAIL</h3>
            <OrderAuditTrail orderId={order.id || ''} />
          </div>
        </div>

        {/* Manager Approval Dialog */}
        {showManagerApproval && (
          <div style={styles.approvalDialog}>
            <h4 style={styles.approvalTitle}>
              {isManualPaymentType && order.payment?.status !== 'paid' && order.payment?.status !== 'manually_approved'
                ? 'Approve Payment'
                : 'Manager Approval Required'}
            </h4>
            {validationErrors.length > 0 && (
              <div style={styles.validationErrors}>
                {validationErrors.map((err, i) => (
                  <p key={i} style={styles.validationError}>{err}</p>
                ))}
              </div>
            )}
            {validationWarnings.length > 0 && (
              <div style={styles.validationWarnings}>
                <p style={styles.warningsTitle}>Warnings:</p>
                {validationWarnings.map((warn, i) => (
                  <p key={i} style={styles.validationWarning}>{warn}</p>
                ))}
              </div>
            )}

            {/* Payment Amount and Proof - Required for manual payment types */}
            {isManualPaymentType &&
             order.payment?.status !== 'paid' &&
             order.payment?.status !== 'manually_approved' && (
              <>
                {/* Payment Amount Field */}
                <div style={styles.amountSection}>
                  <label style={styles.proofLabel}>
                    Payment Amount *
                    <span style={styles.proofHint}>
                      (Enter the actual amount received)
                    </span>
                  </label>
                  <div style={styles.amountInputWrapper}>
                    <span style={styles.dollarSign}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder={order.pricing?.deposit?.toString() || '0.00'}
                      style={styles.amountInput}
                    />
                  </div>
                  <span style={styles.expectedAmount}>
                    Expected deposit: ${order.pricing?.deposit?.toLocaleString() || '0'}
                  </span>
                </div>

                {/* Proof File Upload */}
                <div style={styles.proofUploadSection}>
                  <label style={styles.proofLabel}>
                    Upload Proof of Payment *
                    <span style={styles.proofHint}>
                      (Check photo, wire confirmation, credit memo, etc.)
                    </span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleProofFileSelect}
                    style={styles.fileInput}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={styles.uploadButton}
                  >
                    {proofFile ? 'Change File' : 'Select File'}
                  </button>
                  {proofFile && (
                    <div style={styles.selectedFile}>
                      <span style={styles.fileName}>{proofFile.name}</span>
                      <span style={styles.fileSize}>
                        ({(proofFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  )}
                  {proofPreview && (
                    <div style={styles.proofPreview}>
                      <img
                        src={proofPreview}
                        alt="Proof preview"
                        style={styles.previewImage}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            <div style={styles.approvalForm}>
              <input
                type="password"
                value={managerCode}
                onChange={(e) => setManagerCode(e.target.value)}
                placeholder="Enter manager approval code"
                style={styles.approvalInput}
              />
              <div style={styles.approvalButtons}>
                <button
                  onClick={() => {
                    setShowManagerApproval(false);
                    setManagerCode('');
                    setProofFile(null);
                    setProofPreview(null);
                    setPaymentAmount('');
                    setError(null);
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  onClick={handleManagerApprovalSubmit}
                  disabled={sending || uploadingProof}
                  style={styles.approveButton}
                >
                  {uploadingProof ? 'Uploading...' : sending ? 'Sending...' : 'Approve & Send'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={styles.actions}>
          {/* Draft orders - show Delete and Send for Signature (unless needs manager approval for deposit) */}
          {order.status === 'draft' && !showManagerApproval && !order.needsManagerApproval && (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={styles.deleteButton}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
              <div style={styles.sendWithTestMode}>
                <label style={styles.testModeLabel}>
                  <input
                    type="checkbox"
                    checked={esignTestMode}
                    onChange={(e) => setEsignTestMode(e.target.checked)}
                    style={styles.testModeCheckbox}
                  />
                  <span style={styles.testModeText}>Test Mode</span>
                </label>
                <button
                  onClick={() => handleSendForSignature(false)}
                  disabled={sending}
                  style={esignTestMode ? styles.sendButtonTest : styles.sendButton}
                >
                  {sending ? 'Processing...' : esignTestMode ? '⚠️ Test Send' : 'Send for Signature'}
                </button>
              </div>
            </>
          )}
          {/* Draft orders needing manager approval (deposit discrepancy) */}
          {order.status === 'draft' && order.needsManagerApproval && !showManagerApproval && (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={styles.deleteButton}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => setShowManagerApproval(true)}
                style={styles.managerApprovalButton}
              >
                Manager Approve & Send
              </button>
            </>
          )}
          {/* Awaiting signature status */}
          {order.status === 'sent_for_signature' && (
            <>
              <span style={styles.waitingText}>Waiting for customer signature...</span>
              {order.isTestMode && (
                <button
                  onClick={handleTestSign}
                  disabled={sending}
                  style={styles.testSignButton}
                >
                  {sending ? 'Signing...' : '⚠️ Test Sign'}
                </button>
              )}
              {/* Change Order button */}
              {onNavigateToChangeOrder && (
                <button
                  onClick={() => onNavigateToChangeOrder(order.id || '')}
                  style={styles.changeOrderButton}
                >
                  + Change Order
                </button>
              )}
              {onCancelSignature && (
                <button
                  onClick={handleCancelSignature}
                  disabled={cancelling}
                  style={styles.cancelSignatureButton}
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Signature'}
                </button>
              )}
            </>
          )}
          {/* Signed status */}
          {order.status === 'signed' && !showManagerApproval && (
            <>
              {order.payment?.status === 'paid' || order.payment?.status === 'manually_approved' ? (
                <span style={styles.signedText}>Signed & Paid - Ready for manufacturer!</span>
              ) : (
                <span style={styles.waitingText}>Signed - Awaiting payment approval</span>
              )}
            </>
          )}
          {/* Ready for manufacturer */}
          {order.status === 'ready_for_manufacturer' && (
            <span style={styles.readyText}>Ready to send to manufacturer!</span>
          )}
          {/* Cancelled status */}
          {order.status === 'cancelled' && (
            <span style={{ fontSize: '14px', color: '#c62828', fontWeight: 500 }}>This order has been cancelled</span>
          )}
          {/* Approve Payment button - show anytime for manual payment types not yet approved */}
          {!showManagerApproval &&
           isManualPaymentType &&
           order.payment?.status !== 'paid' &&
           order.payment?.status !== 'manually_approved' &&
           order.status !== 'ready_for_manufacturer' &&
           order.status !== 'cancelled' && (
            <button
              onClick={() => setShowManagerApproval(true)}
              style={styles.paymentApprovalButton}
            >
              Approve Payment
            </button>
          )}
          {/* Cancel Order button - show for draft and sent_for_signature orders */}
          {onCancelOrder &&
           (order.status === 'draft' || order.status === 'pending_payment' || order.status === 'sent_for_signature') && (
            <button
              onClick={() => setShowCancelOrderModal(true)}
              style={styles.cancelOrderButton}
            >
              Cancel Order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Inline Audit Trail Component ---
function OrderAuditTrail({ orderId }: { orderId: string }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    getOrderAuditLog(orderId).then(data => {
      setEntries(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div style={{ padding: 12, color: '#666' }}>Loading audit trail...</div>;
  if (entries.length === 0) return <div style={{ padding: 12, color: '#999' }}>No audit entries yet.</div>;

  const formatTimestamp = (ts: any) => {
    if (!ts) return '-';
    try {
      const date = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return '-'; }
  };

  const actionLabels: Record<string, { label: string; color: string }> = {
    created: { label: 'Created', color: '#4caf50' },
    updated: { label: 'Edited', color: '#2196F3' },
    status_changed: { label: 'Status Changed', color: '#ff9800' },
    deleted: { label: 'Deleted', color: '#f44336' },
    sent_for_signature: { label: 'Sent for Signature', color: '#9c27b0' },
    signed: { label: 'Signed', color: '#4caf50' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((entry) => {
        const actionInfo = actionLabels[entry.action] || { label: entry.action, color: '#666' };
        return (
          <div key={entry.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
            <div style={{ minWidth: 150, color: '#999' }}>{formatTimestamp(entry.timestamp)}</div>
            <div style={{ minWidth: 100 }}>
              <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: actionInfo.color + '20', color: actionInfo.color, fontWeight: 600, fontSize: 11 }}>
                {actionInfo.label}
              </span>
            </div>
            <div style={{ flex: 1, color: '#666' }}>
              <span style={{ fontWeight: 500, color: '#333' }}>{entry.userEmail}</span>
              {entry.changes && entry.changes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {entry.changes.map((c: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: '#888' }}>
                      <strong>{c.field}</strong>: {typeof c.oldValue === 'object' ? JSON.stringify(c.oldValue) : String(c.oldValue ?? '-')} → {typeof c.newValue === 'object' ? JSON.stringify(c.newValue) : String(c.newValue ?? '-')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '800px',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #eee',
  },
  // Major Section Styles
  majorSection: {
    marginBottom: '32px',
    paddingBottom: '24px',
    borderBottom: '2px solid #e0e0e0',
  },
  majorSectionTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#1565c0',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginTop: 0,
    marginBottom: '16px',
    paddingBottom: '8px',
    borderBottom: '2px solid #1565c0',
  },
  majorSectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  changeOrderHeaderActions: {
    display: 'flex',
    gap: '8px',
  },
  pendingSignatureNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #90caf9',
  },
  changeOrdersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  noChangeOrders: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    fontSize: '14px',
  },
  // Tab styles for Original/CO/Current view
  viewTabsContainer: {
    marginBottom: '16px',
    overflowX: 'auto',
  },
  viewTabs: {
    display: 'inline-flex',
    gap: '4px',
    backgroundColor: '#f0f0f0',
    borderRadius: '6px',
    padding: '4px',
    minWidth: 'fit-content',
  },
  viewTab: {
    padding: '8px 14px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#666',
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  viewTabActive: {
    backgroundColor: '#1565c0',
    color: 'white',
  },
  originalViewBanner: {
    padding: '10px 16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
    marginBottom: '16px',
    fontSize: '13px',
    color: '#666',
    border: '1px solid #e0e0e0',
  },
  coViewBanner: {
    padding: '10px 16px',
    backgroundColor: '#fff3e0',
    borderRadius: '6px',
    marginBottom: '16px',
    fontSize: '13px',
    color: '#e65100',
    border: '1px solid #ffcc80',
  },
  coViewDate: {
    marginLeft: '12px',
    fontSize: '12px',
    color: '#999',
    fontWeight: 400,
  },
  currentViewBanner: {
    padding: '10px 16px',
    backgroundColor: '#e8f5e9',
    borderRadius: '6px',
    marginBottom: '16px',
    fontSize: '13px',
    color: '#2e7d32',
    fontWeight: 500,
    border: '1px solid #a5d6a7',
  },
  changedValue: {
    backgroundColor: '#e8f5e9',
    padding: '2px 6px',
    borderRadius: '4px',
    position: 'relative',
  },
  changedBadge: {
    marginLeft: '8px',
    fontSize: '10px',
    fontWeight: 600,
    color: '#2e7d32',
    backgroundColor: '#c8e6c9',
    padding: '2px 6px',
    borderRadius: '8px',
    textTransform: 'uppercase',
  },
  changedPriceRow: {
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    marginLeft: '-8px',
    marginRight: '-8px',
    paddingLeft: '8px',
    paddingRight: '8px',
  },
  priceDiff: {
    marginLeft: '8px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#2e7d32',
  },
  orderNumber: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#2196F3',
    marginRight: '12px',
  },
  status: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: '12px',
  },
  testModeBadge: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: '4px',
    backgroundColor: '#ff9800',
    color: 'white',
    marginLeft: '8px',
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '28px',
    color: '#666',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1,
  },
  error: {
    margin: '0 24px',
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2196F3',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  fieldFull: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  label: {
    fontSize: '12px',
    color: '#666',
  },
  value: {
    fontSize: '14px',
    color: '#333',
  },
  priceGrid: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '16px',
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    fontSize: '14px',
    color: '#666',
  },
  totalRow: {
    fontWeight: 600,
    fontSize: '16px',
    color: '#333',
    borderTop: '1px solid #ddd',
    marginTop: '8px',
    paddingTop: '12px',
  },
  fluffRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0 0 0',
    fontSize: '13px',
    color: '#ff9800',
    fontWeight: 500,
    fontStyle: 'italic',
    borderTop: '1px dashed #ddd',
    marginTop: '8px',
  },
  orderTotalRow: {
    fontWeight: 700,
    fontSize: '16px',
    color: '#1565c0',
    backgroundColor: '#e3f2fd',
    margin: '8px -12px',
    padding: '12px',
    borderRadius: '4px',
  },
  priceDivider: {
    height: '1px',
    backgroundColor: '#ddd',
    margin: '8px 0',
  },
  filesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fileGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fileLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: 500,
  },
  fileLink: {
    fontSize: '14px',
    color: '#2196F3',
    textDecoration: 'none',
  },
  approvalDialog: {
    backgroundColor: '#fff3e0',
    border: '1px solid #ff9800',
    borderRadius: '8px',
    padding: '20px',
    margin: '0 24px 16px 24px',
  },
  approvalTitle: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#e65100',
  },
  validationErrors: {
    marginBottom: '12px',
  },
  validationError: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    color: '#c62828',
    backgroundColor: '#ffebee',
    padding: '8px 12px',
    borderRadius: '4px',
  },
  validationWarnings: {
    marginBottom: '12px',
  },
  warningsTitle: {
    margin: '0 0 6px 0',
    fontSize: '13px',
    fontWeight: 500,
    color: '#e65100',
  },
  validationWarning: {
    margin: '0 0 4px 0',
    fontSize: '13px',
    color: '#f57c00',
  },
  approvalForm: {
    marginTop: '16px',
  },
  approvalInput: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    marginBottom: '12px',
    boxSizing: 'border-box',
  },
  approvalButtons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  approveButton: {
    padding: '10px 20px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  validationBlock: {
    marginBottom: '16px',
  },
  validationLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#666',
    display: 'block',
    marginBottom: '6px',
  },
  depositCheckResult: {
    padding: '8px 12px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 500,
  },
  approvalBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  warningsList: {
    margin: 0,
    paddingLeft: '20px',
  },
  warningItem: {
    fontSize: '13px',
    color: '#f57c00',
    marginBottom: '4px',
  },
  extractedDataGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    backgroundColor: '#f5f5f5',
    padding: '12px',
    borderRadius: '4px',
  },
  extractedItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  managerApprovalButton: {
    padding: '12px 24px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '1px solid #eee',
    backgroundColor: '#f9f9f9',
  },
  deleteButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#dc3545',
    border: '1px solid #dc3545',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sendButton: {
    padding: '12px 24px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sendButtonTest: {
    padding: '12px 24px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
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
    gap: '4px',
    cursor: 'pointer',
  },
  testModeCheckbox: {
    width: '14px',
    height: '14px',
    cursor: 'pointer',
  },
  testModeText: {
    fontSize: '12px',
    color: '#e65100',
    fontWeight: 500,
  },
  testSignButton: {
    padding: '10px 20px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
    marginRight: '12px',
  },
  changeOrderButton: {
    padding: '10px 20px',
    backgroundColor: '#7b1fa2',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
    marginRight: '12px',
  },
  cancelSignatureButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#f57c00',
    border: '1px solid #f57c00',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  waitingText: {
    fontSize: '14px',
    color: '#1565c0',
    fontStyle: 'italic',
  },
  signedText: {
    fontSize: '14px',
    color: '#2e7d32',
    fontWeight: 500,
  },
  orderFormSection: {
    marginBottom: '24px',
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #90caf9',
  },
  orderFormCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: '6px',
    padding: '12px 16px',
  },
  orderFormInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  orderFormName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  orderFormSize: {
    fontSize: '12px',
    color: '#666',
  },
  orderFormActions: {
    display: 'flex',
    gap: '8px',
  },
  viewButton: {
    padding: '8px 16px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 500,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  downloadButton: {
    padding: '8px 16px',
    backgroundColor: 'white',
    color: '#2196F3',
    border: '1px solid #2196F3',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 500,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  paymentStatusBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-block',
  },
  stripeVerification: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
  },
  verificationTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    display: 'block',
    marginBottom: '8px',
  },
  verificationGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  },
  verificationItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  verificationError: {
    marginTop: '8px',
    padding: '8px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '12px',
  },
  manualApprovalInfo: {
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  approvedLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#2e7d32',
  },
  approvedBy: {
    fontSize: '12px',
    color: '#666',
  },
  paymentApprovalButton: {
    padding: '12px 24px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  readyText: {
    fontSize: '14px',
    color: '#2e7d32',
    fontWeight: 600,
  },
  amountSection: {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
  },
  amountInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
    backgroundColor: 'white',
    marginBottom: '4px',
  },
  dollarSign: {
    padding: '10px 12px',
    backgroundColor: '#f5f5f5',
    color: '#666',
    borderRight: '1px solid #ddd',
    fontWeight: 500,
  },
  amountInput: {
    flex: 1,
    padding: '10px 12px',
    border: 'none',
    fontSize: '16px',
    fontFamily: 'monospace',
    outline: 'none',
  },
  expectedAmount: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  proofUploadSection: {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
    border: '2px dashed #ccc',
  },
  proofLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '8px',
  },
  proofHint: {
    display: 'block',
    fontSize: '12px',
    color: '#666',
    fontWeight: 400,
  },
  fileInput: {
    display: 'none',
  },
  uploadButton: {
    padding: '10px 20px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  selectedFile: {
    marginTop: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fileName: {
    fontSize: '14px',
    color: '#333',
  },
  fileSize: {
    fontSize: '12px',
    color: '#666',
  },
  proofPreview: {
    marginTop: '12px',
    maxWidth: '200px',
  },
  previewImage: {
    width: '100%',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  viewProofLink: {
    marginLeft: '12px',
    fontSize: '13px',
    color: '#1565c0',
    textDecoration: 'none',
    fontWeight: 500,
  },
  proofFileSection: {
    marginTop: '12px',
  },
  proofFileLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#666',
    display: 'block',
    marginBottom: '8px',
  },
  proofFileCard: {
    padding: '8px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
    border: '1px solid #eee',
  },
  proofThumbnail: {
    maxWidth: '150px',
    maxHeight: '150px',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  proofFileLink: {
    fontSize: '14px',
    color: '#1565c0',
    textDecoration: 'none',
  },
  // Change orders styles
  changeOrdersSection: {
    marginBottom: '24px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #eee',
  },
  changeOrdersHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  createChangeOrderButton: {
    padding: '8px 16px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  editChangeOrderButton: {
    padding: '8px 16px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  awaitingSignatureBadge: {
    padding: '8px 16px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 500,
  },
  pendingChangeOrderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  testSignChangeOrderButton: {
    padding: '8px 12px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  pricingSummary: {
    backgroundColor: 'white',
    borderRadius: '6px',
    padding: '12px 16px',
    marginBottom: '16px',
    border: '1px solid #e0e0e0',
  },
  pricingSummaryRow: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr 1fr 1fr',
    gap: '12px',
    padding: '6px 0',
    alignItems: 'center',
  },
  pricingSummaryLabel: {
    fontSize: '13px',
    color: '#666',
    fontWeight: 500,
  },
  pricingSummaryHeader: {
    fontSize: '11px',
    color: '#999',
    textTransform: 'uppercase',
    fontWeight: 600,
    textAlign: 'right',
  },
  pricingSummaryValue: {
    fontSize: '14px',
    color: '#333',
    textAlign: 'right',
  },
  pricingSummaryDiff: {
    fontSize: '14px',
    fontWeight: 600,
    textAlign: 'right',
  },
  depositToCollect: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #eee',
    fontSize: '14px',
    color: '#333',
  },
  loadingChangeOrders: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  changeOrdersError: {
    padding: '16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '8px',
    fontSize: '14px',
  },
  // Cancelled order styles
  cancelledBanner: {
    margin: '0 24px',
    padding: '16px',
    backgroundColor: '#ffebee',
    borderRadius: '8px',
    border: '1px solid #ef9a9a',
  },
  cancelledBannerTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#c62828',
    marginBottom: '8px',
  },
  cancelledBannerReason: {
    fontSize: '14px',
    color: '#c62828',
    marginBottom: '6px',
  },
  cancelledBannerMeta: {
    fontSize: '12px',
    color: '#e57373',
  },
  cancelOrderButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#c62828',
    border: '1px solid #c62828',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  cancelOrderHeaderButton: {
    marginLeft: '12px',
    padding: '4px 12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    border: '1px solid #ef9a9a',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  cancelOrderModal: {
    backgroundColor: '#ffebee',
    border: '1px solid #ef9a9a',
    borderRadius: '8px',
    padding: '20px',
    margin: '0 24px 16px 24px',
  },
  cancelOrderModalTitle: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#c62828',
  },
  cancelOrderModalText: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#b71c1c',
  },
  cancelOrderTextarea: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ef9a9a',
    borderRadius: '4px',
    fontSize: '14px',
    marginBottom: '12px',
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    fontFamily: 'inherit',
  },
  cancelOrderModalButtons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  confirmCancelButton: {
    padding: '10px 20px',
    backgroundColor: '#c62828',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};
