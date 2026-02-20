import React, { useState, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import {
  OrderLedgerSummary,
  PaymentLedgerEntry,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_COLORS,
  BALANCE_STATUS_LABELS,
  BALANCE_STATUS_COLORS,
  PAYMENT_METHOD_LABELS,
  formatCurrency,
} from '../../types/payment';
import { Order } from '../../types/order';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { getLedgerEntriesForOrder, EnrichedLedgerEntry } from '../../services/paymentService';
import { getChangeOrdersForOrder } from '../../services/changeOrderService';
import { ChangeOrder } from '../../types/changeOrder';
import AllPaymentsTab from './AllPaymentsTab';
import PaymentDetailModal from './PaymentDetailModal';
import { useAuth } from '../../contexts/AuthContext';

// Tab types
type TabType = 'dashboard' | 'all-payments' | 'reconciliation' | 'approvals' | 'ledger-viewer';

// Reconciliation entry from API
interface ReconciliationEntry {
  orderId: string;
  orderNumber: string;
  entryId: string;
  entryType: 'payment' | 'refund';
  ledgerAmount: number;
  stripePaymentId?: string;
  stripeAmount?: number;
  stripeStatus?: string;
  status: 'matched' | 'mismatch' | 'missing_stripe' | 'missing_ledger';
  discrepancyAmount?: number;
  details?: string;
}

interface ReconciliationResult {
  totalOrders: number;
  totalEntries: number;
  matched: number;
  mismatched: number;
  missingStripe: number;
  missingLedger: number;
  totalDiscrepancy: number;
  entries: ReconciliationEntry[];
}

// Order with balance issue
interface OrderWithIssue {
  id: string;
  orderNumber: string;
  customerName: string;
  ledgerSummary: OrderLedgerSummary;
  status: string;
  orderTotal: number;  // Subtotal + Extra/Fluff
  subtotal: number;
  extraFluff: number;
  orderFormPdfUrl?: string;
  depositPercent: number;  // deposit / subtotal * 100
  // Change order info from order document
  hasChangeOrders: boolean;
  changeOrderCount: number;
  activeChangeOrderId?: string;
  activeChangeOrderStatus?: string;
  // Pending payment info
  hasPendingPayment?: boolean;
  pendingPaymentAmount?: number;
  pendingPaymentMethod?: string;
}

export function ManagerPayments() {
  const { user, userRole, isManager } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dashboard state
  const [ordersWithIssues, setOrdersWithIssues] = useState<OrderWithIssue[]>([]);
  const [allOrders, setAllOrders] = useState<OrderWithIssue[]>([]);
  const [dashboardStats, setDashboardStats] = useState({
    totalOrders: 0,
    paidCorrectly: 0,
    underpaid: 0,
    overpaid: 0,
    pending: 0,
    totalBalance: 0,
    totalOverpaid: 0,
  });

  // Reconciliation state
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null);
  const [reconciling, setReconciling] = useState(false);

  // Ledger viewer state
  const [selectedOrderNumber, setSelectedOrderNumber] = useState('');
  const [ledgerEntries, setLedgerEntries] = useState<PaymentLedgerEntry[]>([]);
  const [viewerLoading, setViewerLoading] = useState(false);

  // Expanded orders in dashboard (to show transactions and change orders)
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [orderTransactions, setOrderTransactions] = useState<Record<string, PaymentLedgerEntry[]>>({});
  const [orderChangeOrders, setOrderChangeOrders] = useState<Record<string, ChangeOrder[]>>({});

  // Transaction modal state
  const [transactionModal, setTransactionModal] = useState<{
    open: boolean;
    type: 'payment' | 'refund';
    orderNumber: string;
    orderId: string;
  } | null>(null);
  const [transactionForm, setTransactionForm] = useState({
    amount: '',
    method: 'stripe',
    description: '',
    notes: '',
  });
  const [submittingTransaction, setSubmittingTransaction] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  // Payment detail modal state (for All Payments tab)
  const [selectedPayment, setSelectedPayment] = useState<EnrichedLedgerEntry | null>(null);

  // Approval modal state
  const [approvalModal, setApprovalModal] = useState<{
    entry?: EnrichedLedgerEntry;
    orderId?: string;
    orderNumber?: string;
    amount?: number;
    method?: string;
    isLegacy?: boolean;
  } | null>(null);
  const [approvalCode, setApprovalCode] = useState('');
  const [approvingPayment, setApprovingPayment] = useState(false);
  const [approvalForm, setApprovalForm] = useState({
    method: '',
    notes: '',
  });
  const [approvalProofFile, setApprovalProofFile] = useState<File | null>(null);
  const [approvalProofPreview, setApprovalProofPreview] = useState<string | null>(null);

  // Load dashboard data on mount
  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Query orders that have ledgerSummary
      const ordersRef = collection(db, 'orders');
      const ordersSnap = await getDocs(ordersRef);

      const issues: OrderWithIssue[] = [];
      const all: OrderWithIssue[] = [];
      let paidCorrectly = 0;
      let underpaid = 0;
      let overpaid = 0;
      let pending = 0;
      let totalBalance = 0;
      let totalOverpaid = 0;

      ordersSnap.docs.forEach((doc) => {
        const order = doc.data() as Order;
        const summary = order.ledgerSummary;

        // Build order data for all orders list
        const subtotal = order.pricing?.subtotalBeforeTax || 0;
        const deposit = order.pricing?.deposit || 0;
        const depositPercent = subtotal > 0 ? (deposit / subtotal) * 100 : 0;

        // Check for pending legacy payment (stored in order.payment)
        const hasPendingLegacyPayment = order.payment?.status === 'pending';
        const pendingLedgerAmount = summary?.pendingReceived || 0;
        const hasPendingPayment = hasPendingLegacyPayment || pendingLedgerAmount > 0;

        // For orders with pending legacy payments but no ledger summary,
        // create a summary that shows the correct deposit required and balance
        let effectiveSummary = summary;
        if (!summary && hasPendingLegacyPayment && deposit > 0) {
          effectiveSummary = {
            depositRequired: deposit,
            originalDeposit: deposit,
            depositAdjustments: 0,
            totalReceived: 0,
            totalRefunded: 0,
            netReceived: 0,
            balance: deposit, // Balance equals deposit since nothing is received yet
            balanceStatus: 'underpaid' as const,
            pendingReceived: deposit, // The pending payment amount
            pendingRefunds: 0,
            entryCount: 0,
            calculatedAt: null as any,
          };
        }

        const orderData: OrderWithIssue = {
          id: doc.id,
          orderNumber: order.orderNumber,
          customerName: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
          ledgerSummary: effectiveSummary || {
            depositRequired: deposit,
            originalDeposit: deposit,
            depositAdjustments: 0,
            totalReceived: 0,
            totalRefunded: 0,
            netReceived: 0,
            balance: deposit,
            balanceStatus: deposit > 0 ? 'underpaid' as const : 'pending' as const,
            pendingReceived: 0,
            pendingRefunds: 0,
            entryCount: 0,
            calculatedAt: null as any,
          },
          status: order.status,
          subtotal,
          extraFluff: order.pricing?.extraMoneyFluff || 0,
          orderTotal: subtotal + (order.pricing?.extraMoneyFluff || 0),
          orderFormPdfUrl: order.files?.orderFormPdf?.downloadUrl,
          depositPercent,
          // Change order info
          hasChangeOrders: order.hasChangeOrders || false,
          changeOrderCount: order.changeOrderCount || 0,
          activeChangeOrderId: order.activeChangeOrderId,
          activeChangeOrderStatus: order.activeChangeOrderStatus,
          // Pending payment info
          hasPendingPayment,
          pendingPaymentAmount: hasPendingLegacyPayment ? deposit : pendingLedgerAmount,
          pendingPaymentMethod: hasPendingLegacyPayment ? order.payment?.type : undefined,
        };

        all.push(orderData);

        // Include orders with pending legacy payments in issues
        if (hasPendingLegacyPayment && !summary) {
          underpaid++;
          totalBalance += deposit;
          issues.push(orderData);
        } else if (summary) {
          // Check if order has a pending_signature change order
          // If so, balance might be different from stored summary
          const hasPendingSigCO = order.activeChangeOrderStatus === 'pending_signature';

          // Count by status
          switch (summary.balanceStatus) {
            case 'paid':
              if (hasPendingSigCO) {
                // Order might actually owe money due to CO - include in issues for review
                issues.push(orderData);
              } else {
                paidCorrectly++;
              }
              break;
            case 'underpaid':
              underpaid++;
              totalBalance += summary.balance;
              issues.push(orderData);
              break;
            case 'overpaid':
              overpaid++;
              totalOverpaid += Math.abs(summary.balance);
              issues.push(orderData);
              break;
            case 'pending':
              if (hasPendingSigCO) {
                // Include pending orders with COs for review
                issues.push(orderData);
              } else {
                pending++;
              }
              break;
          }
        }
      });

      // Sort issues by absolute balance (largest first)
      issues.sort((a, b) => Math.abs(b.ledgerSummary.balance) - Math.abs(a.ledgerSummary.balance));

      // Sort all orders by order number (newest first)
      all.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber));

      setOrdersWithIssues(issues);
      setAllOrders(all);
      setDashboardStats({
        totalOrders: ordersSnap.size,
        paidCorrectly,
        underpaid,
        overpaid,
        pending,
        totalBalance,
        totalOverpaid,
      });

      // Pre-load change orders for orders with pending_signature COs
      // This ensures we can calculate effective values immediately
      const ordersWithPendingCOs = all.filter(o => o.activeChangeOrderStatus === 'pending_signature');
      if (ordersWithPendingCOs.length > 0) {
        const coPromises = ordersWithPendingCOs.map(async (order) => {
          try {
            const cos = await getChangeOrdersForOrder(order.id);
            return { orderId: order.id, changeOrders: cos };
          } catch (err) {
            console.error(`Failed to load COs for ${order.orderNumber}:`, err);
            return { orderId: order.id, changeOrders: [] };
          }
        });

        const coResults = await Promise.all(coPromises);
        const newChangeOrders: Record<string, ChangeOrder[]> = {};
        coResults.forEach(result => {
          newChangeOrders[result.orderId] = result.changeOrders;
        });
        setOrderChangeOrders(prev => ({ ...prev, ...newChangeOrders }));

        // Re-filter issues list based on effective balance now that we have CO data
        const updatedIssues = issues.filter(order => {
          const cos = newChangeOrders[order.id] || [];
          const liveCO = cos.find(co => co.status === 'pending_signature');

          if (liveCO) {
            // Calculate effective balance with the live CO
            const effectiveDeposit = liveCO.newValues.deposit;
            const effectiveBalance = effectiveDeposit - order.ledgerSummary.netReceived;
            // Only keep in issues if balance is not zero
            return effectiveBalance !== 0;
          }

          // No live CO - keep original logic (already in issues for a reason)
          return true;
        });

        setOrdersWithIssues(updatedIssues);
      }
    } catch (err: any) {
      console.error('Error loading dashboard:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const runReconciliation = async () => {
    setReconciling(true);
    setError(null);

    try {
      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || '';
      const response = await fetch(
        `${functionsUrl}/reconcileLedgerWithStripe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Reconciliation failed');
      }

      setReconciliationResult(data.result);
    } catch (err: any) {
      console.error('Reconciliation error:', err);
      setError(err.message || 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const loadLedgerEntries = async () => {
    if (!selectedOrderNumber.trim()) {
      setError('Please enter an order number');
      return;
    }

    setViewerLoading(true);
    setError(null);

    try {
      // First find the order by order number
      const ordersQuery = query(
        collection(db, 'orders'),
        where('orderNumber', '==', selectedOrderNumber.trim().toUpperCase()),
        limit(1)
      );
      const ordersSnap = await getDocs(ordersQuery);

      if (ordersSnap.empty) {
        throw new Error(`Order ${selectedOrderNumber} not found`);
      }

      const orderId = ordersSnap.docs[0].id;

      // Now get ledger entries
      const ledgerQuery = query(
        collection(db, 'payment_ledger'),
        where('orderId', '==', orderId),
        orderBy('createdAt', 'desc')
      );
      const ledgerSnap = await getDocs(ledgerQuery);

      const entries = ledgerSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as PaymentLedgerEntry[];

      setLedgerEntries(entries);
    } catch (err: any) {
      console.error('Error loading ledger entries:', err);
      setError(err.message || 'Failed to load ledger entries');
      setLedgerEntries([]);
    } finally {
      setViewerLoading(false);
    }
  };

  // Toggle order expansion to show/hide transactions and change orders
  const toggleOrderExpansion = async (orderId: string) => {
    const newExpanded = new Set(expandedOrders);

    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId);
    } else {
      newExpanded.add(orderId);

      // Load transactions if not already loaded
      if (!orderTransactions[orderId]) {
        try {
          const entries = await getLedgerEntriesForOrder(orderId);
          // Sort newest first
          entries.sort((a, b) => {
            const aTime = a.createdAt?.seconds || 0;
            const bTime = b.createdAt?.seconds || 0;
            return bTime - aTime;
          });
          setOrderTransactions((prev) => ({
            ...prev,
            [orderId]: entries,
          }));
        } catch (err) {
          console.error('Failed to load transactions:', err);
        }
      }

      // Load change orders if not already loaded
      if (!orderChangeOrders[orderId]) {
        try {
          const changeOrders = await getChangeOrdersForOrder(orderId);
          setOrderChangeOrders((prev) => ({
            ...prev,
            [orderId]: changeOrders,
          }));
        } catch (err) {
          console.error('Failed to load change orders:', err);
        }
      }
    }

    setExpandedOrders(newExpanded);
  };

  const recalculateSummary = async (orderId: string) => {
    try {
      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || '';
      const response = await fetch(
        `${functionsUrl}/recalculateLedgerSummary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Recalculation failed');
      }

      // Refresh dashboard
      await loadDashboardData();
      alert('Ledger summary recalculated successfully');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Open approval modal for a payment entry
  const openApprovalModal = (entry: EnrichedLedgerEntry) => {
    setApprovalModal({
      entry,
      orderId: entry.orderId,
      orderNumber: entry.orderNumber,
      amount: entry.amount,
      method: entry.method,
      isLegacy: false,
    });
    setApprovalCode('');
    setApprovalForm({ method: entry.method || '', notes: '' });
    setApprovalProofFile(null);
    setApprovalProofPreview(null);
  };

  // Open approval modal for a legacy order payment
  const openLegacyApprovalModal = (orderId: string, orderNumber: string, amount: number, method: string) => {
    setApprovalModal({
      orderId,
      orderNumber,
      amount,
      method,
      isLegacy: true,
    });
    setApprovalCode('');
    setApprovalForm({ method: method || '', notes: '' });
    setApprovalProofFile(null);
    setApprovalProofPreview(null);
  };

  // Handle payment approval
  const handleApprovePayment = async () => {
    if (!approvalModal) return;
    if (!isManager && !approvalCode) return;

    // Require proof for check/wire
    if ((approvalForm.method === 'check' || approvalForm.method === 'wire') && !approvalProofFile && !approvalModal.entry?.proofFile) {
      alert('Proof of payment is required for check/wire payments');
      return;
    }

    setApprovingPayment(true);
    setError(null);

    try {
      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || '';

      // Upload proof file if provided
      let proofFileUrl: string | undefined;
      if (approvalProofFile) {
        const orderId = approvalModal.orderId || approvalModal.entry?.orderId;
        const storageRef = ref(storage, `payment-proofs/${orderId}/${Date.now()}_${approvalProofFile.name}`);
        await uploadBytes(storageRef, approvalProofFile);
        proofFileUrl = await getDownloadURL(storageRef);
      }

      let response;
      if (approvalModal.isLegacy) {
        // Approve legacy payment stored in order.payment
        response = await fetch(`${functionsUrl}/approveLegacyPayment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: approvalModal.orderId,
            orderNumber: approvalModal.orderNumber,
            approvalCode: isManager ? undefined : approvalCode,
            approvedBy: user?.email || 'Manager',
            approvedByEmail: user?.email,
            approvedByRole: userRole,
            amount: approvalModal.amount,
            method: approvalForm.method || approvalModal.method,
            proofFile: proofFileUrl,
            notes: approvalForm.notes || undefined,
          }),
        });
      } else if (approvalModal.entry) {
        // Approve ledger entry
        response = await fetch(`${functionsUrl}/approveLedgerEntry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryId: approvalModal.entry.id,
            approvalCode: isManager ? undefined : approvalCode,
            approvedBy: user?.email || 'Manager',
            approvedByEmail: user?.email,
            approvedByRole: userRole,
            method: approvalForm.method || undefined,
            proofFile: proofFileUrl,
            notes: approvalForm.notes || undefined,
          }),
        });
      } else {
        throw new Error('Invalid approval state');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Approval failed');
      }

      // Close modal and refresh
      setApprovalModal(null);
      setApprovalCode('');
      setApprovalForm({ method: '', notes: '' });
      setApprovalProofFile(null);
      setApprovalProofPreview(null);
      await loadDashboardData();
      alert('Payment approved successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to approve payment');
      alert(`Error: ${err.message}`);
    } finally {
      setApprovingPayment(false);
    }
  };

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '-';
    try {
      let date: Date;
      if (timestamp.toDate) {
        // Firebase Timestamp object with toDate method
        date = timestamp.toDate();
      } else if (timestamp.seconds) {
        // Plain object with seconds (from Firestore)
        date = new Date(timestamp.seconds * 1000);
      } else if (timestamp._seconds) {
        // Plain object with _seconds (serialized Firestore timestamp)
        date = new Date(timestamp._seconds * 1000);
      } else if (typeof timestamp === 'string') {
        // ISO string or other string format
        date = new Date(timestamp);
      } else if (typeof timestamp === 'number') {
        // Unix timestamp in milliseconds
        date = new Date(timestamp);
      } else {
        return '-';
      }

      // Check for invalid date
      if (isNaN(date.getTime())) {
        return '-';
      }

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const openTransactionModal = (type: 'payment' | 'refund', orderNumber: string, orderId: string, prefilledAmount?: number) => {
    console.log('Opening transaction modal:', { type, orderNumber, orderId, prefilledAmount });
    setTransactionModal({ open: true, type, orderNumber, orderId });
    setTransactionForm({
      amount: prefilledAmount ? prefilledAmount.toString() : '',
      method: 'stripe',
      description: prefilledAmount ? `Balance ${type === 'payment' ? 'collection' : 'refund'}` : '',
      notes: '',
    });
    setProofFile(null);
    setProofPreview(null);
  };

  const closeTransactionModal = () => {
    setTransactionModal(null);
    setTransactionForm({ amount: '', method: 'stripe', description: '', notes: '' });
    setProofFile(null);
    setProofPreview(null);
  };

  const submitTransaction = async () => {
    console.log('submitTransaction called, transactionModal:', transactionModal);
    console.log('transactionForm:', transactionForm);

    if (!transactionModal) {
      console.log('No transactionModal, returning early');
      return;
    }

    const amount = parseFloat(transactionForm.amount);
    console.log('Parsed amount:', amount);

    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Validation for specific payment methods
    if (transactionForm.method === 'check' && !proofFile) {
      alert('Please upload a picture of the check');
      return;
    }

    if (transactionForm.method === 'wire' && !proofFile) {
      alert('Please upload a picture of the wire transfer');
      return;
    }

    if (transactionForm.method === 'other' && !transactionForm.notes?.trim()) {
      alert('Please enter a note explaining this payment method');
      return;
    }

    setSubmittingTransaction(true);
    try {
      // Upload proof file if provided
      let proofFileData: { name: string; storagePath: string; downloadUrl: string; size: number; type: string } | undefined;
      if (proofFile) {
        const timestamp = Date.now();
        const sanitizedName = proofFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `orders/${transactionModal.orderNumber}/payment-proofs/${timestamp}_${sanitizedName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, proofFile);
        const downloadUrl = await getDownloadURL(storageRef);
        proofFileData = {
          name: proofFile.name,
          storagePath,
          downloadUrl,
          size: proofFile.size,
          type: proofFile.type,
        };
      }

      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || '';
      const requestUrl = `${functionsUrl}/addLedgerEntry`;
      const requestBody = {
        orderId: transactionModal.orderId,  // Use orderId to avoid duplicate orderNumber issues
        orderNumber: transactionModal.orderNumber,
        transactionType: transactionModal.type,
        amount,
        method: transactionForm.method,
        category: transactionModal.type === 'payment' ? 'additional_payment' : 'refund',
        status: 'approved', // Manager-added transactions are pre-approved
        description: transactionForm.description || `Manual ${transactionModal.type} from manager dashboard`,
        notes: transactionForm.notes || undefined,
        proofFile: proofFileData,
        createdBy: 'manager',
      };

      console.log('Making API request to:', requestUrl);
      console.log('Request body:', requestBody);

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);

      if (!data.success) {
        throw new Error(data.error || 'Failed to add transaction');
      }

      alert(`${transactionModal.type === 'payment' ? 'Payment' : 'Refund'} added successfully! (${data.paymentNumber})`);

      const orderId = transactionModal.orderId;
      closeTransactionModal();

      // Collapse the order row to force UI refresh
      setExpandedOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });

      // Small delay to ensure Firestore has propagated the update
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh dashboard first (gets updated order with new ledgerSummary)
      await loadDashboardData();

      // Refresh transactions for this order
      const entries = await getLedgerEntriesForOrder(orderId);
      entries.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
      setOrderTransactions((prev) => ({
        ...prev,
        [orderId]: entries,
      }));

      // Re-expand the order to show updated transactions
      setExpandedOrders(prev => {
        const newSet = new Set(prev);
        newSet.add(orderId);
        return newSet;
      });
    } catch (err: any) {
      console.error('Transaction error:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setSubmittingTransaction(false);
    }
  };

  const renderDashboard = () => (
    <div>
      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <div style={{ ...styles.statCard, borderLeftColor: '#2196F3' }}>
          <div style={styles.statValue}>{dashboardStats.totalOrders}</div>
          <div style={styles.statLabel}>Total Orders</div>
        </div>
        <div style={{ ...styles.statCard, borderLeftColor: '#4caf50' }}>
          <div style={styles.statValue}>{dashboardStats.paidCorrectly}</div>
          <div style={styles.statLabel}>Paid Correctly</div>
        </div>
        <div style={{ ...styles.statCard, borderLeftColor: '#ff9800' }}>
          <div style={styles.statValue}>{dashboardStats.underpaid}</div>
          <div style={styles.statLabel}>Underpaid</div>
          <div style={styles.statSubtext}>{formatCurrency(dashboardStats.totalBalance)} owed</div>
        </div>
        <div style={{ ...styles.statCard, borderLeftColor: '#2196F3' }}>
          <div style={styles.statValue}>{dashboardStats.overpaid}</div>
          <div style={styles.statLabel}>Overpaid</div>
          <div style={styles.statSubtext}>{formatCurrency(dashboardStats.totalOverpaid)} to refund</div>
        </div>
        <div style={{ ...styles.statCard, borderLeftColor: '#9e9e9e' }}>
          <div style={styles.statValue}>{dashboardStats.pending}</div>
          <div style={styles.statLabel}>Pending</div>
        </div>
      </div>

      {/* Orders with Issues */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Orders Requiring Attention</h3>
          <button onClick={loadDashboardData} style={styles.refreshButton}>
            Refresh
          </button>
        </div>

        {ordersWithIssues.length === 0 ? (
          <div style={styles.emptyState}>No orders with balance issues found.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}></th>
                <th style={styles.th}>Order</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Order Total</th>
                <th style={styles.th}>Deposit Req'd</th>
                <th style={styles.th}>Received</th>
                <th style={styles.th}>Balance</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ordersWithIssues.map((order) => {
                const isExpanded = expandedOrders.has(order.id);
                const transactions = orderTransactions[order.id] || [];
                const changeOrders = orderChangeOrders[order.id] || [];

                // Check for change orders - pending_signature is LIVE (supersedes original)
                const liveCO = changeOrders.find(co => co.status === 'pending_signature');
                const draftCOs = changeOrders.filter(co => co.status === 'draft');
                const hasDraftCO = draftCOs.length > 0;

                // If there's a live CO (pending_signature), use its values as the real values
                const effectiveDeposit = liveCO
                  ? liveCO.newValues.deposit
                  : order.ledgerSummary.depositRequired;
                const effectiveOrderTotal = liveCO
                  ? liveCO.newValues.subtotalBeforeTax + (liveCO.newValues.extraMoneyFluff || 0)
                  : order.orderTotal;
                const effectiveBalance = effectiveDeposit - order.ledgerSummary.netReceived;

                // Determine effective status based on effective balance
                const effectiveStatus = effectiveBalance === 0 ? 'paid'
                  : effectiveBalance > 0 ? 'underpaid'
                  : 'overpaid';
                const effectiveStatusColors = BALANCE_STATUS_COLORS[effectiveStatus];

                return (
                  <React.Fragment key={order.id}>
                    <tr>
                      <td style={styles.td}>
                        <button
                          onClick={() => toggleOrderExpansion(order.id)}
                          style={styles.expandButton}
                          title={isExpanded ? 'Hide transactions' : 'Show transactions'}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      </td>
                      <td style={styles.td}>
                        <a
                          href={`/?order=${order.orderNumber}`}
                          style={styles.orderNumberLink}
                          title="Open order details"
                        >
                          {order.orderNumber}
                        </a>
                      </td>
                      <td style={styles.td}>{order.customerName || '-'}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.statusBadge,
                            backgroundColor: effectiveStatusColors.bg,
                            color: effectiveStatusColors.color,
                          }}
                        >
                          {BALANCE_STATUS_LABELS[effectiveStatus]}
                        </span>
                        {/* Show CO badge from loaded data or from order document */}
                        {liveCO ? (
                          <span style={styles.liveCOBadge} title={`Live CO: ${liveCO.changeOrderNumber}`}>
                            {liveCO.changeOrderNumber}
                          </span>
                        ) : order.activeChangeOrderStatus === 'pending_signature' ? (
                          <span style={styles.liveCOBadge} title="Has pending signature CO">
                            CO pending sig
                          </span>
                        ) : null}
                        {hasDraftCO ? (
                          <span style={styles.pendingCOBadge} title="Has draft change order">
                            Draft CO
                          </span>
                        ) : order.activeChangeOrderStatus === 'draft' ? (
                          <span style={styles.pendingCOBadge} title="Has draft change order">
                            Draft CO
                          </span>
                        ) : null}
                        {/* Show CO count if has change orders */}
                        {order.hasChangeOrders && order.changeOrderCount > 0 && !liveCO && !hasDraftCO && (
                          <span style={styles.coCountBadge} title={`${order.changeOrderCount} change order(s)`}>
                            {order.changeOrderCount} CO{order.changeOrderCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </td>
                      <td style={{ ...styles.td, fontWeight: 600, color: '#1565c0' }}>
                        {formatCurrency(effectiveOrderTotal)}
                        {liveCO && effectiveOrderTotal !== order.orderTotal && (
                          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                            (was {formatCurrency(order.orderTotal)})
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>
                        {formatCurrency(effectiveDeposit)}
                        {liveCO && effectiveDeposit !== order.ledgerSummary.originalDeposit && (
                          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                            (was {formatCurrency(order.ledgerSummary.originalDeposit)})
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>{formatCurrency(order.ledgerSummary.netReceived)}</td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        <span style={{
                          color: effectiveBalance === 0 ? '#2e7d32' :
                                 effectiveBalance > 0 ? '#e65100' : '#1565c0'
                        }}>
                          {effectiveBalance > 0 ? '+' : ''}
                          {formatCurrency(effectiveBalance)}
                        </span>
                      </td>
                      <td style={styles.td}>
                        {order.hasPendingPayment && (
                          <button
                            onClick={() => openLegacyApprovalModal(
                              order.id,
                              order.orderNumber,
                              order.pendingPaymentAmount || 0,
                              order.pendingPaymentMethod || 'manual'
                            )}
                            style={{
                              ...styles.actionButton,
                              backgroundColor: effectiveBalance < 0 ? '#1565c0' : '#4caf50',
                              color: 'white',
                              marginRight: 8,
                            }}
                          >
                            {effectiveBalance < 0 ? 'Refund' : 'Collect'}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedOrderNumber(order.orderNumber);
                            setActiveTab('ledger-viewer');
                          }}
                          style={styles.actionButton}
                        >
                          View Ledger
                        </button>
                        <button
                          onClick={() => recalculateSummary(order.id)}
                          style={{ ...styles.actionButton, marginLeft: 8 }}
                        >
                          Recalculate
                        </button>
                      </td>
                    </tr>
                    {/* Expanded transactions row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} style={styles.transactionsCell}>
                          <div style={styles.transactionsContainer}>
                            {/* Order Info Bar */}
                            <div style={styles.orderInfoBar}>
                              <div style={styles.orderInfoItem}>
                                <span style={styles.orderInfoLabel}>Order Form PDF:</span>
                                {order.orderFormPdfUrl ? (
                                  <a
                                    href={order.orderFormPdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={styles.pdfLink}
                                  >
                                    View PDF
                                  </a>
                                ) : (
                                  <span style={{ color: '#999' }}>Not uploaded</span>
                                )}
                              </div>
                              <div style={styles.orderInfoItem}>
                                <span style={styles.orderInfoLabel}>Deposit %:</span>
                                <span style={{
                                  fontWeight: 600,
                                  color: order.depositPercent >= 45 && order.depositPercent <= 55 ? '#2e7d32' : '#e65100'
                                }}>
                                  {order.depositPercent.toFixed(1)}%
                                </span>
                                <span style={{ fontSize: '11px', color: '#666', marginLeft: '4px' }}>
                                  ({formatCurrency(order.ledgerSummary.originalDeposit)} of {formatCurrency(order.subtotal)})
                                </span>
                              </div>
                              <div style={styles.orderInfoActions}>
                                {/* Recommended action based on balance */}
                                {effectiveBalance !== 0 && (
                                  <button
                                    onClick={() => openTransactionModal(
                                      effectiveBalance > 0 ? 'payment' : 'refund',
                                      order.orderNumber,
                                      order.id,
                                      Math.abs(effectiveBalance)
                                    )}
                                    style={{
                                      ...styles.recommendedBtn,
                                      backgroundColor: effectiveBalance > 0 ? '#1565c0' : '#7b1fa2',
                                    }}
                                  >
                                    {effectiveBalance > 0
                                      ? `Collect ${formatCurrency(effectiveBalance)}`
                                      : `Refund ${formatCurrency(Math.abs(effectiveBalance))}`}
                                  </button>
                                )}
                                <button
                                  onClick={() => openTransactionModal('payment', order.orderNumber, order.id)}
                                  style={styles.addPaymentBtn}
                                >
                                  + Add Payment
                                </button>
                                <button
                                  onClick={() => openTransactionModal('refund', order.orderNumber, order.id)}
                                  style={styles.addRefundBtn}
                                >
                                  + Add Refund
                                </button>
                              </div>
                            </div>

                            <div style={styles.transactionsTitle}>Transactions</div>
                            {transactions.length === 0 ? (
                              <div style={styles.noTransactions}>Loading or no transactions...</div>
                            ) : (
                              <table style={styles.transactionsTable}>
                                <thead>
                                  <tr>
                                    <th style={styles.txTh}>Payment ID</th>
                                    <th style={styles.txTh}>Date</th>
                                    <th style={styles.txTh}>Type</th>
                                    <th style={styles.txTh}>Method</th>
                                    <th style={styles.txThRight}>Amount</th>
                                    <th style={styles.txTh}>Status</th>
                                    <th style={styles.txTh}>Reference</th>
                                    <th style={styles.txTh}>Notes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {transactions.map((tx) => {
                                    const typeColors = TRANSACTION_TYPE_COLORS[tx.transactionType] || {
                                      bg: '#f5f5f5',
                                      color: '#666',
                                    };
                                    const isVoided = tx.status === 'voided';

                                    return (
                                      <tr key={tx.id} style={{ opacity: isVoided ? 0.5 : 1 }}>
                                        <td style={{ ...styles.txTd, fontFamily: 'monospace', fontSize: '12px', color: '#1976d2' }}>
                                          {tx.paymentNumber || tx.id?.substring(0, 8) || '-'}
                                        </td>
                                        <td style={styles.txTd}>{formatDate(tx.createdAt)}</td>
                                        <td style={styles.txTd}>
                                          <span style={{ ...styles.txTypeBadge, ...typeColors }}>
                                            {TRANSACTION_TYPE_LABELS[tx.transactionType]}
                                          </span>
                                        </td>
                                        <td style={styles.txTd}>
                                          {PAYMENT_METHOD_LABELS[tx.method] || tx.method}
                                        </td>
                                        <td style={{
                                          ...styles.txTdRight,
                                          color: tx.transactionType === 'payment' ? '#2e7d32' :
                                                 tx.transactionType === 'refund' ? '#c62828' : '#333',
                                          textDecoration: isVoided ? 'line-through' : 'none',
                                        }}>
                                          {formatCurrency(tx.amount)}
                                        </td>
                                        <td style={styles.txTd}>
                                          <span style={{
                                            ...styles.txStatusBadge,
                                            backgroundColor: tx.status === 'verified' || tx.status === 'approved'
                                              ? '#e8f5e9' : tx.status === 'pending' ? '#fff3e0' : '#f5f5f5',
                                            color: tx.status === 'verified' || tx.status === 'approved'
                                              ? '#2e7d32' : tx.status === 'pending' ? '#e65100' : '#666',
                                          }}>
                                            {tx.status === 'verified' || tx.status === 'approved' ? 'Cleared' :
                                             tx.status === 'pending' ? 'Pending' :
                                             tx.status === 'voided' ? 'Voided' : tx.status}
                                          </span>
                                        </td>
                                        <td style={styles.txTd}>
                                          <span style={styles.txReference}>
                                            {tx.stripePaymentId || tx.changeOrderNumber || '-'}
                                          </span>
                                        </td>
                                        <td style={styles.txTd}>
                                          <span style={styles.txNotes}>
                                            {tx.description || tx.notes || '-'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}

                            {/* Order History Section (Original + Change Orders) */}
                            <div style={{ ...styles.transactionsTitle, marginTop: '16px' }}>
                              Order History
                            </div>
                            <table style={styles.transactionsTable}>
                              <thead>
                                <tr>
                                  <th style={styles.txTh}>Order/CO</th>
                                  <th style={styles.txTh}>Date</th>
                                  <th style={styles.txTh}>Status</th>
                                  <th style={styles.txThRight}>Order Total</th>
                                  <th style={styles.txThRight}>Deposit Change</th>
                                  <th style={styles.txThRight}>Deposit</th>
                                  <th style={styles.txTh}>PDF</th>
                                  <th style={styles.txTh}>Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* Original Order Row - show as superseded if there's a live CO */}
                                <tr style={{ backgroundColor: '#f8f9fa', opacity: liveCO ? 0.5 : 1 }}>
                                  <td style={{ ...styles.txTd, fontWeight: 600, color: '#333' }}>
                                    {order.orderNumber}
                                  </td>
                                  <td style={styles.txTd}>-</td>
                                  <td style={styles.txTd}>
                                    <span style={{
                                      ...styles.txStatusBadge,
                                      backgroundColor: liveCO ? '#f5f5f5' : '#e8f5e9',
                                      color: liveCO ? '#666' : '#2e7d32',
                                    }}>
                                      {liveCO ? 'Superseded' : 'Original'}
                                    </span>
                                  </td>
                                  <td style={{ ...styles.txTdRight, fontWeight: 600, textDecoration: liveCO ? 'line-through' : 'none' }}>
                                    {formatCurrency(order.orderTotal)}
                                  </td>
                                  <td style={styles.txTdRight}>-</td>
                                  <td style={{ ...styles.txTdRight, fontWeight: 600, textDecoration: liveCO ? 'line-through' : 'none' }}>
                                    {formatCurrency(order.ledgerSummary.originalDeposit)}
                                  </td>
                                  <td style={styles.txTd}>
                                    {order.orderFormPdfUrl ? (
                                      <a href={order.orderFormPdfUrl} target="_blank" rel="noopener noreferrer" style={styles.pdfLink}>
                                        View
                                      </a>
                                    ) : (
                                      <span style={{ color: '#999', fontSize: '11px' }}>-</span>
                                    )}
                                  </td>
                                  <td style={styles.txTd}>
                                    <span style={styles.txNotes}>Original order</span>
                                  </td>
                                </tr>
                                {/* Change Order Rows */}
                                {changeOrders.map((co) => {
                                  // Determine if this CO is superseded by a newer pending_signature CO
                                  const pendingSigCOs = changeOrders.filter(c => c.status === 'pending_signature');
                                  const isNewestPendingSig = co.status === 'pending_signature' &&
                                    pendingSigCOs.every(c => c.changeOrderNumber <= co.changeOrderNumber);
                                  const isSuperseded = co.status === 'pending_signature' && !isNewestPendingSig;

                                  const coStatusColors: Record<string, { bg: string; color: string }> = {
                                    draft: { bg: '#fff3e0', color: '#e65100' },
                                    pending_signature: { bg: '#e3f2fd', color: '#1565c0' },
                                    signed: { bg: '#e8f5e9', color: '#2e7d32' },
                                    cancelled: { bg: '#f5f5f5', color: '#666' },
                                    superseded: { bg: '#f5f5f5', color: '#666' },
                                  };

                                  const displayStatus = isSuperseded ? 'superseded' : co.status;
                                  const statusColor = coStatusColors[displayStatus] || coStatusColors.draft;
                                  const isCancelledOrSuperseded = co.status === 'cancelled' || isSuperseded;

                                  // Get CO PDF URL
                                  const coPdfUrl = co.files?.orderFormPdf?.downloadUrl;

                                  return (
                                    <tr key={co.id} style={{ opacity: isCancelledOrSuperseded ? 0.5 : 1 }}>
                                      <td style={{ ...styles.txTd, fontWeight: 600, color: isCancelledOrSuperseded ? '#999' : '#1565c0', paddingLeft: '24px' }}>
                                        └ {co.changeOrderNumber}
                                      </td>
                                      <td style={styles.txTd}>{formatDate(co.createdAt)}</td>
                                      <td style={styles.txTd}>
                                        <span style={{
                                          ...styles.txStatusBadge,
                                          backgroundColor: statusColor.bg,
                                          color: statusColor.color,
                                        }}>
                                          {isSuperseded ? 'Superseded' : co.status.replace('_', ' ')}
                                        </span>
                                      </td>
                                      <td style={{
                                        ...styles.txTdRight,
                                        fontWeight: 600,
                                        textDecoration: isCancelledOrSuperseded ? 'line-through' : 'none',
                                        color: isCancelledOrSuperseded ? '#999' : '#333',
                                      }}>
                                        {formatCurrency(co.newValues.subtotalBeforeTax + (co.newValues.extraMoneyFluff || 0))}
                                      </td>
                                      <td style={{
                                        ...styles.txTdRight,
                                        color: isCancelledOrSuperseded ? '#999' :
                                               co.differences.depositDiff > 0 ? '#2e7d32' :
                                               co.differences.depositDiff < 0 ? '#c62828' : '#333',
                                        textDecoration: isCancelledOrSuperseded ? 'line-through' : 'none',
                                      }}>
                                        {co.differences.depositDiff > 0 ? '+' : ''}
                                        {formatCurrency(co.differences.depositDiff)}
                                      </td>
                                      <td style={{ ...styles.txTdRight, textDecoration: isCancelledOrSuperseded ? 'line-through' : 'none' }}>
                                        {formatCurrency(co.newValues.deposit)}
                                      </td>
                                      <td style={styles.txTd}>
                                        {coPdfUrl ? (
                                          <a href={coPdfUrl} target="_blank" rel="noopener noreferrer" style={styles.pdfLink}>
                                            View
                                          </a>
                                        ) : (
                                          <span style={{ color: '#999', fontSize: '11px' }}>-</span>
                                        )}
                                      </td>
                                      <td style={styles.txTd}>
                                        <span style={styles.txNotes}>
                                          {co.reason || '-'}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {changeOrders.length === 0 && (
                                  <tr>
                                    <td colSpan={8} style={{ ...styles.txTd, color: '#999', fontStyle: 'italic', paddingLeft: '24px' }}>
                                      No change orders
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* All Orders */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>All Orders ({allOrders.length})</h3>
        </div>

        {allOrders.length === 0 ? (
          <div style={styles.emptyState}>No orders found.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}></th>
                <th style={styles.th}>Order</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Order Total</th>
                <th style={styles.th}>Deposit Req'd</th>
                <th style={styles.th}>Received</th>
                <th style={styles.th}>Balance</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allOrders.map((order) => {
                const isExpanded = expandedOrders.has(order.id);
                const transactions = orderTransactions[order.id] || [];
                const changeOrders = orderChangeOrders[order.id] || [];

                // Check for change orders - pending_signature is LIVE (supersedes original)
                const liveCO = changeOrders.find(co => co.status === 'pending_signature');
                const draftCOs = changeOrders.filter(co => co.status === 'draft');
                const hasDraftCO = draftCOs.length > 0;

                // If there's a live CO (pending_signature), use its values as the real values
                const effectiveDeposit = liveCO
                  ? liveCO.newValues.deposit
                  : order.ledgerSummary.depositRequired;
                const effectiveOrderTotal = liveCO
                  ? liveCO.newValues.subtotalBeforeTax + (liveCO.newValues.extraMoneyFluff || 0)
                  : order.orderTotal;
                const effectiveBalance = effectiveDeposit - order.ledgerSummary.netReceived;

                // Determine effective status based on effective balance
                const effectiveStatus = effectiveBalance === 0 ? 'paid'
                  : effectiveBalance > 0 ? 'underpaid'
                  : 'overpaid';
                const effectiveStatusColors = BALANCE_STATUS_COLORS[effectiveStatus] || {
                  bg: '#f5f5f5',
                  color: '#666',
                };

                return (
                  <React.Fragment key={order.id}>
                    <tr>
                      <td style={styles.td}>
                        <button
                          onClick={() => toggleOrderExpansion(order.id)}
                          style={styles.expandButton}
                          title={isExpanded ? 'Hide transactions' : 'Show transactions'}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      </td>
                      <td style={styles.td}>
                        <a
                          href={`/?order=${order.orderNumber}`}
                          style={styles.orderNumberLink}
                          title="Open order details"
                        >
                          {order.orderNumber}
                        </a>
                      </td>
                      <td style={styles.td}>{order.customerName || '-'}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.statusBadge,
                            backgroundColor: effectiveStatusColors.bg,
                            color: effectiveStatusColors.color,
                          }}
                        >
                          {BALANCE_STATUS_LABELS[effectiveStatus] || effectiveStatus}
                        </span>
                        {/* Show CO badge from loaded data or from order document */}
                        {liveCO ? (
                          <span style={styles.liveCOBadge} title={`Live CO: ${liveCO.changeOrderNumber}`}>
                            {liveCO.changeOrderNumber}
                          </span>
                        ) : order.activeChangeOrderStatus === 'pending_signature' ? (
                          <span style={styles.liveCOBadge} title="Has pending signature CO">
                            CO pending sig
                          </span>
                        ) : null}
                        {hasDraftCO ? (
                          <span style={styles.pendingCOBadge} title="Has draft change order">
                            Draft CO
                          </span>
                        ) : order.activeChangeOrderStatus === 'draft' ? (
                          <span style={styles.pendingCOBadge} title="Has draft change order">
                            Draft CO
                          </span>
                        ) : null}
                        {/* Show CO count if has change orders */}
                        {order.hasChangeOrders && order.changeOrderCount > 0 && !liveCO && !hasDraftCO && !order.activeChangeOrderStatus && (
                          <span style={styles.coCountBadge} title={`${order.changeOrderCount} change order(s)`}>
                            {order.changeOrderCount} CO{order.changeOrderCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </td>
                      <td style={{ ...styles.td, fontWeight: 600, color: '#1565c0' }}>
                        {formatCurrency(effectiveOrderTotal)}
                        {liveCO && effectiveOrderTotal !== order.orderTotal && (
                          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                            (was {formatCurrency(order.orderTotal)})
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>
                        {formatCurrency(effectiveDeposit)}
                        {liveCO && effectiveDeposit !== order.ledgerSummary.originalDeposit && (
                          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                            (was {formatCurrency(order.ledgerSummary.originalDeposit)})
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>{formatCurrency(order.ledgerSummary.netReceived)}</td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        <span style={{
                          color: effectiveBalance === 0 ? '#2e7d32' :
                                 effectiveBalance > 0 ? '#e65100' : '#1565c0'
                        }}>
                          {effectiveBalance > 0 ? '+' : ''}
                          {formatCurrency(effectiveBalance)}
                        </span>
                      </td>
                      <td style={styles.td}>
                        {order.hasPendingPayment && (
                          <button
                            onClick={() => openLegacyApprovalModal(
                              order.id,
                              order.orderNumber,
                              order.pendingPaymentAmount || 0,
                              order.pendingPaymentMethod || 'manual'
                            )}
                            style={{
                              ...styles.actionButton,
                              backgroundColor: effectiveBalance < 0 ? '#1565c0' : '#4caf50',
                              color: 'white',
                              marginRight: 8,
                            }}
                          >
                            {effectiveBalance < 0 ? 'Refund' : 'Collect'}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedOrderNumber(order.orderNumber);
                            setActiveTab('ledger-viewer');
                          }}
                          style={styles.actionButton}
                        >
                          View Ledger
                        </button>
                        <button
                          onClick={() => recalculateSummary(order.id)}
                          style={{ ...styles.actionButton, marginLeft: 8 }}
                        >
                          Recalculate
                        </button>
                      </td>
                    </tr>
                    {/* Expanded transactions row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} style={styles.transactionsCell}>
                          <div style={styles.transactionsContainer}>
                            {/* Order Info Bar */}
                            <div style={styles.orderInfoBar}>
                              <div style={styles.orderInfoItem}>
                                <span style={styles.orderInfoLabel}>Order Form PDF:</span>
                                {order.orderFormPdfUrl ? (
                                  <a
                                    href={order.orderFormPdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={styles.pdfLink}
                                  >
                                    View PDF
                                  </a>
                                ) : (
                                  <span style={{ color: '#999' }}>Not uploaded</span>
                                )}
                              </div>
                              <div style={styles.orderInfoItem}>
                                <span style={styles.orderInfoLabel}>Deposit %:</span>
                                <span style={{
                                  fontWeight: 600,
                                  color: order.depositPercent >= 45 && order.depositPercent <= 55 ? '#2e7d32' : '#e65100'
                                }}>
                                  {order.depositPercent.toFixed(1)}%
                                </span>
                                <span style={{ fontSize: '11px', color: '#666', marginLeft: '4px' }}>
                                  ({formatCurrency(order.ledgerSummary.originalDeposit)} of {formatCurrency(order.subtotal)})
                                </span>
                              </div>
                              <div style={styles.orderInfoActions}>
                                {/* Recommended action based on balance */}
                                {effectiveBalance !== 0 && (
                                  <button
                                    onClick={() => openTransactionModal(
                                      effectiveBalance > 0 ? 'payment' : 'refund',
                                      order.orderNumber,
                                      order.id,
                                      Math.abs(effectiveBalance)
                                    )}
                                    style={{
                                      ...styles.recommendedBtn,
                                      backgroundColor: effectiveBalance > 0 ? '#1565c0' : '#7b1fa2',
                                    }}
                                  >
                                    {effectiveBalance > 0
                                      ? `Collect ${formatCurrency(effectiveBalance)}`
                                      : `Refund ${formatCurrency(Math.abs(effectiveBalance))}`}
                                  </button>
                                )}
                                <button
                                  onClick={() => openTransactionModal('payment', order.orderNumber, order.id)}
                                  style={styles.addPaymentBtn}
                                >
                                  + Add Payment
                                </button>
                                <button
                                  onClick={() => openTransactionModal('refund', order.orderNumber, order.id)}
                                  style={styles.addRefundBtn}
                                >
                                  + Add Refund
                                </button>
                              </div>
                            </div>

                            <div style={styles.transactionsTitle}>Transactions</div>
                            {transactions.length === 0 ? (
                              <div style={styles.noTransactions}>Loading or no transactions...</div>
                            ) : (
                              <table style={styles.transactionsTable}>
                                <thead>
                                  <tr>
                                    <th style={styles.txTh}>Payment ID</th>
                                    <th style={styles.txTh}>Date</th>
                                    <th style={styles.txTh}>Type</th>
                                    <th style={styles.txTh}>Method</th>
                                    <th style={styles.txThRight}>Amount</th>
                                    <th style={styles.txTh}>Status</th>
                                    <th style={styles.txTh}>Reference</th>
                                    <th style={styles.txTh}>Notes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {transactions.map((tx) => {
                                    const typeColors = TRANSACTION_TYPE_COLORS[tx.transactionType] || {
                                      bg: '#f5f5f5',
                                      color: '#666',
                                    };
                                    const isVoided = tx.status === 'voided';

                                    return (
                                      <tr key={tx.id} style={{ opacity: isVoided ? 0.5 : 1 }}>
                                        <td style={{ ...styles.txTd, fontFamily: 'monospace', fontSize: '12px', color: '#1976d2' }}>
                                          {tx.paymentNumber || tx.id?.substring(0, 8) || '-'}
                                        </td>
                                        <td style={styles.txTd}>{formatDate(tx.createdAt)}</td>
                                        <td style={styles.txTd}>
                                          <span style={{ ...styles.txTypeBadge, ...typeColors }}>
                                            {TRANSACTION_TYPE_LABELS[tx.transactionType]}
                                          </span>
                                        </td>
                                        <td style={styles.txTd}>
                                          {PAYMENT_METHOD_LABELS[tx.method] || tx.method}
                                        </td>
                                        <td style={{
                                          ...styles.txTdRight,
                                          color: tx.transactionType === 'payment' ? '#2e7d32' :
                                                 tx.transactionType === 'refund' ? '#c62828' : '#333',
                                          textDecoration: isVoided ? 'line-through' : 'none',
                                        }}>
                                          {formatCurrency(tx.amount)}
                                        </td>
                                        <td style={styles.txTd}>
                                          <span style={{
                                            ...styles.txStatusBadge,
                                            backgroundColor: tx.status === 'verified' || tx.status === 'approved'
                                              ? '#e8f5e9' : tx.status === 'pending' ? '#fff3e0' : '#f5f5f5',
                                            color: tx.status === 'verified' || tx.status === 'approved'
                                              ? '#2e7d32' : tx.status === 'pending' ? '#e65100' : '#666',
                                          }}>
                                            {tx.status === 'verified' || tx.status === 'approved' ? 'Cleared' :
                                             tx.status === 'pending' ? 'Pending' :
                                             tx.status === 'voided' ? 'Voided' : tx.status}
                                          </span>
                                        </td>
                                        <td style={styles.txTd}>
                                          <span style={styles.txReference}>
                                            {tx.stripePaymentId || tx.changeOrderNumber || '-'}
                                          </span>
                                        </td>
                                        <td style={styles.txTd}>
                                          <span style={styles.txNotes}>
                                            {tx.description || tx.notes || '-'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}

                            {/* Order History Section (Original + Change Orders) */}
                            <div style={{ ...styles.transactionsTitle, marginTop: '16px' }}>
                              Order History
                            </div>
                            <table style={styles.transactionsTable}>
                              <thead>
                                <tr>
                                  <th style={styles.txTh}>Order/CO</th>
                                  <th style={styles.txTh}>Date</th>
                                  <th style={styles.txTh}>Status</th>
                                  <th style={styles.txThRight}>Order Total</th>
                                  <th style={styles.txThRight}>Deposit Change</th>
                                  <th style={styles.txThRight}>Deposit</th>
                                  <th style={styles.txTh}>PDF</th>
                                  <th style={styles.txTh}>Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* Original Order Row - show as superseded if there's a live CO */}
                                <tr style={{ backgroundColor: '#f8f9fa', opacity: liveCO ? 0.5 : 1 }}>
                                  <td style={{ ...styles.txTd, fontWeight: 600, color: '#333' }}>
                                    {order.orderNumber}
                                  </td>
                                  <td style={styles.txTd}>-</td>
                                  <td style={styles.txTd}>
                                    <span style={{
                                      ...styles.txStatusBadge,
                                      backgroundColor: liveCO ? '#f5f5f5' : '#e8f5e9',
                                      color: liveCO ? '#666' : '#2e7d32',
                                    }}>
                                      {liveCO ? 'Superseded' : 'Original'}
                                    </span>
                                  </td>
                                  <td style={{ ...styles.txTdRight, fontWeight: 600, textDecoration: liveCO ? 'line-through' : 'none' }}>
                                    {formatCurrency(order.orderTotal)}
                                  </td>
                                  <td style={styles.txTdRight}>-</td>
                                  <td style={{ ...styles.txTdRight, fontWeight: 600, textDecoration: liveCO ? 'line-through' : 'none' }}>
                                    {formatCurrency(order.ledgerSummary.originalDeposit)}
                                  </td>
                                  <td style={styles.txTd}>
                                    {order.orderFormPdfUrl ? (
                                      <a href={order.orderFormPdfUrl} target="_blank" rel="noopener noreferrer" style={styles.pdfLink}>
                                        View
                                      </a>
                                    ) : (
                                      <span style={{ color: '#999', fontSize: '11px' }}>-</span>
                                    )}
                                  </td>
                                  <td style={styles.txTd}>
                                    <span style={styles.txNotes}>Original order</span>
                                  </td>
                                </tr>
                                {/* Change Order Rows */}
                                {changeOrders.map((co) => {
                                  // Determine if this CO is superseded by a newer pending_signature CO
                                  const pendingSigCOs = changeOrders.filter(c => c.status === 'pending_signature');
                                  const isNewestPendingSig = co.status === 'pending_signature' &&
                                    pendingSigCOs.every(c => c.changeOrderNumber <= co.changeOrderNumber);
                                  const isSuperseded = co.status === 'pending_signature' && !isNewestPendingSig;

                                  const coStatusColors: Record<string, { bg: string; color: string }> = {
                                    draft: { bg: '#fff3e0', color: '#e65100' },
                                    pending_signature: { bg: '#e3f2fd', color: '#1565c0' },
                                    signed: { bg: '#e8f5e9', color: '#2e7d32' },
                                    cancelled: { bg: '#f5f5f5', color: '#666' },
                                    superseded: { bg: '#f5f5f5', color: '#666' },
                                  };

                                  const displayStatus = isSuperseded ? 'superseded' : co.status;
                                  const statusColor = coStatusColors[displayStatus] || coStatusColors.draft;
                                  const isCancelledOrSuperseded = co.status === 'cancelled' || isSuperseded;

                                  // Get CO PDF URL
                                  const coPdfUrl = co.files?.orderFormPdf?.downloadUrl;

                                  return (
                                    <tr key={co.id} style={{ opacity: isCancelledOrSuperseded ? 0.5 : 1 }}>
                                      <td style={{ ...styles.txTd, fontWeight: 600, color: isCancelledOrSuperseded ? '#999' : '#1565c0', paddingLeft: '24px' }}>
                                        └ {co.changeOrderNumber}
                                      </td>
                                      <td style={styles.txTd}>{formatDate(co.createdAt)}</td>
                                      <td style={styles.txTd}>
                                        <span style={{
                                          ...styles.txStatusBadge,
                                          backgroundColor: statusColor.bg,
                                          color: statusColor.color,
                                        }}>
                                          {isSuperseded ? 'Superseded' : co.status.replace('_', ' ')}
                                        </span>
                                      </td>
                                      <td style={{
                                        ...styles.txTdRight,
                                        fontWeight: 600,
                                        textDecoration: isCancelledOrSuperseded ? 'line-through' : 'none',
                                        color: isCancelledOrSuperseded ? '#999' : '#333',
                                      }}>
                                        {formatCurrency(co.newValues.subtotalBeforeTax + (co.newValues.extraMoneyFluff || 0))}
                                      </td>
                                      <td style={{
                                        ...styles.txTdRight,
                                        color: isCancelledOrSuperseded ? '#999' :
                                               co.differences.depositDiff > 0 ? '#2e7d32' :
                                               co.differences.depositDiff < 0 ? '#c62828' : '#333',
                                        textDecoration: isCancelledOrSuperseded ? 'line-through' : 'none',
                                      }}>
                                        {co.differences.depositDiff > 0 ? '+' : ''}
                                        {formatCurrency(co.differences.depositDiff)}
                                      </td>
                                      <td style={{ ...styles.txTdRight, textDecoration: isCancelledOrSuperseded ? 'line-through' : 'none' }}>
                                        {formatCurrency(co.newValues.deposit)}
                                      </td>
                                      <td style={styles.txTd}>
                                        {coPdfUrl ? (
                                          <a href={coPdfUrl} target="_blank" rel="noopener noreferrer" style={styles.pdfLink}>
                                            View
                                          </a>
                                        ) : (
                                          <span style={{ color: '#999', fontSize: '11px' }}>-</span>
                                        )}
                                      </td>
                                      <td style={styles.txTd}>
                                        <span style={styles.txNotes}>
                                          {co.reason || '-'}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {changeOrders.length === 0 && (
                                  <tr>
                                    <td colSpan={8} style={{ ...styles.txTd, color: '#999', fontStyle: 'italic', paddingLeft: '24px' }}>
                                      No change orders
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const renderReconciliation = () => (
    <div>
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Stripe Reconciliation</h3>
          <button
            onClick={runReconciliation}
            disabled={reconciling}
            style={{
              ...styles.primaryButton,
              opacity: reconciling ? 0.7 : 1,
            }}
          >
            {reconciling ? 'Running...' : 'Run Reconciliation'}
          </button>
        </div>

        <p style={styles.helpText}>
          Compares ledger entries with Stripe records to identify discrepancies.
          Test mode payments (with test_ prefix) will show as mismatched since they don't exist in Stripe.
        </p>

        {reconciliationResult && (
          <>
            {/* Summary Stats */}
            <div style={styles.reconcileStats}>
              <div style={styles.reconcileStat}>
                <span style={styles.reconcileStatValue}>{reconciliationResult.totalEntries}</span>
                <span style={styles.reconcileStatLabel}>Total Entries</span>
              </div>
              <div style={{ ...styles.reconcileStat, borderColor: '#4caf50' }}>
                <span style={{ ...styles.reconcileStatValue, color: '#4caf50' }}>
                  {reconciliationResult.matched}
                </span>
                <span style={styles.reconcileStatLabel}>Matched</span>
              </div>
              <div style={{ ...styles.reconcileStat, borderColor: '#ff9800' }}>
                <span style={{ ...styles.reconcileStatValue, color: '#ff9800' }}>
                  {reconciliationResult.mismatched}
                </span>
                <span style={styles.reconcileStatLabel}>Mismatched</span>
              </div>
              <div style={{ ...styles.reconcileStat, borderColor: '#f44336' }}>
                <span style={{ ...styles.reconcileStatValue, color: '#f44336' }}>
                  {reconciliationResult.missingStripe}
                </span>
                <span style={styles.reconcileStatLabel}>Missing Stripe ID</span>
              </div>
              <div style={{ ...styles.reconcileStat, borderColor: '#9c27b0' }}>
                <span style={{ ...styles.reconcileStatValue, color: '#9c27b0' }}>
                  {formatCurrency(reconciliationResult.totalDiscrepancy)}
                </span>
                <span style={styles.reconcileStatLabel}>Total Discrepancy</span>
              </div>
            </div>

            {/* Entries Table */}
            {reconciliationResult.entries.length > 0 && (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Order</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Ledger Amount</th>
                    <th style={styles.th}>Stripe ID</th>
                    <th style={styles.th}>Stripe Amount</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliationResult.entries.map((entry, index) => {
                    const statusColors: Record<string, { bg: string; color: string }> = {
                      matched: { bg: '#e8f5e9', color: '#2e7d32' },
                      mismatch: { bg: '#fff3e0', color: '#e65100' },
                      missing_stripe: { bg: '#ffebee', color: '#c62828' },
                      missing_ledger: { bg: '#f3e5f5', color: '#7b1fa2' },
                    };
                    const colors = statusColors[entry.status] || statusColors.mismatch;

                    return (
                      <tr key={`${entry.entryId}-${index}`}>
                        <td style={styles.td}>{entry.orderNumber}</td>
                        <td style={styles.td}>{entry.entryType}</td>
                        <td style={styles.td}>{formatCurrency(entry.ledgerAmount)}</td>
                        <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>
                          {entry.stripePaymentId || '-'}
                        </td>
                        <td style={styles.td}>
                          {entry.stripeAmount !== undefined ? formatCurrency(entry.stripeAmount) : '-'}
                        </td>
                        <td style={styles.td}>
                          <span style={{ ...styles.statusBadge, ...colors }}>
                            {entry.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ ...styles.td, fontSize: 12 }}>{entry.details || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );

  const renderLedgerViewer = () => (
    <div>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Ledger Entry Viewer</h3>

        <div style={styles.searchRow}>
          <input
            type="text"
            value={selectedOrderNumber}
            onChange={(e) => setSelectedOrderNumber(e.target.value.toUpperCase())}
            placeholder="Enter Order Number (e.g., ORD-00025)"
            style={styles.searchInput}
            onKeyDown={(e) => e.key === 'Enter' && loadLedgerEntries()}
          />
          <button
            onClick={loadLedgerEntries}
            disabled={viewerLoading}
            style={styles.primaryButton}
          >
            {viewerLoading ? 'Loading...' : 'Load Entries'}
          </button>
        </div>

        {ledgerEntries.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Payment ID</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Amount</th>
                <th style={styles.th}>Method</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Created By</th>
              </tr>
            </thead>
            <tbody>
              {ledgerEntries.map((entry) => {
                const typeColors = TRANSACTION_TYPE_COLORS[entry.transactionType] || {
                  bg: '#f5f5f5',
                  color: '#666',
                };
                const isVoided = entry.status === 'voided';

                return (
                  <tr key={entry.id} style={isVoided ? { opacity: 0.5 } : {}}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '12px', color: '#1976d2' }}>
                      {entry.paymentNumber || entry.id?.substring(0, 8) || '-'}
                    </td>
                    <td style={styles.td}>{formatDate(entry.createdAt)}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.statusBadge, ...typeColors }}>
                        {TRANSACTION_TYPE_LABELS[entry.transactionType]}
                      </span>
                    </td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>
                      {formatCurrency(entry.amount)}
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: '#e3f2fd',
                          color: '#1565c0',
                        }}
                      >
                        {PAYMENT_METHOD_LABELS[entry.method] || entry.method}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          backgroundColor: isVoided ? '#ffebee' : '#e8f5e9',
                          color: isVoided ? '#c62828' : '#2e7d32',
                        }}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td style={{ ...styles.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.description}
                    </td>
                    <td style={styles.td}>{entry.createdBy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {ledgerEntries.length === 0 && selectedOrderNumber && !viewerLoading && (
          <div style={styles.emptyState}>
            No ledger entries found for this order.
          </div>
        )}
      </div>
    </div>
  );

  const renderApprovals = () => (
    <div>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Pending Approvals</h3>
        <p style={styles.helpText}>
          Payments awaiting manager approval will appear here.
        </p>
        <div style={styles.emptyState}>
          No pending approvals at this time.
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Manager Payment Dashboard</h2>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          {error}
          <button onClick={() => setError(null)} style={styles.dismissButton}>
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            ...styles.tab,
            ...(activeTab === 'dashboard' ? styles.tabActive : {}),
          }}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('all-payments')}
          style={{
            ...styles.tab,
            ...(activeTab === 'all-payments' ? styles.tabActive : {}),
          }}
        >
          All Payments
        </button>
        <button
          onClick={() => setActiveTab('reconciliation')}
          style={{
            ...styles.tab,
            ...(activeTab === 'reconciliation' ? styles.tabActive : {}),
          }}
        >
          Reconciliation
        </button>
        <button
          onClick={() => setActiveTab('ledger-viewer')}
          style={{
            ...styles.tab,
            ...(activeTab === 'ledger-viewer' ? styles.tabActive : {}),
          }}
        >
          Ledger Viewer
        </button>
        <button
          onClick={() => setActiveTab('approvals')}
          style={{
            ...styles.tab,
            ...(activeTab === 'approvals' ? styles.tabActive : {}),
          }}
        >
          Approvals
        </button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading && activeTab !== 'all-payments' ? (
          <div style={styles.loading}>Loading...</div>
        ) : (
          <>
            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'all-payments' && (
              <AllPaymentsTab
                onSelectPayment={(payment) => setSelectedPayment(payment)}
                onApprove={openApprovalModal}
              />
            )}
            {activeTab === 'reconciliation' && renderReconciliation()}
            {activeTab === 'ledger-viewer' && renderLedgerViewer()}
            {activeTab === 'approvals' && renderApprovals()}
          </>
        )}
      </div>

      {/* Payment Detail Modal */}
      {selectedPayment && (
        <PaymentDetailModal
          payment={selectedPayment}
          onClose={() => setSelectedPayment(null)}
          onViewOrder={(orderNumber) => {
            setSelectedOrderNumber(orderNumber);
            setActiveTab('ledger-viewer');
            setSelectedPayment(null);
            loadLedgerEntries();
          }}
          onVoided={() => {
            // Refresh data after voiding
            loadDashboardData();
          }}
        />
      )}

      {/* Transaction Modal */}
      {transactionModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                Add {transactionModal.type === 'payment' ? 'Payment' : 'Refund'} - {transactionModal.orderNumber}
              </h3>
              <button onClick={closeTransactionModal} style={styles.modalClose}>×</button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={transactionForm.amount}
                  onChange={(e) => setTransactionForm({ ...transactionForm, amount: e.target.value })}
                  style={styles.formInput}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Method</label>
                <select
                  value={transactionForm.method}
                  onChange={(e) => setTransactionForm({ ...transactionForm, method: e.target.value })}
                  style={styles.formSelect}
                >
                  <option value="stripe">Stripe</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Proof Upload - Required for check/wire */}
              {(transactionForm.method === 'check' || transactionForm.method === 'wire') && (
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>
                    {transactionForm.method === 'check' ? 'Check Photo' : 'Wire Transfer Proof'}
                    <span style={{ color: '#c62828', marginLeft: '4px' }}>* (Required)</span>
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setProofFile(file);
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
                    }}
                    style={{ display: 'none' }}
                    id="proof-file-input"
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('proof-file-input')?.click()}
                    style={{
                      ...styles.cancelBtn,
                      backgroundColor: '#1565c0',
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    {proofFile ? 'Change File' : 'Select File'}
                  </button>
                  {proofFile && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#333' }}>
                      <span>{proofFile.name}</span>
                      <span style={{ color: '#666', marginLeft: '8px' }}>
                        ({(proofFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  )}
                  {proofPreview && (
                    <div style={{ marginTop: '8px' }}>
                      <img
                        src={proofPreview}
                        alt="Proof preview"
                        style={{ maxWidth: '150px', borderRadius: '4px', border: '1px solid #ddd' }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Notes - Required for other */}
              {transactionForm.method === 'other' && (
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>
                    Payment Notes
                    <span style={{ color: '#c62828', marginLeft: '4px' }}>* (Required)</span>
                  </label>
                  <textarea
                    value={transactionForm.notes}
                    onChange={(e) => setTransactionForm({ ...transactionForm, notes: e.target.value })}
                    style={{ ...styles.formInput, minHeight: '60px', resize: 'vertical' }}
                    placeholder="Please describe this payment method"
                  />
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Description (optional)</label>
                <input
                  type="text"
                  value={transactionForm.description}
                  onChange={(e) => setTransactionForm({ ...transactionForm, description: e.target.value })}
                  style={styles.formInput}
                  placeholder="e.g., Additional deposit for change order"
                />
              </div>
              <div style={styles.formNote}>
                Transaction will be added and immediately applied to the balance.
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button onClick={closeTransactionModal} style={styles.cancelBtn}>
                Cancel
              </button>
              <button
                onClick={submitTransaction}
                disabled={submittingTransaction || !transactionForm.amount}
                style={{
                  ...styles.submitBtn,
                  backgroundColor: transactionModal.type === 'payment' ? '#2e7d32' : '#c62828',
                  opacity: submittingTransaction || !transactionForm.amount ? 0.6 : 1,
                }}
              >
                {submittingTransaction ? 'Adding...' : `Add ${transactionModal.type === 'payment' ? 'Payment' : 'Refund'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      {approvalModal && (() => {
        const balance = approvalModal.entry?.orderBalance ?? (approvalModal.amount || 0);
        const isRefund = balance < 0;
        const actionLabel = isRefund ? 'Refund' : 'Collect';
        const actionColor = isRefund ? '#1565c0' : '#4caf50';
        return (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modal, maxWidth: '500px' }}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                {actionLabel} Payment - {approvalModal.orderNumber}
              </h3>
              <button onClick={() => {
                setApprovalModal(null);
                setApprovalCode('');
                setApprovalForm({ method: '', notes: '' });
                setApprovalProofFile(null);
                setApprovalProofPreview(null);
              }} style={styles.modalClose}>×</button>
            </div>
            <div style={styles.modalBody}>
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 4px 0', color: '#666', fontSize: '13px' }}>Amount</p>
                <p style={{ margin: '0', fontSize: '20px', fontWeight: 600, color: '#333' }}>
                  {formatCurrency(approvalModal.amount || 0)}
                </p>
                {approvalModal.entry && (
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#999' }}>
                    Entry: {approvalModal.entry.paymentNumber || approvalModal.entry.id}
                  </p>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Payment Method</label>
                <select
                  value={approvalForm.method}
                  onChange={(e) => setApprovalForm({ ...approvalForm, method: e.target.value })}
                  style={styles.formSelect}
                >
                  <option value="">-- Select method --</option>
                  <option value="stripe">Stripe</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="credit_on_file">Credit on File</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Proof Upload - Required for check/wire */}
              {(approvalForm.method === 'check' || approvalForm.method === 'wire') && (
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>
                    {approvalForm.method === 'check' ? 'Check Photo' : 'Wire Transfer Proof'}
                    <span style={{ color: '#c62828', marginLeft: '4px' }}>*</span>
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setApprovalProofFile(file);
                        if (file.type.startsWith('image/')) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setApprovalProofPreview(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        } else {
                          setApprovalProofPreview(null);
                        }
                      }
                    }}
                    style={{ display: 'none' }}
                    id="approval-proof-file-input"
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('approval-proof-file-input')?.click()}
                    style={{
                      ...styles.cancelBtn,
                      backgroundColor: '#1565c0',
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    {approvalProofFile ? 'Change File' : 'Select File'}
                  </button>
                  {approvalProofFile && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#333' }}>
                      <span>{approvalProofFile.name}</span>
                      <span style={{ color: '#666', marginLeft: '8px' }}>
                        ({(approvalProofFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  )}
                  {approvalProofPreview && (
                    <div style={{ marginTop: '8px' }}>
                      <img
                        src={approvalProofPreview}
                        alt="Proof preview"
                        style={{ maxWidth: '150px', borderRadius: '4px', border: '1px solid #ddd' }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Notes {approvalForm.method === 'other' && <span style={{ color: '#c62828' }}>*</span>}</label>
                <textarea
                  value={approvalForm.notes}
                  onChange={(e) => setApprovalForm({ ...approvalForm, notes: e.target.value })}
                  style={{ ...styles.formInput, minHeight: '60px', resize: 'vertical' }}
                  placeholder={isRefund ? 'Describe how the refund was processed' : 'Payment collection details'}
                />
              </div>

              {isManager ? (
                <div style={{ fontSize: '13px', color: '#2e7d32', marginTop: '8px' }}>
                  Approving as {user?.email}
                </div>
              ) : (
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>Manager Approval Code</label>
                  <input
                    type="password"
                    value={approvalCode}
                    onChange={(e) => setApprovalCode(e.target.value)}
                    placeholder="Enter approval code"
                    style={styles.formInput}
                  />
                </div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button
                onClick={() => {
                  setApprovalModal(null);
                  setApprovalCode('');
                  setApprovalForm({ method: '', notes: '' });
                  setApprovalProofFile(null);
                  setApprovalProofPreview(null);
                }}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
              <button
                onClick={handleApprovePayment}
                disabled={approvingPayment || (!isManager && !approvalCode) || !approvalForm.method || (approvalForm.method === 'other' && !approvalForm.notes)}
                style={{
                  ...styles.submitBtn,
                  backgroundColor: actionColor,
                  opacity: approvingPayment || (!isManager && !approvalCode) || !approvalForm.method ? 0.6 : 1,
                }}
              >
                {approvingPayment ? 'Processing...' : actionLabel}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 600,
    color: '#333',
  },
  errorBanner: {
    padding: '12px 16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '8px',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dismissButton: {
    padding: '4px 12px',
    backgroundColor: 'transparent',
    border: '1px solid #c62828',
    borderRadius: '4px',
    color: '#c62828',
    cursor: 'pointer',
    fontSize: '12px',
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    borderBottom: '2px solid #e0e0e0',
    paddingBottom: '0',
  },
  tab: {
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#666',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  tabActive: {
    color: '#1976d2',
    borderBottomColor: '#1976d2',
  },
  content: {
    minHeight: '400px',
  },
  loading: {
    padding: '48px',
    textAlign: 'center' as const,
    color: '#666',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    borderLeft: '4px solid',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#333',
  },
  statLabel: {
    fontSize: '14px',
    color: '#666',
    marginTop: '4px',
  },
  statSubtext: {
    fontSize: '12px',
    color: '#999',
    marginTop: '4px',
  },
  section: {
    backgroundColor: '#fff',
    padding: '24px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    marginBottom: '24px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
  },
  refreshButton: {
    padding: '8px 16px',
    fontSize: '13px',
    color: '#1976d2',
    backgroundColor: '#e3f2fd',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  primaryButton: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#1976d2',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  actionButton: {
    padding: '6px 12px',
    fontSize: '12px',
    color: '#1976d2',
    backgroundColor: '#e3f2fd',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  helpText: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '16px',
  },
  emptyState: {
    padding: '32px',
    textAlign: 'center' as const,
    color: '#999',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    borderBottom: '2px solid #e0e0e0',
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#333',
    borderBottom: '1px solid #f0f0f0',
  },
  orderNumber: {
    fontWeight: 600,
    color: '#1976d2',
  },
  orderNumberLink: {
    fontWeight: 600,
    color: '#1976d2',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  pendingCOBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 500,
    backgroundColor: '#fff3e0',
    color: '#e65100',
    marginLeft: '6px',
  },
  liveCOBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 500,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    marginLeft: '6px',
  },
  coCountBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 500,
    backgroundColor: '#f5f5f5',
    color: '#666',
    marginLeft: '6px',
  },
  reconcileStats: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  reconcileStat: {
    padding: '16px 24px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    borderLeft: '4px solid #2196f3',
    minWidth: '120px',
  },
  reconcileStatValue: {
    display: 'block',
    fontSize: '24px',
    fontWeight: 700,
    color: '#333',
  },
  reconcileStatLabel: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  searchRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '24px',
  },
  searchInput: {
    flex: 1,
    padding: '10px 16px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    maxWidth: '300px',
  },
  expandButton: {
    width: '24px',
    height: '24px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionsCell: {
    padding: 0,
    backgroundColor: '#fafafa',
  },
  transactionsContainer: {
    padding: '16px 24px 16px 48px',
    borderTop: '1px solid #e0e0e0',
  },
  transactionsTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '12px',
  },
  noTransactions: {
    padding: '12px',
    color: '#999',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  transactionsTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
  },
  txTh: {
    padding: '8px',
    textAlign: 'left' as const,
    fontSize: '10px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    borderBottom: '1px solid #e0e0e0',
  },
  txThRight: {
    padding: '8px',
    textAlign: 'right' as const,
    fontSize: '10px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    borderBottom: '1px solid #e0e0e0',
  },
  txTd: {
    padding: '8px',
    borderBottom: '1px solid #f0f0f0',
    color: '#333',
    verticalAlign: 'top' as const,
  },
  txTdRight: {
    padding: '8px',
    borderBottom: '1px solid #f0f0f0',
    textAlign: 'right' as const,
    fontWeight: 600,
    verticalAlign: 'top' as const,
  },
  txTypeBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 600,
  },
  txStatusBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 500,
  },
  txReference: {
    fontSize: '10px',
    color: '#666',
    fontFamily: 'monospace',
  },
  txNotes: {
    fontSize: '11px',
    color: '#666',
    maxWidth: '150px',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  // Order Info Bar styles
  orderInfoBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '12px 16px',
    backgroundColor: '#fff',
    borderRadius: '6px',
    marginBottom: '16px',
    border: '1px solid #e0e0e0',
    flexWrap: 'wrap' as const,
  },
  orderInfoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
  },
  orderInfoLabel: {
    color: '#666',
    fontWeight: 500,
  },
  orderInfoActions: {
    marginLeft: 'auto',
    display: 'flex',
    gap: '8px',
  },
  pdfLink: {
    color: '#1565c0',
    fontWeight: 600,
    textDecoration: 'none',
  },
  recommendedBtn: {
    padding: '6px 14px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  },
  addPaymentBtn: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#2e7d32',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  addRefundBtn: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#c62828',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  // Modal styles
  modalOverlay: {
    position: 'fixed' as const,
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
    backgroundColor: '#fff',
    borderRadius: '8px',
    width: '100%',
    maxWidth: '450px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #e0e0e0',
  },
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#666',
    cursor: 'pointer',
    padding: '0 4px',
  },
  modalBody: {
    padding: '20px',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 20px',
    borderTop: '1px solid #e0e0e0',
    backgroundColor: '#fafafa',
  },
  formGroup: {
    marginBottom: '16px',
  },
  formLabel: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    color: '#333',
    marginBottom: '6px',
  },
  formInput: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box' as const,
  },
  formSelect: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box' as const,
    backgroundColor: '#fff',
  },
  formNote: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
    marginTop: '8px',
  },
  cancelBtn: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#666',
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

export default ManagerPayments;
