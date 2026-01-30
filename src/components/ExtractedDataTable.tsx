import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

interface ExtractedData {
  id: string;
  documentId: string;
  orderNumber?: string;
  fileName: string;
  installer: string;
  customerName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  phone: string | null;
  subtotal: number | null;
  downPayment: number | null;
  balanceDue: number | null;
  // Deposit validation fields
  expectedDepositPercent: number | null;
  expectedDepositAmount: number | null;
  actualDepositPercent: number | null;
  depositDiscrepancy: boolean;
  depositDiscrepancyAmount: number | null;
  createdAt: Timestamp;
}

export function ExtractedDataTable() {
  const [extractedData, setExtractedData] = useState<ExtractedData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'extracted_pdf_data'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: ExtractedData[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as ExtractedData);
      });
      setExtractedData(data);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

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

  return (
    <div style={styles.tableContainer}>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Order #</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Address</th>
              <th style={styles.th}>Contact</th>
              <th style={styles.th}>Subtotal</th>
              <th style={styles.th}>Down Payment</th>
              <th style={styles.th}>Expected</th>
              <th style={styles.th}>Deposit Check</th>
              <th style={styles.th}>Balance Due</th>
              <th style={styles.th}>Extracted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={styles.loading}>
                  Loading extracted data...
                </td>
              </tr>
            ) : extractedData.length === 0 ? (
              <tr>
                <td colSpan={10} style={styles.empty}>
                  No extracted data yet. Upload a PDF to see AI-extracted information here.
                </td>
              </tr>
            ) : (
              extractedData.map((data) => (
                <tr key={data.id} style={styles.tr}>
                  <td style={styles.td}>
                    <div style={styles.orderNumber}>{data.orderNumber || '-'}</div>
                    <div style={styles.installer}>{data.installer || '-'}</div>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.customerName}>{data.customerName || '-'}</div>
                  </td>
                  <td style={styles.td}>
                    <div>{data.address || '-'}</div>
                    <div style={styles.cityState}>
                      {[data.city, data.state, data.zip].filter(Boolean).join(', ') || '-'}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.email}>{data.email || '-'}</div>
                    <div style={styles.phone}>{data.phone || '-'}</div>
                  </td>
                  <td style={styles.tdMoney}>
                    <span style={styles.money}>{formatCurrency(data.subtotal)}</span>
                  </td>
                  <td style={styles.tdMoney}>
                    <span style={styles.money}>{formatCurrency(data.downPayment)}</span>
                    {data.actualDepositPercent && (
                      <div style={styles.percent}>{data.actualDepositPercent}%</div>
                    )}
                  </td>
                  <td style={styles.tdMoney}>
                    <span style={styles.money}>{formatCurrency(data.expectedDepositAmount)}</span>
                    {data.expectedDepositPercent && (
                      <div style={styles.percent}>{data.expectedDepositPercent}%</div>
                    )}
                  </td>
                  <td style={styles.td}>
                    {data.depositDiscrepancy ? (
                      <div style={styles.discrepancyBad}>
                        ⚠️ OFF
                        <div style={styles.discrepancyAmount}>
                          {data.depositDiscrepancyAmount && data.depositDiscrepancyAmount > 0 ? '+' : ''}
                          {formatCurrency(data.depositDiscrepancyAmount)}
                        </div>
                      </div>
                    ) : data.expectedDepositAmount ? (
                      <div style={styles.discrepancyOk}>✓ OK</div>
                    ) : (
                      <span style={styles.noData}>-</span>
                    )}
                  </td>
                  <td style={styles.tdMoney}>
                    <span style={{ ...styles.money, ...styles.balanceDue }}>
                      {formatCurrency(data.balanceDue)}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.date}>{formatDate(data.createdAt)}</div>
                  </td>
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
  tableContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    overflow: 'hidden',
    marginTop: 30,
  },
  tableHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#f8f9ff',
  },
  tableTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#333',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    display: 'block',
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    minWidth: 900,
  },
  th: {
    padding: '14px 16px',
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#fafafa',
    whiteSpace: 'nowrap' as const,
  },
  tr: {
    borderBottom: '1px solid #f0f0f0',
  },
  td: {
    padding: '14px 16px',
    fontSize: 13,
    color: '#333',
    verticalAlign: 'top' as const,
  },
  tdMoney: {
    padding: '14px 16px',
    fontSize: 13,
    color: '#333',
    verticalAlign: 'top' as const,
    textAlign: 'right' as const,
  },
  orderNumber: {
    fontWeight: 600,
    color: '#2196F3',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  fileName: {
    fontWeight: 500,
    fontSize: 13,
    marginBottom: 2,
  },
  installer: {
    fontSize: 11,
    color: '#888',
  },
  customerName: {
    fontWeight: 500,
  },
  cityState: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  email: {
    fontSize: 12,
    color: '#1976d2',
  },
  phone: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  money: {
    fontFamily: 'monospace',
    fontWeight: 500,
  },
  balanceDue: {
    color: '#c62828',
    fontWeight: 600,
  },
  percent: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  discrepancyOk: {
    color: '#2e7d32',
    fontWeight: 600,
    fontSize: 13,
  },
  discrepancyBad: {
    color: '#c62828',
    fontWeight: 600,
    fontSize: 13,
  },
  discrepancyAmount: {
    fontSize: 11,
    marginTop: 2,
  },
  noData: {
    color: '#999',
  },
  date: {
    fontSize: 12,
    color: '#666',
    whiteSpace: 'nowrap' as const,
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
