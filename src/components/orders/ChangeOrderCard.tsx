import React from 'react';
import { ChangeOrder } from '../../types/changeOrder';
import { Timestamp } from 'firebase/firestore';

interface ChangeOrderCardProps {
  changeOrder: ChangeOrder;
  onEdit?: (co: ChangeOrder) => void;
  onTestSign?: (id: string) => void;
  isTestMode?: boolean;
  sending?: boolean;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#fff3e0', color: '#e65100', label: 'Draft' },
  pending_signature: { bg: '#e3f2fd', color: '#1565c0', label: 'Awaiting Signature' },
  signed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Signed' },
  cancelled: { bg: '#f5f5f5', color: '#999', label: 'Cancelled' },
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
    });
  } catch {
    return '-';
  }
}

function formatCurrency(value: number, showSign = true): string {
  if (value === 0) return '$0';
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toLocaleString()}`;
}

export function ChangeOrderCard({
  changeOrder: co,
  onEdit,
  onTestSign,
  isTestMode,
  sending,
}: ChangeOrderCardProps) {
  const statusStyle = STATUS_STYLES[co.status] || STATUS_STYLES.draft;
  const isDraft = co.status === 'draft';
  const isPendingSignature = co.status === 'pending_signature';
  const isCancelled = co.status === 'cancelled';
  const isSigned = co.status === 'signed';

  const hasCustomerChanges = co.customerChanges && co.customerChanges.length > 0;
  const hasBuildingChanges = co.buildingChanges && co.buildingChanges.length > 0;
  const hasPricingChanges = co.differences.subtotalDiff !== 0 ||
                           co.differences.depositDiff !== 0 ||
                           co.differences.extraMoneyFluffDiff !== 0;
  const hasFiles = co.files && (
    co.files.orderFormPdf ||
    co.files.renderings?.length > 0 ||
    co.files.extraFiles?.length > 0 ||
    co.files.installerFiles?.length > 0
  );

  return (
    <div style={{
      ...styles.card,
      ...(isCancelled ? styles.cardCancelled : {}),
    }}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.coNumber}>{co.changeOrderNumber}</span>
          <span style={{
            ...styles.statusBadge,
            backgroundColor: statusStyle.bg,
            color: statusStyle.color,
          }}>
            {statusStyle.label}
          </span>
          {isSigned && co.signedAt && (
            <span style={styles.dateText}>{formatDate(co.signedAt)}</span>
          )}
          {isPendingSignature && co.sentForSignatureAt && (
            <span style={styles.dateText}>Sent {formatDate(co.sentForSignatureAt)}</span>
          )}
          {(co.isTestMode || isTestMode) && (
            <span style={styles.testBadge}>TEST</span>
          )}
        </div>
        <div style={styles.headerRight}>
          {isDraft && onEdit && (
            <button onClick={() => onEdit(co)} style={styles.editButton}>
              Edit
            </button>
          )}
          {isPendingSignature && isTestMode && onTestSign && co.id && (
            <button
              onClick={() => onTestSign(co.id!)}
              disabled={sending}
              style={styles.testSignButton}
            >
              {sending ? 'Signing...' : 'Test Sign'}
            </button>
          )}
        </div>
      </div>

      {/* Change Summary */}
      <div style={styles.changeSummarySection}>
        <div style={styles.changeSummaryTitle}>CHANGE SUMMARY</div>

        {/* Reason */}
        <div style={styles.reasonRow}>
          <span style={styles.reasonLabel}>Reason:</span>
          <span style={styles.reasonText}>{co.reason || 'No reason provided'}</span>
        </div>

        {/* Pricing Changes */}
        {hasPricingChanges && (
          <div style={styles.pricingChanges}>
            {co.differences.subtotalDiff !== 0 && (
              <div style={styles.changeRow}>
                <span style={styles.changeLabel}>Subtotal:</span>
                <span style={styles.changeValues}>
                  ${co.previousValues.subtotalBeforeTax.toLocaleString()}
                  <span style={styles.arrow}> → </span>
                  ${co.newValues.subtotalBeforeTax.toLocaleString()}
                </span>
                <span style={{
                  ...styles.changeDiff,
                  color: co.differences.subtotalDiff > 0 ? '#2e7d32' : '#c62828',
                }}>
                  ({formatCurrency(co.differences.subtotalDiff)})
                </span>
              </div>
            )}
            {co.differences.depositDiff !== 0 && (
              <div style={styles.changeRow}>
                <span style={styles.changeLabel}>Deposit:</span>
                <span style={styles.changeValues}>
                  ${co.previousValues.deposit.toLocaleString()}
                  <span style={styles.arrow}> → </span>
                  ${co.newValues.deposit.toLocaleString()}
                </span>
                <span style={{
                  ...styles.changeDiff,
                  color: co.differences.depositDiff > 0 ? '#2e7d32' : '#c62828',
                }}>
                  ({formatCurrency(co.differences.depositDiff)})
                </span>
              </div>
            )}
            {co.differences.extraMoneyFluffDiff !== 0 && (
              <div style={styles.changeRow}>
                <span style={styles.changeLabel}>Extra/Fluff:</span>
                <span style={styles.changeValues}>
                  ${co.previousValues.extraMoneyFluff.toLocaleString()}
                  <span style={styles.arrow}> → </span>
                  ${co.newValues.extraMoneyFluff.toLocaleString()}
                </span>
                <span style={{
                  ...styles.changeDiff,
                  color: co.differences.extraMoneyFluffDiff > 0 ? '#2e7d32' : '#c62828',
                }}>
                  ({formatCurrency(co.differences.extraMoneyFluffDiff)})
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Customer Changes */}
      {hasCustomerChanges && (
        <div style={styles.changesSection}>
          <div style={styles.changesSectionTitle}>CUSTOMER CHANGES</div>
          <div style={styles.changesList}>
            {co.customerChanges!.map((change, idx) => (
              <div key={`customer-${idx}`} style={styles.fieldChangeRow}>
                <span style={styles.fieldLabel}>{change.fieldLabel}:</span>
                <span style={styles.fieldOldValue}>{change.oldValue || '(empty)'}</span>
                <span style={styles.arrow}> → </span>
                <span style={styles.fieldNewValue}>{change.newValue || '(empty)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Building Changes */}
      {hasBuildingChanges && (
        <div style={styles.changesSection}>
          <div style={styles.changesSectionTitle}>BUILDING CHANGES</div>
          <div style={styles.changesList}>
            {co.buildingChanges.map((change, idx) => (
              <div key={`building-${idx}`} style={styles.fieldChangeRow}>
                <span style={styles.fieldLabel}>{change.fieldLabel}:</span>
                <span style={styles.fieldOldValue}>{change.oldValue || '(empty)'}</span>
                <span style={styles.arrow}> → </span>
                <span style={styles.fieldNewValue}>{change.newValue || '(empty)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change Order Files */}
      {hasFiles && (
        <div style={styles.filesSection}>
          <div style={styles.changesSectionTitle}>CHANGE ORDER FILES</div>
          <div style={styles.filesList}>
            {co.files?.orderFormPdf && (
              <a
                href={co.files.orderFormPdf.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.fileLink}
              >
                View New PDF
              </a>
            )}
            {co.files?.renderings?.map((file, i) => (
              <a
                key={`render-${i}`}
                href={file.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.fileLink}
              >
                {file.name}
              </a>
            ))}
            {co.files?.extraFiles?.map((file, i) => (
              <a
                key={`extra-${i}`}
                href={file.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.fileLink}
              >
                {file.name}
              </a>
            ))}
            {co.files?.installerFiles?.map((file, i) => (
              <a
                key={`installer-${i}`}
                href={file.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.fileLink}
              >
                {file.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={styles.footer}>
        <span style={styles.footerDate}>Created: {formatDate(co.createdAt)}</span>
        {isCancelled && co.cancelledAt && (
          <span style={styles.footerDate}>Cancelled: {formatDate(co.cancelledAt)}</span>
        )}
      </div>

      {isCancelled && co.cancelledReason && (
        <div style={styles.cancelledReason}>
          Cancellation reason: {co.cancelledReason}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    marginBottom: '16px',
    overflow: 'hidden',
    backgroundColor: 'white',
  },
  cardCancelled: {
    opacity: 0.6,
    backgroundColor: '#fafafa',
  },
  header: {
    backgroundColor: '#f5f5f5',
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #e0e0e0',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  coNumber: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1565c0',
  },
  statusBadge: {
    fontSize: '11px',
    fontWeight: 500,
    padding: '3px 8px',
    borderRadius: '10px',
  },
  dateText: {
    fontSize: '12px',
    color: '#666',
  },
  testBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: '#ff9800',
    color: 'white',
  },
  editButton: {
    padding: '6px 12px',
    backgroundColor: 'white',
    color: '#1565c0',
    border: '1px solid #1565c0',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  testSignButton: {
    padding: '6px 12px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  changeSummarySection: {
    padding: '16px',
    backgroundColor: '#f0f7ff',
    borderBottom: '1px solid #e0e0e0',
  },
  changeSummaryTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#1565c0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '12px',
  },
  reasonRow: {
    marginBottom: '12px',
  },
  reasonLabel: {
    fontSize: '13px',
    color: '#666',
    marginRight: '8px',
  },
  reasonText: {
    fontSize: '14px',
    color: '#333',
    fontStyle: 'italic',
  },
  pricingChanges: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  changeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
  },
  changeLabel: {
    color: '#666',
    minWidth: '80px',
  },
  changeValues: {
    color: '#333',
  },
  arrow: {
    color: '#999',
    fontWeight: 500,
  },
  changeDiff: {
    fontWeight: 600,
    fontSize: '13px',
  },
  changesSection: {
    padding: '16px',
    borderBottom: '1px solid #e0e0e0',
  },
  changesSectionTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '10px',
  },
  changesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  fieldChangeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    padding: '4px 8px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
  },
  fieldLabel: {
    color: '#666',
    minWidth: '120px',
    fontWeight: 500,
  },
  fieldOldValue: {
    color: '#999',
    textDecoration: 'line-through',
  },
  fieldNewValue: {
    color: '#2e7d32',
    fontWeight: 500,
  },
  filesSection: {
    padding: '16px',
    borderBottom: '1px solid #e0e0e0',
  },
  filesList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  fileLink: {
    padding: '6px 12px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
    fontSize: '13px',
    textDecoration: 'none',
    border: '1px solid #90caf9',
  },
  footer: {
    padding: '10px 16px',
    display: 'flex',
    gap: '16px',
    backgroundColor: '#fafafa',
  },
  footerDate: {
    fontSize: '11px',
    color: '#999',
  },
  cancelledReason: {
    padding: '10px 16px',
    fontSize: '12px',
    color: '#999',
    fontStyle: 'italic',
    backgroundColor: '#f5f5f5',
    borderTop: '1px solid #e0e0e0',
  },
};
