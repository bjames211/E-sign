import React from 'react';
import { FormField } from './FormField';

interface AdditionalData {
  paymentNotes: string;
  referredBy: string;
  specialNotes: string;
}

interface AdditionalSectionProps {
  data: AdditionalData;
  onChange: (field: string, value: string) => void;
}

export function AdditionalSection({
  data,
  onChange,
}: AdditionalSectionProps) {
  const handleChange = (name: string, value: string) => {
    onChange(name, value);
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Additional Information</h3>
      <div style={styles.grid}>
        <FormField
          label="Referred By"
          name="referredBy"
          value={data.referredBy}
          onChange={handleChange}
          placeholder="Referral source (optional)"
        />
        <div /> {/* Spacer */}
        <div style={styles.fullWidth}>
          <FormField
            label="Payment Notes"
            name="paymentNotes"
            value={data.paymentNotes}
            onChange={handleChange}
            multiline
            rows={2}
            placeholder="Any notes about payment..."
          />
        </div>
        <div style={styles.fullWidth}>
          <FormField
            label="Special Notes"
            name="specialNotes"
            value={data.specialNotes}
            onChange={handleChange}
            multiline
            rows={3}
            placeholder="Any special instructions or notes for this order..."
          />
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
  fullWidth: {
    gridColumn: '1 / -1',
  },
};
