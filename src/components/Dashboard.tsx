import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

interface Document {
  id: string;
  fileName: string;
  signer: {
    email: string;
    name: string;
  };
  status: 'pending' | 'processing' | 'sent' | 'signed' | 'error';
  createdAt: Timestamp;
  sentAt?: Timestamp;
  signedAt?: Timestamp;
  error?: string;
}

const statusColors: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fff3e0', text: '#e65100' },
  processing: { bg: '#e3f2fd', text: '#1565c0' },
  sent: { bg: '#e8f5e9', text: '#2e7d32' },
  signed: { bg: '#c8e6c9', text: '#1b5e20' },
  error: { bg: '#ffebee', text: '#c62828' },
};

export function Dashboard() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

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

  const formatDate = (timestamp?: Timestamp) => {
    if (!timestamp) return '-';
    return timestamp.toDate().toLocaleString();
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      processing: 'Processing',
      sent: 'Awaiting Signature',
      signed: 'Completed',
      error: 'Error',
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
          <div style={{ ...styles.statValue, color: '#e65100' }}>
            {documents.filter((d) => d.status === 'pending' || d.status === 'processing').length}
          </div>
          <div style={styles.statLabel}>Processing</div>
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

      {/* Documents Table */}
      <div style={styles.tableContainer}>
        <div style={styles.tableHeader}>
          <h2 style={styles.tableTitle}>Document Status</h2>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>
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
                <td colSpan={6} style={styles.loading}>
                  Loading documents...
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={6} style={styles.empty}>
                  No documents yet. Upload your first PDF to get started.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} style={styles.tr}>
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
  tableContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  tableHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid #e0e0e0',
  },
  tableTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#333',
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
};
