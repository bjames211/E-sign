import React from 'react';
import { ChangeOrder, ChangeOrderStatus } from '../../types/changeOrder';
import { Timestamp } from 'firebase/firestore';

interface ChangeOrderHistoryProps {
  changeOrders: ChangeOrder[];
  onEditChangeOrder?: (changeOrder: ChangeOrder) => void;
}

const STATUS_STYLES: Record<ChangeOrderStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: '#fff3e0', color: '#e65100', label: 'Draft' },
  pending_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  cancelled: { bg: '#f5f5f5', color: '#999', label: 'Cancelled' },
};

function formatDate(timestamp: Timestamp | any | undefined): string {
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
}

function formatCurrency(value: number): string {
  if (value === 0) return '$0';
  const sign = value > 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toLocaleString()}`;
}

// Dynamic style function for change values
const getChangeValueStyle = (value: number): React.CSSProperties => ({
  fontWeight: 600,
  color: value === 0 ? '#666' : value > 0 ? '#2e7d32' : '#c62828',
});

export function ChangeOrderHistory({ changeOrders, onEditChangeOrder }: ChangeOrderHistoryProps) {
  if (changeOrders.length === 0) {
    return (
      <div style={styles.empty}>
        No change orders yet
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {changeOrders.map((co) => {
        const statusStyle = STATUS_STYLES[co.status];
        const isDraft = co.status === 'draft';
        const isCancelled = co.status === 'cancelled';

        return (
          <div
            key={co.id}
            style={{
              ...styles.card,
              ...(isCancelled ? styles.cardCancelled : {}),
            }}
          >
            <div style={styles.cardHeader}>
              <div style={styles.headerLeft}>
                <span style={styles.changeOrderNumber}>{co.changeOrderNumber}</span>
                <span
                  style={{
                    ...styles.statusBadge,
                    backgroundColor: statusStyle.bg,
                    color: statusStyle.color,
                  }}
                >
                  {statusStyle.label}
                </span>
              </div>
              {isDraft && onEditChangeOrder && (
                <button
                  onClick={() => onEditChangeOrder(co)}
                  style={styles.editButton}
                >
                  Edit
                </button>
              )}
            </div>

            <div style={styles.reason}>
              {co.reason || 'No reason provided'}
            </div>

            <div style={styles.changes}>
              <div style={styles.changeRow}>
                <span style={styles.changeLabel}>Total Change:</span>
                <span style={getChangeValueStyle(co.differences.totalDiff)}>
                  {formatCurrency(co.differences.totalDiff)}
                </span>
              </div>
              <div style={styles.changeRow}>
                <span style={styles.changeLabel}>Deposit Change:</span>
                <span style={getChangeValueStyle(co.differences.depositDiff)}>
                  {formatCurrency(co.differences.depositDiff)}
                </span>
              </div>
            </div>

            {/* New Values */}
            <div style={styles.newValues}>
              <span style={styles.newValuesLabel}>New Values:</span>
              <span style={styles.newValuesText}>
                Subtotal: ${co.newValues.subtotalBeforeTax.toLocaleString()} |
                Deposit: ${co.newValues.deposit.toLocaleString()}
              </span>
            </div>

            {/* Cumulative from original */}
            {co.cumulativeFromOriginal && (
              <div style={styles.cumulative}>
                <span style={styles.cumulativeLabel}>From Original:</span>
                <span style={getChangeValueStyle(co.cumulativeFromOriginal.depositDiff)}>
                  Deposit {formatCurrency(co.cumulativeFromOriginal.depositDiff)}
                </span>
              </div>
            )}

            {/* Change Summary - show customer and building changes */}
            {((co.customerChanges && co.customerChanges.length > 0) ||
              (co.buildingChanges && co.buildingChanges.length > 0) ||
              co.differences.subtotalDiff !== 0 ||
              co.differences.depositDiff !== 0) && (
              <div style={styles.changeSummary}>
                <div style={styles.changeSummaryTitle}>CHANGE SUMMARY</div>
                <ul style={styles.changeSummaryList}>
                  {/* Customer changes */}
                  {co.customerChanges?.map((change, idx) => (
                    <li key={`customer-${idx}`} style={styles.changeSummaryItem}>
                      <strong>Customer:</strong> {change.fieldLabel} changed from "{change.oldValue || '(empty)'}" → "{change.newValue || '(empty)'}"
                    </li>
                  ))}
                  {/* Building changes */}
                  {co.buildingChanges?.map((change, idx) => (
                    <li key={`building-${idx}`} style={styles.changeSummaryItem}>
                      <strong>Building:</strong> {change.fieldLabel} changed from "{change.oldValue || '(empty)'}" → "{change.newValue || '(empty)'}"
                    </li>
                  ))}
                  {/* Pricing changes */}
                  {co.differences.subtotalDiff !== 0 && (
                    <li style={styles.changeSummaryItem}>
                      <strong>Pricing:</strong> Subtotal changed from "${co.previousValues.subtotalBeforeTax.toLocaleString()}" → "${co.newValues.subtotalBeforeTax.toLocaleString()}"
                    </li>
                  )}
                  {co.differences.depositDiff !== 0 && (
                    <li style={styles.changeSummaryItem}>
                      <strong>Pricing:</strong> Deposit changed from "${co.previousValues.deposit.toLocaleString()}" → "${co.newValues.deposit.toLocaleString()}"
                    </li>
                  )}
                  {co.differences.extraMoneyFluffDiff !== 0 && (
                    <li style={styles.changeSummaryItem}>
                      <strong>Pricing:</strong> Extra/Fluff changed from "${co.previousValues.extraMoneyFluff.toLocaleString()}" → "${co.newValues.extraMoneyFluff.toLocaleString()}"
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div style={styles.cardFooter}>
              <span style={styles.date}>
                Created: {formatDate(co.createdAt)}
              </span>
              {co.signedAt && (
                <span style={styles.date}>
                  Signed: {formatDate(co.signedAt)}
                </span>
              )}
              {co.cancelledAt && (
                <span style={styles.date}>
                  Cancelled: {formatDate(co.cancelledAt)}
                </span>
              )}
            </div>

            {isCancelled && co.cancelledReason && (
              <div style={styles.cancelledReason}>
                Reason: {co.cancelledReason}
              </div>
            )}

            {/* Files Section - Show both old and new */}
            {(co.previousFiles || co.files) && (
              <div style={styles.filesSection}>
                {/* Previous Files (Original) */}
                {co.previousFiles && (co.previousFiles.orderFormPdf ||
                  co.previousFiles.renderings?.length > 0 ||
                  co.previousFiles.extraFiles?.length > 0 ||
                  co.previousFiles.installerFiles?.length > 0) && (
                  <div style={styles.filesGroup}>
                    <div style={styles.filesGroupTitle}>Original Files</div>
                    <div style={styles.filesList}>
                      {co.previousFiles.orderFormPdf && (
                        <a
                          href={co.previousFiles.orderFormPdf.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLink}
                        >
                          📄 {co.previousFiles.orderFormPdf.name}
                        </a>
                      )}
                      {co.previousFiles.renderings?.map((file, i) => (
                        <a
                          key={`prev-render-${i}`}
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLink}
                        >
                          🖼️ {file.name}
                        </a>
                      ))}
                      {co.previousFiles.extraFiles?.map((file, i) => (
                        <a
                          key={`prev-extra-${i}`}
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLink}
                        >
                          📎 {file.name}
                        </a>
                      ))}
                      {co.previousFiles.installerFiles?.map((file, i) => (
                        <a
                          key={`prev-installer-${i}`}
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLink}
                        >
                          🔧 {file.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* New Files (Change Order) */}
                {co.files && (co.files.orderFormPdf ||
                  co.files.renderings?.length > 0 ||
                  co.files.extraFiles?.length > 0 ||
                  co.files.installerFiles?.length > 0) && (
                  <div style={styles.filesGroup}>
                    <div style={styles.filesGroupTitleNew}>New Files</div>
                    <div style={styles.filesList}>
                      {co.files.orderFormPdf && (
                        <a
                          href={co.files.orderFormPdf.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLinkNew}
                        >
                          📄 {co.files.orderFormPdf.name}
                        </a>
                      )}
                      {co.files.renderings?.map((file, i) => (
                        <a
                          key={`new-render-${i}`}
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLinkNew}
                        >
                          🖼️ {file.name}
                        </a>
                      ))}
                      {co.files.extraFiles?.map((file, i) => (
                        <a
                          key={`new-extra-${i}`}
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLinkNew}
                        >
                          📎 {file.name}
                        </a>
                      ))}
                      {co.files.installerFiles?.map((file, i) => (
                        <a
                          key={`new-installer-${i}`}
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLinkNew}
                        >
                          🔧 {file.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: '#999',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    fontSize: '14px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #eee',
  },
  cardCancelled: {
    opacity: 0.6,
    backgroundColor: '#fafafa',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  changeOrderNumber: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#1565c0',
  },
  statusBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '3px 8px',
    borderRadius: '10px',
  },
  editButton: {
    padding: '6px 12px',
    backgroundColor: 'white',
    color: '#1565c0',
    border: '1px solid #1565c0',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  reason: {
    fontSize: '14px',
    color: '#333',
    marginBottom: '12px',
    padding: '10px',
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    fontStyle: 'italic',
  },
  changes: {
    display: 'flex',
    gap: '24px',
    marginBottom: '10px',
  },
  changeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
  },
  changeLabel: {
    color: '#666',
  },
  newValues: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    marginBottom: '8px',
  },
  newValuesLabel: {
    color: '#999',
  },
  newValuesText: {
    color: '#666',
  },
  cumulative: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    padding: '6px 10px',
    backgroundColor: '#f0f7ff',
    borderRadius: '4px',
    marginBottom: '10px',
  },
  cumulativeLabel: {
    color: '#1565c0',
  },
  cardFooter: {
    display: 'flex',
    gap: '16px',
    paddingTop: '10px',
    borderTop: '1px solid #eee',
  },
  date: {
    fontSize: '11px',
    color: '#999',
  },
  cancelledReason: {
    fontSize: '12px',
    color: '#999',
    marginTop: '8px',
    fontStyle: 'italic',
  },
  changeSummary: {
    backgroundColor: '#e8f5e9',
    borderRadius: '8px',
    padding: '14px 16px',
    marginBottom: '12px',
    border: '1px solid #a5d6a7',
  },
  changeSummaryTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#2e7d32',
    marginBottom: '10px',
    letterSpacing: '0.5px',
  },
  changeSummaryList: {
    margin: 0,
    paddingLeft: '20px',
  },
  changeSummaryItem: {
    fontSize: '14px',
    color: '#333',
    marginBottom: '6px',
    lineHeight: 1.5,
  },
  filesSection: {
    display: 'flex',
    gap: '16px',
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #eee',
  },
  filesGroup: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    padding: '12px',
  },
  filesGroupTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: '8px',
    letterSpacing: '0.5px',
  },
  filesGroupTitleNew: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#2e7d32',
    textTransform: 'uppercase',
    marginBottom: '8px',
    letterSpacing: '0.5px',
  },
  filesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  fileLink: {
    fontSize: '13px',
    color: '#1565c0',
    textDecoration: 'none',
    padding: '4px 8px',
    backgroundColor: 'white',
    borderRadius: '4px',
    border: '1px solid #e0e0e0',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileLinkNew: {
    fontSize: '13px',
    color: '#2e7d32',
    textDecoration: 'none',
    padding: '4px 8px',
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    border: '1px solid #a5d6a7',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
