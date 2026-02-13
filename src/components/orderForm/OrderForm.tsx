import React, { useState, useEffect } from 'react';
import { QuoteSearch } from './QuoteSearch';
import { CustomerSection } from './CustomerSection';
import { BuildingSection } from './BuildingSection';
import { PricingSection } from './PricingSection';
import { AdditionalSection } from './AdditionalSection';
import { PaymentSection } from './PaymentSection';
import { FileUploadSection } from './FileUploadSection';
import {
  OrderFormData,
  OrderFormFiles,
  initialOrderFormData,
  initialOrderFormFiles,
  Quote,
} from '../../types/order';
import { AdminOptionType } from '../../types/admin';
import { getAllAdminOptions } from '../../services/adminService';
import { createOrder } from '../../services/orderService';
import { useAuth } from '../../contexts/AuthContext';

interface OrderFormProps {
  onOrderCreated?: (orderId: string) => void;
}

export function OrderForm({ onOrderCreated }: OrderFormProps) {
  const { user, userName } = useAuth();
  const [formData, setFormData] = useState<OrderFormData>(initialOrderFormData);
  const [adminOptions, setAdminOptions] = useState<Record<AdminOptionType, string[]>>(
    {} as Record<AdminOptionType, string[]>
  );
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  useEffect(() => {
    loadAdminOptions();
  }, []);

  // Auto-select salesPerson based on logged-in user's name
  useEffect(() => {
    if (userName && !formData.salesPerson) {
      setFormData(prev => ({ ...prev, salesPerson: userName }));
    }
  }, [userName]);

  // Auto-generate order form name when customer name or manufacturer changes
  useEffect(() => {
    const customerName = `${formData.customer.firstName} ${formData.customer.lastName}`.trim();
    const manufacturer = formData.building.manufacturer;

    if (customerName || manufacturer) {
      const parts: string[] = [];
      if (customerName) parts.push(customerName);
      if (manufacturer) parts.push(manufacturer);

      if (parts.length > 0) {
        setFormData(prev => ({
          ...prev,
          orderFormName: parts.join(' - '),
        }));
      }
    }
  }, [formData.customer.firstName, formData.customer.lastName, formData.building.manufacturer]);

  const loadAdminOptions = async () => {
    try {
      const options = await getAllAdminOptions();
      setAdminOptions(options);
    } catch (err) {
      console.error('Failed to load admin options:', err);
      setError('Failed to load form options. Please refresh the page.');
    } finally {
      setOptionsLoading(false);
    }
  };

  const handleQuoteSelect = (quote: Quote) => {
    setFormData({
      customer: quote.customer,
      building: quote.building,
      pricing: {
        subtotalBeforeTax: quote.pricing.subtotalBeforeTax.toString(),
        extraMoneyFluff: quote.pricing.extraMoneyFluff.toString(),
        deposit: quote.pricing.deposit.toString(),
      },
      payment: {
        type: 'stripe_pay_now',
        stripePaymentId: '',
        notes: '',
      },
      files: initialOrderFormFiles,
      salesPerson: '',
      orderFormName: `Order from ${quote.quoteNumber}`,
      paymentNotes: '',
      referredBy: '',
      specialNotes: '',
      quoteId: quote.id,
    });
    setSuccess(null);
    setError(null);
  };

  const handleStartBlank = () => {
    setFormData(initialOrderFormData);
    setSuccess(null);
    setError(null);
  };

  const updateCustomer = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      customer: { ...prev.customer, [field]: value },
    }));
  };

  const updateBuilding = (field: string, value: string | boolean) => {
    setFormData((prev) => ({
      ...prev,
      building: { ...prev.building, [field]: value },
    }));
  };

  const updatePricing = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      pricing: { ...prev.pricing, [field]: value },
    }));
  };

  const updatePayment = (field: string, value: string | boolean) => {
    setFormData((prev) => ({
      ...prev,
      payment: { ...prev.payment, [field]: value },
    }));
  };

  const updateAdditional = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateFiles = (files: OrderFormFiles) => {
    setFormData((prev) => ({
      ...prev,
      files,
    }));
  };

  const validateForm = (): string | null => {
    // In test mode, only require minimal fields
    if (testMode) {
      if (!formData.customer.firstName.trim()) return 'First name is required';
      if (!formData.customer.lastName.trim()) return 'Last name is required';
      if (!formData.customer.email.trim()) return 'Email is required';
      return null;
    }

    if (!formData.customer.firstName.trim()) return 'First name is required';
    if (!formData.customer.lastName.trim()) return 'Last name is required';
    if (!formData.customer.deliveryAddress.trim()) return 'Delivery address is required';
    if (!formData.customer.state) return 'State is required';
    if (!formData.customer.zip.trim()) return 'Zip code is required';
    if (!formData.customer.phone.trim()) return 'Phone is required';
    if (!formData.customer.email.trim()) return 'Email is required';
    if (!formData.building.manufacturer) return 'Manufacturer is required';
    if (!formData.building.buildingType) return 'Building type is required';
    if (!formData.pricing.subtotalBeforeTax) return 'Subtotal is required';
    if (!formData.pricing.deposit) return 'Deposit is required';
    if (!formData.salesPerson) return 'Sales person is required';
    if (!formData.files.orderFormPdf) {
      return 'Order Form PDF is required for e-signature';
    }
    return null;
  };

  const handleSaveDraft = async () => {
    if (!user) {
      setError('You must be logged in to save an order');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // If test mode is enabled, add the stripeTestMode flag to payment
      const orderFormData = testMode
        ? { ...formData, payment: { ...formData.payment, stripeTestMode: true } }
        : formData;
      const order = await createOrder(orderFormData, user.uid);
      setSuccess(`Order ${order.orderNumber} saved as draft!${testMode ? ' (TEST MODE)' : ''}`);
      if (onOrderCreated) {
        onOrderCreated(order.id!);
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.code || 'Unknown error';
      setError(`Failed to save order: ${errorMessage}`);
      console.error('Save order error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitOrder = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!user) {
      setError('You must be logged in to submit an order');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // If test mode is enabled, add the stripeTestMode flag to payment
      const orderFormData = testMode
        ? { ...formData, payment: { ...formData.payment, stripeTestMode: true } }
        : formData;
      const order = await createOrder(orderFormData, user.uid);
      setSuccess(`Order ${order.orderNumber} created successfully!${testMode ? ' (TEST MODE)' : ''}`);
      if (onOrderCreated) {
        onOrderCreated(order.id!);
      }
      // Reset form after successful submission
      setFormData(initialOrderFormData);
      setTestMode(false);
    } catch (err: any) {
      const errorMessage = err?.message || err?.code || 'Unknown error';
      setError(`Failed to create order: ${errorMessage}`);
      console.error('Create order error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>New Order</h2>
        <p style={styles.subtitle}>Create a new order for BBD</p>
      </div>

      {/* Test Mode Toggle */}
      <div style={testMode ? styles.testModeBannerActive : styles.testModeBanner}>
        <label style={styles.testModeLabel}>
          <input
            type="checkbox"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
            style={styles.testModeCheckbox}
          />
          <span style={styles.testModeText}>⚠️ TEST MODE</span>
        </label>
        {testMode && (
          <span style={styles.testModeDescription}>
            PDF not required • Payment verification skipped • E-sign won't send to customer
          </span>
        )}
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}
      {success && <div style={styles.successBanner}>{success}</div>}

      <QuoteSearch
        onSelectQuote={handleQuoteSelect}
        onStartBlank={handleStartBlank}
      />

      {/* Order Info Section - At Top */}
      <div style={styles.orderInfoSection}>
        <h3 style={styles.sectionTitle}>Order Info</h3>
        <div style={styles.orderInfoGrid}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Sales Person <span style={styles.required}>*</span>
            </label>
            <select
              value={formData.salesPerson}
              onChange={(e) => updateAdditional('salesPerson', e.target.value)}
              style={styles.select}
              disabled={optionsLoading}
            >
              <option value="">Select sales person...</option>
              {(adminOptions.sales_persons || []).map((person) => (
                <option key={person} value={person}>
                  {person}
                </option>
              ))}
            </select>
            <p style={styles.fieldHint}>Auto-selected based on logged-in user</p>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Order Form Name</label>
            <input
              type="text"
              value={formData.orderFormName}
              onChange={(e) => updateAdditional('orderFormName', e.target.value)}
              style={styles.input}
              placeholder="Auto-generated from customer & manufacturer"
            />
            <p style={styles.fieldHint}>Auto-generated: Customer Name - Manufacturer</p>
          </div>
        </div>
      </div>

      <div style={styles.formSections}>
        <CustomerSection
          customer={formData.customer}
          onChange={updateCustomer}
          states={adminOptions.states || []}
          statesLoading={optionsLoading}
        />

        <BuildingSection
          building={formData.building}
          onChange={updateBuilding}
          adminOptions={adminOptions}
          optionsLoading={optionsLoading}
        />

        <PricingSection
          pricing={formData.pricing}
          onChange={updatePricing}
        />

        <PaymentSection
          payment={formData.payment}
          onChange={updatePayment}
          depositAmount={parseFloat(formData.pricing.deposit) || 0}
          customerEmail={formData.customer.email}
          customerName={`${formData.customer.firstName} ${formData.customer.lastName}`.trim()}
        />

        <FileUploadSection
          files={formData.files}
          onChange={updateFiles}
        />

        <AdditionalSection
          data={{
            paymentNotes: formData.paymentNotes,
            referredBy: formData.referredBy,
            specialNotes: formData.specialNotes,
          }}
          onChange={updateAdditional}
        />
      </div>

      <div style={styles.actions}>
        <button
          onClick={handleSaveDraft}
          disabled={saving}
          style={styles.draftButton}
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={handleSubmitOrder}
          disabled={saving}
          style={styles.submitButton}
        >
          {saving ? 'Creating...' : 'Create Order'}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '24px',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    fontWeight: 600,
  },
  subtitle: {
    margin: 0,
    color: '#666',
  },
  testModeBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px 16px',
    marginBottom: '16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    border: '2px dashed #ccc',
  },
  testModeBannerActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px 16px',
    marginBottom: '16px',
    backgroundColor: '#fff3e0',
    borderRadius: '8px',
    border: '2px solid #ff9800',
  },
  testModeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
  testModeCheckbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  testModeText: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e65100',
  },
  testModeDescription: {
    fontSize: '13px',
    color: '#666',
    fontStyle: 'italic',
  },
  orderInfoSection: {
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
    padding: '20px 24px',
    marginBottom: '24px',
    border: '2px solid #2196F3',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#1565c0',
  },
  orderInfoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  required: {
    color: '#dc3545',
  },
  select: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  fieldHint: {
    margin: 0,
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  errorBanner: {
    padding: '16px',
    marginBottom: '24px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '8px',
    fontSize: '14px',
  },
  successBanner: {
    padding: '16px',
    marginBottom: '24px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '8px',
    fontSize: '14px',
  },
  formSections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  actions: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'flex-end',
    marginTop: '32px',
    paddingTop: '24px',
    borderTop: '1px solid #eee',
  },
  draftButton: {
    padding: '14px 28px',
    backgroundColor: 'white',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '16px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  submitButton: {
    padding: '14px 28px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '16px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};
