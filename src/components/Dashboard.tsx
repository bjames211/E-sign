import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ExtractedDataTable } from './ExtractedDataTable';

interface Document {
  id: string;
  orderNumber?: string;
  fileName: string;
  signer: {
    email: string;
    name: string;
  };
  status: 'pending' | 'processing' | 'sent' | 'signed' | 'error' | 'pending_approval';
  createdAt: Timestamp;
  sentAt?: Timestamp;
  signedAt?: Timestamp;
  error?: string;
  approvalRequired?: boolean;
  approvalReason?: string;
  extractedData?: {
    customerName?: string;
    subtotal?: number;
    downPayment?: number;
    expectedDepositAmount?: number;
    expectedDepositPercent?: number;
    actualDepositPercent?: number;
    depositDiscrepancy?: boolean;
    depositDiscrepancyAmount?: number;
  };
}

const statusColors: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fff3e0', text: '#e65100' },
  processing: { bg: '#e3f2fd', text: '#1565c0' },
  sent: { bg: '#e8f5e9', text: '#2e7d32' },
  signed: { bg: '#c8e6c9', text: '#1b5e20' },
  error: { bg: '#ffebee', text: '#c62828' },
  pending_approval: { bg: '#fff3e0', text: '#f57c00' },
};

const APPROVE_FUNCTION_URL = `${import.meta.env.VITE_FUNCTIONS_URL || ''}/approveAndSend`;

export function Dashboard() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'documents' | 'extracted'>('documents');
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = async (docId: string) => {
    if (!confirm('Are you sure you want to send this document despite the deposit discrepancy?')) {
      return;
    }

    setApprovingId(docId);
    try {
      const response = await fetch(APPROVE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: docId,
          approvedBy: 'user', // Could be enhanced with actual user info
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Approval failed');
      }

      alert('Document approved and sent for signature!');
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, 'esign_documents'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs: Document[] = [];
      snapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() } as Document);
      });
      setDocuments(docs);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const formatDate = (timestamp?: Timestamp | any) => {
    if (!timestamp) return '-';
    try {
      let date: Date;
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      } else if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else if (typeof timestamp === 'number') {
        date = new Date(timestamp);
      } else {
        return '-';
      }
      return date.toLocaleString();
    } catch {
      return '-';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      processing: 'Processing',
      sent: 'Awaiting Signature',
      signed: 'Completed',
      error: 'Error',
      pending_approval: '⚠️ Needs Approval',
    };
    return labels[status] || status;
  };

  return (
    <div style={styles.container}>
      {/* Stats */}
      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{documents.length}</div>
          <div style={styles.statLabel}>Total Documents</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#f57c00' }}>
            {documents.filter((d) => d.status === 'pending_approval').length}
          </div>
          <div style={styles.statLabel}>Needs Approval</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#2e7d32' }}>
            {documents.filter((d) => d.status === 'sent').length}
          </div>
          <div style={styles.statLabel}>Awaiting Signature</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#1b5e20' }}>
            {documents.filter((d) => d.status === 'signed').length}
          </div>
          <div style={styles.statLabel}>Signed</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabContainer}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'documents' ? styles.activeTab : {}),
          }}
          onClick={() => setActiveTab('documents')}
        >
          Document Status
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'extracted' ? styles.activeTab : {}),
          }}
          onClick={() => setActiveTab('extracted')}
        >
          AI Extracted Data
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'documents' ? (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Order #</th>
                <th style={styles.th}>Document</th>
                <th style={styles.th}>Signer</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Sent</th>
                <th style={styles.th}>Signed</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={styles.loading}>
                    Loading documents...
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={styles.empty}>
                    No documents yet. Upload your first PDF to get started.
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={styles.orderNumber}>{doc.orderNumber || '-'}</div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.fileName}>{doc.fileName}</div>
                      <div style={styles.docId}>{doc.id}</div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.signerName}>{doc.signer.name}</div>
                      <div style={styles.signerEmail}>{doc.signer.email}</div>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          backgroundColor: statusColors[doc.status]?.bg || '#f5f5f5',
                          color: statusColors[doc.status]?.text || '#333',
                        }}
                      >
                        {getStatusLabel(doc.status)}
                      </span>
                      {doc.error && (
                        <div style={styles.errorText}>{doc.error}</div>
                      )}
                      {doc.status === 'pending_approval' && (
                        <div style={styles.approvalBox}>
                          <div style={styles.approvalWarning}>
                            Deposit discrepancy detected
                          </div>
                          {doc.extractedData && (
                            <div style={styles.approvalDetails}>
                              <div>Expected: ${doc.extractedData.expectedDepositAmount} ({doc.extractedData.expectedDepositPercent}%)</div>
                              <div>Actual: ${doc.extractedData.downPayment} ({doc.extractedData.actualDepositPercent}%)</div>
                              <div style={styles.discrepancyAmount}>
                                Difference: ${doc.extractedData.depositDiscrepancyAmount}
                              </div>
                            </div>
                          )}
                          <button
                            style={styles.approveButton}
                            onClick={() => handleApprove(doc.id)}
                            disabled={approvingId === doc.id}
                          >
                            {approvingId === doc.id ? 'Sending...' : 'Send Anyway'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>{formatDate(doc.createdAt)}</td>
                    <td style={styles.td}>{formatDate(doc.sentAt)}</td>
                    <td style={styles.td}>{formatDate(doc.signedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <ExtractedDataTable />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 30,
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 20,
    marginBottom: 30,
  },
  statCard: {
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  statValue: {
    fontSize: 36,
    fontWeight: 700,
    color: '#2196F3',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 14,
    color: '#666',
  },
  tabContainer: {
    display: 'flex',
    gap: 0,
    marginBottom: 0,
  },
  tab: {
    padding: '14px 24px',
    fontSize: 14,
    fontWeight: 600,
    color: '#666',
    backgroundColor: '#f5f5f5',
    border: 'none',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  activeTab: {
    backgroundColor: '#fff',
    color: '#2196F3',
    boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
  },
  tableContainer: {
    backgroundColor: '#fff',
    borderRadius: '0 12px 12px 12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    padding: '14px 20px',
    textAlign: 'left' as const,
    fontSize: 12,
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#fafafa',
  },
  tr: {
    borderBottom: '1px solid #f0f0f0',
  },
  td: {
    padding: '16px 20px',
    fontSize: 14,
    color: '#333',
    verticalAlign: 'top' as const,
  },
  orderNumber: {
    fontWeight: 600,
    color: '#2196F3',
    fontFamily: 'monospace',
  },
  fileName: {
    fontWeight: 500,
    marginBottom: 4,
  },
  docId: {
    fontSize: 11,
    color: '#999',
    fontFamily: 'monospace',
  },
  signerName: {
    fontWeight: 500,
  },
  signerEmail: {
    marginTop: 2,
    fontSize: 13,
    color: '#666',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 12,
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: '#c62828',
    maxWidth: 200,
  },
  loading: {
    padding: 40,
    textAlign: 'center' as const,
    color: '#666',
  },
  empty: {
    padding: 40,
    textAlign: 'center' as const,
    color: '#999',
  },
  approvalBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#fff8e1',
    borderRadius: 8,
    border: '1px solid #ffcc02',
  },
  approvalWarning: {
    fontWeight: 600,
    color: '#e65100',
    fontSize: 13,
    marginBottom: 8,
  },
  approvalDetails: {
    fontSize: 12,
    color: '#666',
    lineHeight: 1.6,
  },
  discrepancyAmount: {
    fontWeight: 600,
    color: '#c62828',
    marginTop: 4,
  },
  approveButton: {
    marginTop: 10,
    padding: '8px 16px',
    backgroundColor: '#f57c00',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
};
