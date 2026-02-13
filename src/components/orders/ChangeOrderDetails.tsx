import React from 'react';
import { ChangeOrder } from '../../types/changeOrder';
import { Timestamp } from 'firebase/firestore';

interface ChangeOrderDetailsProps {
  changeOrder: ChangeOrder;
  onClose: () => void;
  onEdit?: () => void;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f5f5f5', color: '#666', label: 'Draft' },
  pending_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  cancelled: { bg: '#ffebee', color: '#c62828', label: 'Cancelled' },
  superseded: { bg: '#f5f5f5', color: '#999', label: 'Superseded' },
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

function formatCurrency(value: number | undefined): string {
  if (value === undefined || value === null) return '-';
  return `$${value.toLocaleString()}`;
}

function formatDiff(value: number): string {
  if (value === 0) return '$0';
  const sign = value > 0 ? '+' : '';
  return `${sign}$${value.toLocaleString()}`;
}

export function ChangeOrderDetails({ changeOrder, onClose, onEdit }: ChangeOrderDetailsProps) {
  const statusStyle = STATUS_STYLES[changeOrder.status] || STATUS_STYLES.draft;
  const hasCustomerChanges = changeOrder.customerChanges && changeOrder.customerChanges.length > 0;
  const hasBuildingChanges = changeOrder.buildingChanges && changeOrder.buildingChanges.length > 0;
  const hasFiles = changeOrder.files && (
    changeOrder.files.orderFormPdf ||
    (changeOrder.files.renderings && changeOrder.files.renderings.length > 0) ||
    (changeOrder.files.extraFiles && changeOrder.files.extraFiles.length > 0) ||
    (changeOrder.files.installerFiles && changeOrder.files.installerFiles.length > 0)
  );

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <h2 style={styles.title}>{changeOrder.changeOrderNumber}</h2>
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
          <button onClick={onClose} style={styles.closeButton}>
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {/* Basic Info */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Change Order Info</h3>
            <div style={styles.infoGrid}>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Parent Order</span>
                <span style={styles.infoValue}>{changeOrder.orderNumber}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Created By</span>
                <span style={styles.infoValue}>{changeOrder.createdBy || '-'}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Created At</span>
                <span style={styles.infoValue}>{formatDate(changeOrder.createdAt)}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Last Updated</span>
                <span style={styles.infoValue}>{formatDate(changeOrder.updatedAt)}</span>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Reason for Change</h3>
            <div style={styles.reasonBox}>
              {changeOrder.reason || 'No reason provided'}
            </div>
          </div>

          {/* Pricing Changes */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Pricing Changes</h3>
            <table style={styles.pricingTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Field</th>
                  <th style={styles.th}>Previous</th>
                  <th style={styles.th}>New</th>
                  <th style={styles.th}>Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={styles.td}>Subtotal</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.previousValues?.subtotalBeforeTax)}</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.newValues?.subtotalBeforeTax)}</td>
                  <td style={{
                    ...styles.td,
                    color: changeOrder.differences?.subtotalDiff === 0 ? '#666' :
                      changeOrder.differences?.subtotalDiff > 0 ? '#2e7d32' : '#c62828',
                    fontWeight: 600,
                  }}>
                    {formatDiff(changeOrder.differences?.subtotalDiff || 0)}
                  </td>
                </tr>
                <tr>
                  <td style={styles.td}>Extra/Fluff</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.previousValues?.extraMoneyFluff)}</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.newValues?.extraMoneyFluff)}</td>
                  <td style={{
                    ...styles.td,
                    color: changeOrder.differences?.extraMoneyFluffDiff === 0 ? '#666' :
                      changeOrder.differences?.extraMoneyFluffDiff > 0 ? '#2e7d32' : '#c62828',
                    fontWeight: 600,
                  }}>
                    {formatDiff(changeOrder.differences?.extraMoneyFluffDiff || 0)}
                  </td>
                </tr>
                <tr>
                  <td style={styles.td}>Deposit</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.previousValues?.deposit)}</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.newValues?.deposit)}</td>
                  <td style={{
                    ...styles.td,
                    color: changeOrder.differences?.depositDiff === 0 ? '#666' :
                      changeOrder.differences?.depositDiff > 0 ? '#2e7d32' : '#c62828',
                    fontWeight: 600,
                  }}>
                    {formatDiff(changeOrder.differences?.depositDiff || 0)}
                  </td>
                </tr>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>Total</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.previousValues?.total)}</td>
                  <td style={styles.td}>{formatCurrency(changeOrder.newValues?.total)}</td>
                  <td style={{
                    ...styles.td,
                    color: changeOrder.differences?.totalDiff === 0 ? '#666' :
                      changeOrder.differences?.totalDiff > 0 ? '#2e7d32' : '#c62828',
                    fontWeight: 600,
                  }}>
                    {formatDiff(changeOrder.differences?.totalDiff || 0)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Cumulative from Original */}
            {changeOrder.cumulativeFromOriginal && (
              <div style={styles.cumulativeBox}>
                <strong>Cumulative from Original Order:</strong>{' '}
                Total {formatDiff(changeOrder.cumulativeFromOriginal.totalDiff)},{' '}
                Deposit {formatDiff(changeOrder.cumulativeFromOriginal.depositDiff)}
              </div>
            )}
          </div>

          {/* Customer Changes */}
          {hasCustomerChanges && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Customer Changes</h3>
              <table style={styles.changesTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Field</th>
                    <th style={styles.th}>Previous Value</th>
                    <th style={styles.th}>New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {changeOrder.customerChanges!.map((change, idx) => (
                    <tr key={idx}>
                      <td style={styles.td}>{change.fieldLabel}</td>
                      <td style={{ ...styles.td, color: '#c62828', textDecoration: 'line-through' }}>
                        {change.oldValue || '-'}
                      </td>
                      <td style={{ ...styles.td, color: '#2e7d32', fontWeight: 500 }}>
                        {change.newValue || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Building Changes */}
          {hasBuildingChanges && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Building Changes</h3>
              <table style={styles.changesTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Field</th>
                    <th style={styles.th}>Previous Value</th>
                    <th style={styles.th}>New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {changeOrder.buildingChanges!.map((change, idx) => (
                    <tr key={idx}>
                      <td style={styles.td}>{change.fieldLabel}</td>
                      <td style={{ ...styles.td, color: '#c62828', textDecoration: 'line-through' }}>
                        {change.oldValue || '-'}
                      </td>
                      <td style={{ ...styles.td, color: '#2e7d32', fontWeight: 500 }}>
                        {change.newValue || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Files */}
          {hasFiles && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Files & Documents</h3>
              <div style={styles.filesGrid}>
                {changeOrder.files?.orderFormPdf && (
                  <div style={styles.fileItem}>
                    <div style={styles.fileIcon}>PDF</div>
                    <div style={styles.fileInfo}>
                      <a
                        href={changeOrder.files.orderFormPdf.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.fileLink}
                      >
                        {changeOrder.files.orderFormPdf.name}
                      </a>
                      <span style={styles.fileSize}>
                        {(changeOrder.files.orderFormPdf.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>
                )}
                {changeOrder.files?.renderings?.map((file, idx) => (
                  <div key={`rendering-${idx}`} style={styles.fileItem}>
                    <div style={styles.fileIcon}>IMG</div>
                    <div style={styles.fileInfo}>
                      <a
                        href={file.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.fileLink}
                      >
                        {file.name}
                      </a>
                      <span style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                ))}
                {changeOrder.files?.extraFiles?.map((file, idx) => (
                  <div key={`extra-${idx}`} style={styles.fileItem}>
                    <div style={styles.fileIcon}>FILE</div>
                    <div style={styles.fileInfo}>
                      <a
                        href={file.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.fileLink}
                      >
                        {file.name}
                      </a>
                      <span style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                ))}
                {changeOrder.files?.installerFiles?.map((file, idx) => (
                  <div key={`installer-${idx}`} style={styles.fileItem}>
                    <div style={styles.fileIcon}>FILE</div>
                    <div style={styles.fileInfo}>
                      <a
                        href={file.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.fileLink}
                      >
                        {file.name}
                      </a>
                      <span style={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Trail */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Audit Trail</h3>
            <div style={styles.auditTimeline}>
              <div style={styles.auditItem}>
                <div style={styles.auditDot} />
                <div style={styles.auditContent}>
                  <span style={styles.auditAction}>Created</span>
                  <span style={styles.auditTime}>{formatDate(changeOrder.createdAt)}</span>
                  <span style={styles.auditBy}>by {changeOrder.createdBy || 'Unknown'}</span>
                </div>
              </div>

              {changeOrder.sentForSignatureAt && (
                <div style={styles.auditItem}>
                  <div style={{ ...styles.auditDot, backgroundColor: '#1565c0' }} />
                  <div style={styles.auditContent}>
                    <span style={styles.auditAction}>Sent for Signature</span>
                    <span style={styles.auditTime}>{formatDate(changeOrder.sentForSignatureAt)}</span>
                    {changeOrder.esignDocumentId && (
                      <span style={styles.auditNote}>E-Sign Doc: {changeOrder.esignDocumentId}</span>
                    )}
                  </div>
                </div>
              )}

              {changeOrder.signedAt && (
                <div style={styles.auditItem}>
                  <div style={{ ...styles.auditDot, backgroundColor: '#2e7d32' }} />
                  <div style={styles.auditContent}>
                    <span style={styles.auditAction}>Signed</span>
                    <span style={styles.auditTime}>{formatDate(changeOrder.signedAt)}</span>
                  </div>
                </div>
              )}

              {changeOrder.cancelledAt && (
                <div style={styles.auditItem}>
                  <div style={{ ...styles.auditDot, backgroundColor: '#c62828' }} />
                  <div style={styles.auditContent}>
                    <span style={styles.auditAction}>Cancelled</span>
                    <span style={styles.auditTime}>{formatDate(changeOrder.cancelledAt)}</span>
                    {changeOrder.cancelledReason && (
                      <span style={styles.auditNote}>Reason: {changeOrder.cancelledReason}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.closeBtn}>
            Close
          </button>
          {onEdit && changeOrder.status === 'draft' && (
            <button onClick={onEdit} style={styles.editBtn}>
              Edit Change Order
            </button>
          )}
        </div>
      </div>
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
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '40px 20px',
    zIndex: 1000,
    overflowY: 'auto',
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '800px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #eee',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 600,
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '28px',
    color: '#666',
    cursor: 'pointer',
    padding: '0 8px',
    lineHeight: 1,
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
    color: '#1565c0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  infoLabel: {
    fontSize: '12px',
    color: '#666',
  },
  infoValue: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  reasonBox: {
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#333',
    lineHeight: 1.5,
  },
  pricingTable: {
    width: '100%',
    borderCollapse: 'collapse',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  changesTable: {
    width: '100%',
    borderCollapse: 'collapse',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  th: {
    padding: '10px 14px',
    textAlign: 'left',
    backgroundColor: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
    fontSize: '12px',
    fontWeight: 600,
    color: '#333',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid #eee',
    fontSize: '14px',
    color: '#333',
  },
  cumulativeBox: {
    marginTop: '12px',
    padding: '10px 14px',
    backgroundColor: '#e3f2fd',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#1565c0',
  },
  filesGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    backgroundColor: '#f5f5f5',
    borderRadius: '6px',
  },
  fileIcon: {
    width: '36px',
    height: '36px',
    backgroundColor: '#1565c0',
    color: 'white',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 600,
  },
  fileInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  fileLink: {
    color: '#1565c0',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: 500,
  },
  fileSize: {
    fontSize: '11px',
    color: '#666',
  },
  auditTimeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    paddingLeft: '8px',
  },
  auditItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    position: 'relative',
    paddingBottom: '16px',
    paddingLeft: '20px',
    borderLeft: '2px solid #e0e0e0',
  },
  auditDot: {
    position: 'absolute',
    left: '-6px',
    top: '2px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#666',
  },
  auditContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  auditAction: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  auditTime: {
    fontSize: '12px',
    color: '#666',
  },
  auditBy: {
    fontSize: '12px',
    color: '#666',
  },
  auditNote: {
    fontSize: '12px',
    color: '#999',
    fontStyle: 'italic',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 24px',
    borderTop: '1px solid #eee',
  },
  closeBtn: {
    padding: '10px 20px',
    backgroundColor: '#f5f5f5',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  editBtn: {
    padding: '10px 20px',
    backgroundColor: '#1565c0',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};
