import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface TemplateField {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page_number: number;
  role: string;
  required: boolean;
  label: string;
}

interface SignatureFieldPreviewProps {
  pdfUrl: string;
  templateId: string;
  scale?: number;
  onClose?: () => void;
}

const FIELD_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  signature: { bg: 'rgba(76, 175, 80, 0.25)', border: '#4caf50', label: 'Signature' },
  initials: { bg: 'rgba(139, 195, 74, 0.25)', border: '#8bc34a', label: 'Initials' },
  text: { bg: 'rgba(255, 152, 0, 0.25)', border: '#ff9800', label: 'Text' },
  date: { bg: 'rgba(33, 150, 243, 0.25)', border: '#2196F3', label: 'Date' },
};

const DEFAULT_FIELD_COLOR = { bg: 'rgba(156, 39, 176, 0.25)', border: '#9c27b0', label: 'Field' };

export function SignatureFieldPreview({ pdfUrl, templateId, scale = 1.0 }: SignatureFieldPreviewProps) {
  const [numPages, setNumPages] = useState(0);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentScale, setCurrentScale] = useState(scale);

  useEffect(() => {
    const fetchFields = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_FUNCTIONS_URL || ''}/getTemplateFields?templateId=${encodeURIComponent(templateId)}`
        );
        if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        setFields(data.fields || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load template fields');
      } finally {
        setLoading(false);
      }
    };
    fetchFields();
  }, [templateId]);

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  };

  const getFieldColor = (type: string) => FIELD_COLORS[type] || DEFAULT_FIELD_COLOR;

  // Render field overlays for a given page (0-indexed)
  const renderFieldOverlays = (pageIndex: number) => {
    const pageFields = fields.filter((f) => f.page_number === pageIndex);
    return pageFields.map((field, i) => {
      const color = getFieldColor(field.type);
      return (
        <div
          key={`field-${pageIndex}-${i}`}
          style={{
            position: 'absolute',
            left: field.x * currentScale,
            top: field.y * currentScale,
            width: field.width * currentScale,
            height: field.height * currentScale,
            backgroundColor: color.bg,
            border: `2px solid ${color.border}`,
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${Math.max(8, 10 * currentScale)}px`,
            color: color.border,
            fontWeight: 600,
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
          title={`${field.type} — ${field.label} (${field.role})`}
        >
          {field.width * currentScale > 50 ? (field.label || field.type) : ''}
        </div>
      );
    });
  };

  // Count fields by type
  const fieldCounts = fields.reduce<Record<string, number>>((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: '24px' }}>
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {/* Legend */}
          {Object.entries(FIELD_COLORS).map(([type, color]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <div style={{
                width: '16px',
                height: '16px',
                backgroundColor: color.bg,
                border: `2px solid ${color.border}`,
                borderRadius: '2px',
              }} />
              <span style={{ color: '#666' }}>{color.label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>Zoom:</span>
          {[0.5, 0.75, 1.0, 1.25].map((s) => (
            <button
              key={s}
              onClick={() => setCurrentScale(s)}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                backgroundColor: currentScale === s ? '#2196F3' : 'white',
                color: currentScale === s ? 'white' : '#333',
                cursor: 'pointer',
              }}
            >
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: '#666', padding: '40px' }}>
          Loading template fields...
        </div>
      )}
      {error && (
        <div style={{ padding: '12px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '4px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {!loading && (
        <>
          {/* Field summary */}
          <div style={{
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: '#e8f5e9',
            borderRadius: '4px',
            fontSize: '14px',
            color: '#2e7d32',
            display: 'flex',
            gap: '16px',
          }}>
            <span>{fields.length} field{fields.length !== 1 ? 's' : ''} found</span>
            {Object.entries(fieldCounts).map(([type, count]) => (
              <span key={type} style={{ color: getFieldColor(type).border, fontWeight: 500 }}>
                {count} {type}
              </span>
            ))}
          </div>

          {/* PDF with overlays */}
          <div style={{
            border: '1px solid #ddd',
            borderRadius: '4px',
            overflow: 'auto',
            maxHeight: '600px',
            backgroundColor: '#e0e0e0',
          }}>
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                  Loading PDF...
                </div>
              }
              error={
                <div style={{ padding: '24px', textAlign: 'center', color: '#c62828' }}>
                  Failed to load PDF. Make sure the file is a valid PDF.
                </div>
              }
            >
              {Array.from({ length: numPages }, (_, i) => (
                <div
                  key={`page-${i}`}
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    marginBottom: '8px',
                    backgroundColor: 'white',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  }}
                >
                  <Page
                    pageNumber={i + 1}
                    scale={currentScale}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                  {renderFieldOverlays(i)}
                  <div style={{
                    textAlign: 'center',
                    padding: '4px',
                    fontSize: '11px',
                    color: '#999',
                    backgroundColor: '#f5f5f5',
                  }}>
                    Page {i + 1} of {numPages}
                  </div>
                </div>
              ))}
            </Document>
          </div>

          {/* Field details table */}
          {fields.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Field Details</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Type</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Page</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Position (x, y)</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Size (w x h)</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, i) => {
                    const color = getFieldColor(field.type);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: color.bg,
                            color: color.border,
                          }}>
                            {field.type}
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>{(field.page_number || 0) + 1}</td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                          {Math.round(field.x)}, {Math.round(field.y)}
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                          {Math.round(field.width)} x {Math.round(field.height)}
                        </td>
                        <td style={{ padding: '8px' }}>{field.role}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SignatureFieldPreview;
