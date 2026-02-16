import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Order } from '../../types/order';
import { ChangeOrder } from '../../types/changeOrder';
import { PaymentLedgerEntry } from '../../types/payment';

interface EsignDocument {
  id: string;
  orderNumber: string;
  changeOrderId?: string;
  changeOrderNumber?: string;
  status: 'processing' | 'sent' | 'signed' | 'cancelled' | 'error';
  signer: {
    email: string;
    name: string;
  };
  createdAt?: Timestamp;
  sentAt?: Timestamp;
  signedAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelledReason?: string;
  signNowDocumentId?: string;
}

interface InteractionItem {
  id: string;
  type: 'esign' | 'payment' | 'change_order';
  timestamp: Timestamp;
  title: string;
  description: string;
  status: string;
  statusColor: string;
  details?: Record<string, string>;
}

interface OrderInteractionHistoryProps {
  order: Order;
  changeOrders: ChangeOrder[];
}

function formatTimestamp(timestamp: Timestamp | any | undefined): string {
  if (!timestamp) return '-';

  try {
    let date: Date;

    // Handle Firestore Timestamp object
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    }
    // Handle plain object with seconds (from Firestore)
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

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (err) {
    console.error('Error formatting timestamp:', err);
    return '-';
  }
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  sent: { bg: '#e3f2fd', color: '#1565c0' },
  signed: { bg: '#e8f5e9', color: '#2e7d32' },
  cancelled: { bg: '#ffebee', color: '#c62828' },
  error: { bg: '#ffebee', color: '#c62828' },
  processing: { bg: '#fff3e0', color: '#e65100' },
  draft: { bg: '#fff3e0', color: '#e65100' },
  pending_signature: { bg: '#e3f2fd', color: '#1565c0' },
  paid: { bg: '#e8f5e9', color: '#2e7d32' },
  pending: { bg: '#fff3e0', color: '#e65100' },
  manually_approved: { bg: '#e8f5e9', color: '#2e7d32' },
};

export function OrderInteractionHistory({ order, changeOrders }: OrderInteractionHistoryProps) {
  const [esignDocs, setEsignDocs] = useState<EsignDocument[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [order.id]);

  const loadData = async () => {
    if (!order.id) return;
    setLoading(true);
    await Promise.all([loadEsignDocuments(), loadPaymentRecords()]);
    setLoading(false);
  };

  const loadPaymentRecords = async () => {
    if (!order.id) return;
    try {
      const q = query(
        collection(db, 'payment_ledger'),
        where('orderId', '==', order.id)
      );
      const snapshot = await getDocs(q);
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as PaymentLedgerEntry[];
      // Sort by createdAt descending
      const getTime = (ts: any): number => {
        if (!ts) return 0;
        if (ts.toMillis && typeof ts.toMillis === 'function') return ts.toMillis();
        if (ts.seconds) return ts.seconds * 1000;
        return 0;
      };
      records.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
      setPaymentRecords(records);
    } catch (err) {
      console.error('Failed to load payment records:', err);
      setPaymentRecords([]);
    }
  };

  const loadEsignDocuments = async () => {
    if (!order.id) return;

    try {
      // Query all esign documents for this order (without orderBy to avoid index requirement)
      const q = query(
        collection(db, 'esign_documents'),
        where('orderId', '==', order.id)
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as EsignDocument[];
      // Sort client-side instead - use safe timestamp extraction
      const getTime = (ts: any): number => {
        if (!ts) return 0;
        if (ts.toMillis && typeof ts.toMillis === 'function') return ts.toMillis();
        if (ts.seconds) return ts.seconds * 1000;
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return 0;
      };
      docs.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
      setEsignDocs(docs);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load esign documents:', err);
      // Don't block the whole component, just show empty esign docs
      setEsignDocs([]);
      setError(null); // Clear error so timeline still shows change orders/payments
    }
  };

  // Build unified interaction timeline
  const buildInteractionTimeline = (): InteractionItem[] => {
    const items: InteractionItem[] = [];

    try {
      // Add esign documents
      for (const doc of esignDocs) {
        if (!doc) continue;
        const statusColors = STATUS_COLORS[doc.status] || { bg: '#f5f5f5', color: '#666' };
        items.push({
          id: `esign-${doc.id}`,
          type: 'esign',
          timestamp: doc.signedAt || doc.cancelledAt || doc.sentAt || doc.createdAt || Timestamp.now(),
          title: doc.changeOrderNumber
            ? `Signature: ${doc.changeOrderNumber}`
            : `Signature: ${doc.orderNumber || 'Order'}`,
          description: doc.changeOrderNumber
            ? `Change order sent to ${doc.signer?.name || 'customer'}`
            : `Order sent to ${doc.signer?.name || 'customer'}`,
          status: doc.status === 'sent' ? 'Awaiting Signature' :
                  doc.status === 'signed' ? 'Signed' :
                  doc.status === 'cancelled' ? 'Cancelled' :
                  doc.status === 'error' ? 'Error' : 'Processing',
          statusColor: statusColors.color,
          details: {
            'Signer': `${doc.signer?.name || 'Unknown'} (${doc.signer?.email || 'Unknown'})`,
            ...(doc.sentAt && { 'Sent': formatTimestamp(doc.sentAt) }),
            ...(doc.signedAt && { 'Signed': formatTimestamp(doc.signedAt) }),
            ...(doc.cancelledAt && { 'Cancelled': formatTimestamp(doc.cancelledAt) }),
            ...(doc.cancelledReason && { 'Reason': doc.cancelledReason }),
          },
        });
      }

    // Add change orders
    for (const co of changeOrders) {
      if (!co) continue;
      const statusColors = STATUS_COLORS[co.status] || { bg: '#f5f5f5', color: '#666' };
      const statusLabel = co.status === 'draft' ? 'Draft' :
                          co.status === 'pending_signature' ? 'Awaiting Signature' :
                          co.status === 'signed' ? 'Signed' :
                          co.status === 'cancelled' ? 'Cancelled' : co.status;
      items.push({
        id: `co-${co.id}`,
        type: 'change_order',
        timestamp: co.signedAt || co.cancelledAt || co.createdAt || Timestamp.now(),
        title: `Change Order: ${co.changeOrderNumber || 'Unknown'}`,
        description: co.reason || 'No reason provided',
        status: statusLabel,
        statusColor: statusColors.color,
        details: {
          'Total Change': `$${(co.differences?.totalDiff || 0).toLocaleString()}`,
          'Deposit Change': `$${(co.differences?.depositDiff || 0).toLocaleString()}`,
          'Created': formatTimestamp(co.createdAt),
          ...(co.signedAt && { 'Signed': formatTimestamp(co.signedAt) }),
          ...(co.cancelledAt && { 'Cancelled': formatTimestamp(co.cancelledAt) }),
          ...(co.cancelledReason && { 'Reason': co.cancelledReason }),
        },
      });
    }

    // Add order lifecycle events
    // Order created
    if (order.createdAt) {
      items.push({
        id: 'order-created',
        type: 'payment', // Using payment type for styling
        timestamp: order.createdAt,
        title: 'Order Created',
        description: `${order.orderNumber} created`,
        status: 'Created',
        statusColor: '#666',
        details: {
          'Order Number': order.orderNumber,
          'Customer': `${order.customer.firstName} ${order.customer.lastName}`,
          'Total': `$${order.pricing.subtotalBeforeTax.toLocaleString()}`,
          'Deposit': `$${order.pricing.deposit.toLocaleString()}`,
        },
      });
    }

    // Order sent for signature
    if ((order as any).sentForSignatureAt) {
      items.push({
        id: 'order-sent',
        type: 'esign',
        timestamp: (order as any).sentForSignatureAt,
        title: 'Order Sent for Signature',
        description: `Sent to ${order.customer.email}`,
        status: 'Sent',
        statusColor: STATUS_COLORS.sent.color,
        details: {
          'Sent To': `${order.customer.firstName} ${order.customer.lastName}`,
          'Email': order.customer.email,
        },
      });
    }

    // Order signed
    if ((order as any).signedAt) {
      items.push({
        id: 'order-signed',
        type: 'esign',
        timestamp: (order as any).signedAt,
        title: 'Order Signed',
        description: `Signed by ${order.customer.firstName} ${order.customer.lastName}`,
        status: 'Signed',
        statusColor: STATUS_COLORS.signed.color,
        details: {
          'Signed By': `${order.customer.firstName} ${order.customer.lastName}`,
        },
      });
    }

    // Ready for manufacturer
    if ((order as any).readyForManufacturerAt) {
      items.push({
        id: 'order-ready',
        type: 'payment',
        timestamp: (order as any).readyForManufacturerAt,
        title: 'Ready for Manufacturer',
        description: 'Order completed and ready to send',
        status: 'Complete',
        statusColor: STATUS_COLORS.signed.color,
        details: {},
      });
    }

    // Add payment events
    if (order.payment) {
      const paymentStatusColors = STATUS_COLORS[order.payment.status || 'pending'] || { bg: '#f5f5f5', color: '#666' };
      const paymentStatusLabel = order.payment.status === 'paid' ? 'Paid' :
                                  order.payment.status === 'manually_approved' ? 'Approved' :
                                  order.payment.status === 'pending' ? 'Pending' : order.payment.status || 'Unknown';

      // Use test payment amount if available, otherwise use deposit
      const paymentAmount = order.testPaymentAmount ?? order.pricing.deposit;

      items.push({
        id: 'payment-main',
        type: 'payment',
        timestamp: (order as any).paidAt || order.createdAt || Timestamp.now(),
        title: `Payment: ${order.payment.type?.replace(/_/g, ' ').toUpperCase() || 'Unknown'}`,
        description: `Amount: $${paymentAmount.toLocaleString()}`,
        status: paymentStatusLabel,
        statusColor: paymentStatusColors.color,
        details: {
          'Type': order.payment.type?.replace(/_/g, ' ') || 'Unknown',
          'Amount': `$${paymentAmount.toLocaleString()}`,
          'Status': paymentStatusLabel,
          ...(order.payment.stripePaymentId && { 'Stripe ID': order.payment.stripePaymentId }),
          ...(order.payment.notes && { 'Notes': order.payment.notes }),
        },
      });

      // Add manual approval event if exists
      if (order.payment.manualApproval) {
        items.push({
          id: 'payment-approval',
          type: 'payment',
          timestamp: order.payment.manualApproval.approvedAt || Timestamp.now(),
          title: 'Payment Manually Approved',
          description: `Approved by ${order.payment.manualApproval.approvedBy || 'Manager'}`,
          status: 'Approved',
          statusColor: STATUS_COLORS.paid.color,
          details: {
            'Approved By': order.payment.manualApproval.approvedBy || 'Unknown',
            'Date': formatTimestamp(order.payment.manualApproval.approvedAt),
            ...(order.payment.manualApproval.notes && { 'Notes': order.payment.manualApproval.notes }),
          },
        });
      }
    }

    // Add payment records from payment_ledger
    for (const record of paymentRecords) {
      if (record.status === 'voided') continue; // Skip voided entries
      const statusLabel = record.status === 'approved' || record.status === 'verified' ? 'Paid' :
                          record.status === 'pending' ? 'Pending' : record.status;
      const statusColors = STATUS_COLORS[record.status === 'approved' || record.status === 'verified' ? 'paid' : record.status] || { bg: '#f5f5f5', color: '#666' };
      const typeLabel = record.transactionType === 'refund' ? 'Refund' : 'Payment';

      items.push({
        id: `payment-record-${record.id}`,
        type: 'payment',
        timestamp: record.createdAt || Timestamp.now(),
        title: `${typeLabel}: ${record.category?.replace(/_/g, ' ').toUpperCase() || 'PAYMENT'}`,
        description: `Amount: $${record.amount.toLocaleString()}${record.paymentNumber ? ` (${record.paymentNumber})` : ''}`,
        status: statusLabel,
        statusColor: statusColors.color,
        details: {
          'Amount': `$${record.amount.toLocaleString()}`,
          'Method': record.method?.replace(/_/g, ' ') || 'Unknown',
          'Type': record.transactionType || 'payment',
          'Status': statusLabel,
          ...(record.paymentNumber && { 'Payment #': record.paymentNumber }),
          ...(record.stripePaymentId && { 'Stripe ID': record.stripePaymentId }),
          ...(record.approvedBy && { 'Approved By': record.approvedBy }),
          ...(record.description && { 'Description': record.description }),
        },
      });
    }

    // Sort by timestamp descending (most recent first)
    items.sort((a, b) => {
      const getTime = (ts: any): number => {
        if (!ts) return 0;
        if (ts.toMillis && typeof ts.toMillis === 'function') return ts.toMillis();
        if (ts.seconds) return ts.seconds * 1000;
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return 0;
      };
      return getTime(b.timestamp) - getTime(a.timestamp);
    });

    } catch (err) {
      console.error('Error building interaction timeline:', err);
    }

    return items;
  };

  const timeline = buildInteractionTimeline();

  if (loading) {
    return <div style={styles.loading}>Loading interaction history...</div>;
  }

  if (error) {
    return <div style={styles.error}>Error: {error}</div>;
  }

  if (timeline.length === 0) {
    return <div style={styles.empty}>No interaction history yet</div>;
  }

  return (
    <div style={styles.container}>
      <h4 style={styles.title}>Interaction History</h4>
      <div style={styles.timeline}>
        {timeline.map((item, index) => (
          <div key={item.id} style={styles.timelineItem}>
            <div style={styles.timelineDot}>
              <span style={{
                ...styles.dot,
                backgroundColor: item.statusColor,
              }} />
              {index < timeline.length - 1 && <div style={styles.timelineLine} />}
            </div>
            <div style={styles.timelineContent}>
              <div style={styles.timelineHeader}>
                <span style={styles.timelineTitle}>{item.title}</span>
                <span style={{
                  ...styles.timelineStatus,
                  color: item.statusColor,
                  backgroundColor: STATUS_COLORS[item.status.toLowerCase().replace(' ', '_')]?.bg || '#f5f5f5',
                }}>
                  {item.status}
                </span>
              </div>
              <div style={styles.timelineDescription}>{item.description}</div>
              <div style={styles.timelineTime}>
                {formatTimestamp(item.timestamp)}
              </div>
              {item.details && Object.keys(item.details).length > 0 && (
                <div style={styles.timelineDetails}>
                  {Object.entries(item.details).map(([key, value]) => (
                    <div key={key} style={styles.detailRow}>
                      <span style={styles.detailLabel}>{key}:</span>
                      <span style={styles.detailValue}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #e0e0e0',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#1565c0',
    margin: '0 0 16px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  loading: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  },
  error: {
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '6px',
    fontSize: '13px',
  },
  empty: {
    padding: '20px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
  },
  timelineItem: {
    display: 'flex',
    gap: '12px',
    minHeight: '80px',
  },
  timelineDot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '20px',
  },
  dot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  timelineLine: {
    width: '2px',
    flexGrow: 1,
    backgroundColor: '#e0e0e0',
    marginTop: '4px',
  },
  timelineContent: {
    flex: 1,
    paddingBottom: '16px',
  },
  timelineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  timelineTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  timelineStatus: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: '10px',
  },
  timelineDescription: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '4px',
  },
  timelineTime: {
    fontSize: '12px',
    color: '#999',
    marginBottom: '8px',
  },
  timelineDetails: {
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    padding: '10px 12px',
    marginTop: '8px',
  },
  detailRow: {
    display: 'flex',
    gap: '8px',
    fontSize: '12px',
    marginBottom: '4px',
  },
  detailLabel: {
    color: '#666',
    fontWeight: 500,
    minWidth: '80px',
  },
  detailValue: {
    color: '#333',
    wordBreak: 'break-word',
  },
};

export default OrderInteractionHistory;
