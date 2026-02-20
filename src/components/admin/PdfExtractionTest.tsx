import React, { useState, useEffect } from 'react';
import { subscribeToManufacturerConfigs } from '../../services/manufacturerConfigService';
import { ManufacturerConfig } from '../../types/admin';

interface ExtractedData {
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
  manufacturerSku: string | null;
  expectedSku: string | null;
  skuMismatch: boolean;
  expectedDepositPercent: number | null;
  expectedDepositAmount: number | null;
  actualDepositPercent: number | null;
  depositDiscrepancy: boolean;
  depositDiscrepancyAmount: number | null;
}

export function PdfExtractionTest() {
  const [manufacturers, setManufacturers] = useState<ManufacturerConfig[]>([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToManufacturerConfigs((data) => {
      setManufacturers(data.filter(m => m.active));
    });
    return unsubscribe;
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setResult(null);
      setError(null);
    }
  };

  const handleExtract = async () => {
    if (!pdfFile || !selectedManufacturer) return;

    setExtracting(true);
    setResult(null);
    setError(null);

    try {
      // Convert file to base64
      const buffer = await pdfFile.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const response = await fetch(
        `${import.meta.env.VITE_FUNCTIONS_URL || ''}/previewPdfExtraction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pdfBase64: base64,
            manufacturer: selectedManufacturer,
          }),
        }
      );
      if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setResult(data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to extract data from PDF');
    } finally {
      setExtracting(false);
    }
  };

  const formatCurrency = (val: number | null) =>
    val != null ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <div style={{ padding: '24px' }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>Test PDF Extraction</h3>
      <p style={{ margin: '0 0 20px 0', color: '#666', fontSize: '14px' }}>
        Upload a PDF to preview what data the AI will extract. This is the same extraction that runs when an order is submitted.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
        <select
          value={selectedManufacturer}
          onChange={(e) => { setSelectedManufacturer(e.target.value); setResult(null); }}
          style={{ padding: '10px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px', minWidth: '200px' }}
        >
          <option value="">Select manufacturer...</option>
          {manufacturers.map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
        </select>

        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px',
          fontSize: '14px', color: '#2196F3', border: '1px solid #2196F3', borderRadius: '4px', cursor: 'pointer',
        }}>
          {pdfFile ? pdfFile.name : 'Choose PDF'}
          <input type="file" accept=".pdf" onChange={handleFileChange} style={{ display: 'none' }} />
        </label>

        <button
          onClick={handleExtract}
          disabled={!pdfFile || !selectedManufacturer || extracting}
          style={{
            padding: '10px 24px', fontSize: '14px', fontWeight: 500,
            color: 'white', backgroundColor: !pdfFile || !selectedManufacturer || extracting ? '#bbb' : '#4caf50',
            border: 'none', borderRadius: '4px', cursor: !pdfFile || !selectedManufacturer || extracting ? 'default' : 'pointer',
          }}
        >
          {extracting ? 'Extracting...' : 'Extract Data'}
        </button>
      </div>

      {extracting && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: '16px', marginBottom: '8px' }}>Sending PDF to AI for extraction...</div>
          <div style={{ fontSize: '13px', color: '#999' }}>This usually takes 5-10 seconds</div>
        </div>
      )}

      {error && (
        <div style={{ padding: '12px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '4px', marginBottom: '16px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {/* Customer Info */}
          <div style={{ flex: '1 1 300px', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', backgroundColor: '#e3f2fd', fontWeight: 600, fontSize: '14px', color: '#1565c0' }}>
              Customer Info
            </div>
            <div style={{ padding: '16px' }}>
              <DataRow label="Name" value={result.customerName} />
              <DataRow label="Email" value={result.email} />
              <DataRow label="Phone" value={result.phone} />
              <DataRow label="Address" value={result.address} />
              <DataRow label="City" value={result.city} />
              <DataRow label="State" value={result.state} />
              <DataRow label="ZIP" value={result.zip} />
            </div>
          </div>

          {/* Pricing */}
          <div style={{ flex: '1 1 300px', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', backgroundColor: '#e8f5e9', fontWeight: 600, fontSize: '14px', color: '#2e7d32' }}>
              Pricing
            </div>
            <div style={{ padding: '16px' }}>
              <DataRow label="Subtotal" value={formatCurrency(result.subtotal)} />
              <DataRow label="Down Payment" value={formatCurrency(result.downPayment)} />
              <DataRow label="Balance Due" value={formatCurrency(result.balanceDue)} />
            </div>
          </div>

          {/* SKU Validation */}
          <div style={{
            flex: '1 1 300px', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden',
            borderColor: result.skuMismatch ? '#f44336' : '#e0e0e0',
          }}>
            <div style={{
              padding: '12px 16px', fontWeight: 600, fontSize: '14px',
              backgroundColor: result.skuMismatch ? '#ffebee' : '#f3e5f5',
              color: result.skuMismatch ? '#c62828' : '#6a1b9a',
            }}>
              SKU Validation {result.skuMismatch ? '— MISMATCH' : result.expectedSku && result.manufacturerSku ? '— OK' : ''}
            </div>
            <div style={{ padding: '16px' }}>
              <DataRow label="Expected SKU" value={result.expectedSku || 'Not configured'} />
              <DataRow label="Found on PDF" value={result.manufacturerSku || 'Not found'} />
              {result.skuMismatch && (
                <div style={{
                  marginTop: '12px', padding: '10px', backgroundColor: '#ffebee', borderRadius: '4px',
                  fontSize: '13px', color: '#c62828', fontWeight: 500,
                }}>
                  SKU does not match — verify correct form is being used
                </div>
              )}
              {!result.skuMismatch && result.expectedSku && result.manufacturerSku && (
                <div style={{
                  marginTop: '12px', padding: '10px', backgroundColor: '#e8f5e9', borderRadius: '4px',
                  fontSize: '13px', color: '#2e7d32', fontWeight: 500,
                }}>
                  SKU matches configured value
                </div>
              )}
              {!result.expectedSku && (
                <div style={{ marginTop: '12px', fontSize: '13px', color: '#999', fontStyle: 'italic' }}>
                  No SKU configured for this manufacturer — set one in Manufacturer Templates
                </div>
              )}
            </div>
          </div>

          {/* Deposit Validation */}
          <div style={{
            flex: '1 1 300px', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden',
            borderColor: result.depositDiscrepancy ? '#f44336' : '#e0e0e0',
          }}>
            <div style={{
              padding: '12px 16px', fontWeight: 600, fontSize: '14px',
              backgroundColor: result.depositDiscrepancy ? '#ffebee' : '#fff3e0',
              color: result.depositDiscrepancy ? '#c62828' : '#e65100',
            }}>
              Deposit Validation {result.depositDiscrepancy ? '— DISCREPANCY' : result.expectedDepositPercent != null ? '— OK' : '— Skipped'}
            </div>
            <div style={{ padding: '16px' }}>
              {result.expectedDepositPercent != null ? (
                <>
                  <DataRow label="Expected %" value={`${result.expectedDepositPercent}%`} />
                  <DataRow label="Actual %" value={result.actualDepositPercent != null ? `${result.actualDepositPercent}%` : '—'} />
                  <DataRow label="Expected Amount" value={formatCurrency(result.expectedDepositAmount)} />
                  <DataRow label="Actual Amount" value={formatCurrency(result.downPayment)} />
                  {result.depositDiscrepancy && (
                    <div style={{
                      marginTop: '12px', padding: '10px', backgroundColor: '#ffebee', borderRadius: '4px',
                      fontSize: '13px', color: '#c62828', fontWeight: 500,
                    }}>
                      Discrepancy: {formatCurrency(result.depositDiscrepancyAmount)}
                      <br />
                      <span style={{ fontWeight: 400 }}>This would trigger manager approval</span>
                    </div>
                  )}
                  {!result.depositDiscrepancy && (
                    <div style={{
                      marginTop: '12px', padding: '10px', backgroundColor: '#e8f5e9', borderRadius: '4px',
                      fontSize: '13px', color: '#2e7d32', fontWeight: 500,
                    }}>
                      Deposit matches expected percentage
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>
                  No deposit percentage configured for this manufacturer — validation will be skipped
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: '13px' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ fontWeight: 500, color: value && value !== '—' ? '#333' : '#ccc' }}>
        {value || '—'}
      </span>
    </div>
  );
}

export default PdfExtractionTest;
