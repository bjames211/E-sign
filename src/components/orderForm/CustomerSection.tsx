import React from 'react';
import { FormField } from './FormField';
import { FormDropdown } from './FormDropdown';
import { CustomerInfo } from '../../types/order';

interface CustomerSectionProps {
  customer: CustomerInfo;
  onChange: (field: keyof CustomerInfo, value: string) => void;
  states: string[];
  statesLoading?: boolean;
}

export function CustomerSection({
  customer,
  onChange,
  states,
  statesLoading,
}: CustomerSectionProps) {
  const handleChange = (name: string, value: string) => {
    onChange(name as keyof CustomerInfo, value);
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Customer Contact</h3>
      <div className="form-grid" style={styles.grid}>
        <FormField
          label="First Name"
          name="firstName"
          value={customer.firstName}
          onChange={handleChange}
          required
        />
        <FormField
          label="Last Name"
          name="lastName"
          value={customer.lastName}
          onChange={handleChange}
          required
        />
        <div style={styles.fullWidth}>
          <FormField
            label="Delivery Address"
            name="deliveryAddress"
            value={customer.deliveryAddress}
            onChange={handleChange}
            required
          />
        </div>
        <FormDropdown
          label="State"
          name="state"
          value={customer.state}
          onChange={handleChange}
          options={states}
          loading={statesLoading}
          required
        />
        <FormField
          label="Zip Code"
          name="zip"
          value={customer.zip}
          onChange={handleChange}
          placeholder="12345"
          required
        />
        <FormField
          label="Phone"
          name="phone"
          value={customer.phone}
          onChange={handleChange}
          type="tel"
          placeholder="(555) 123-4567"
          required
        />
        <FormField
          label="Email"
          name="email"
          value={customer.email}
          onChange={handleChange}
          type="email"
          required
        />
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
