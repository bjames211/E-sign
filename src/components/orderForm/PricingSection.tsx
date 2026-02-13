import React from 'react';
import { FormField } from './FormField';

interface PricingData {
  subtotalBeforeTax: string;
  extraMoneyFluff: string;
  deposit: string;
}

interface PricingSectionProps {
  pricing: PricingData;
  onChange: (field: keyof PricingData, value: string) => void;
}

export function PricingSection({ pricing, onChange }: PricingSectionProps) {
  const handleChange = (name: string, value: string) => {
    // Allow only numbers and decimal point
    const sanitized = value.replace(/[^0-9.]/g, '');
    onChange(name as keyof PricingData, sanitized);
  };

  const formatCurrency = (value: string): string => {
    if (!value) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const subtotal = parseFloat(pricing.subtotalBeforeTax) || 0;
  const fluff = parseFloat(pricing.extraMoneyFluff) || 0;
  const deposit = parseFloat(pricing.deposit) || 0;
  const balanceDue = subtotal - deposit;

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Pricing</h3>
      <div className="form-grid" style={styles.grid}>
        <div style={styles.inputWrapper}>
          <span style={styles.currencyPrefix}>$</span>
          <FormField
            label="Subtotal Before Tax"
            name="subtotalBeforeTax"
            value={pricing.subtotalBeforeTax}
            onChange={handleChange}
            type="text"
            placeholder="0.00"
            required
          />
        </div>
        <div style={styles.inputWrapper}>
          <span style={styles.currencyPrefix}>$</span>
          <FormField
            label="Extra Money / Fluff"
            name="extraMoneyFluff"
            value={pricing.extraMoneyFluff}
            onChange={handleChange}
            type="text"
            placeholder="0.00"
          />
        </div>
        <div style={styles.inputWrapper}>
          <span style={styles.currencyPrefix}>$</span>
          <FormField
            label="Deposit"
            name="deposit"
            value={pricing.deposit}
            onChange={handleChange}
            type="text"
            placeholder="0.00"
            required
          />
        </div>
        <div style={styles.summary}>
          <div style={styles.summaryRow}>
            <span>Subtotal:</span>
            <span>${formatCurrency(subtotal.toString())}</span>
          </div>
          <div style={styles.summaryRow}>
            <span>Deposit:</span>
            <span>-${formatCurrency(deposit.toString())}</span>
          </div>
          <div style={{ ...styles.summaryRow, ...styles.totalRow }}>
            <span>Balance Due:</span>
            <span>${formatCurrency(balanceDue.toString())}</span>
          </div>
          <div style={styles.fluffRow}>
            <span>Extra Money / Fluff (separate):</span>
            <span>${formatCurrency(fluff.toString())}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    margin: '0 0 20px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    paddingBottom: '12px',
    borderBottom: '2px solid #2196F3',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  inputWrapper: {
    position: 'relative',
  },
  currencyPrefix: {
    position: 'absolute',
    left: '12px',
    top: '32px',
    color: '#666',
    fontSize: '14px',
    zIndex: 1,
  },
  summary: {
    gridColumn: '1 / -1',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '8px',
  },
  summaryRow: {
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
};
