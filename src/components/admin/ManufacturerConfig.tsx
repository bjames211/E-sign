import React, { useState, useEffect } from 'react';
import { ManufacturerConfig as ManufacturerConfigType, DepositTier } from '../../types/admin';
import {
  subscribeToManufacturerConfigs,
  saveManufacturerConfig,
  updateManufacturerConfig,
  deleteManufacturerConfig,
} from '../../services/manufacturerConfigService';
import { SignatureFieldPreview } from './SignatureFieldPreview';

type DepositMode = 'fixed' | 'tiered' | 'none';

function getDepositMode(config: ManufacturerConfigType): DepositMode {
  if (config.depositTiers && config.depositTiers.length > 0) return 'tiered';
  if (config.depositPercent != null) return 'fixed';
  return 'none';
}

function formatDepositDisplay(config: ManufacturerConfigType): string {
  if (config.depositTiers && config.depositTiers.length > 0) {
    const percents = config.depositTiers.map(t => t.percent);
    const min = Math.min(...percents);
    const max = Math.max(...percents);
    return min === max ? `${min}%` : `${min}-${max}%`;
  }
  if (config.depositPercent != null) return `${config.depositPercent}%`;
  return 'None';
}

interface TierRow {
  upTo: string; // string for controlled input; empty = "and above"
  percent: string;
}

function TierEditor({ tiers, onChange }: { tiers: TierRow[]; onChange: (tiers: TierRow[]) => void }) {
  const updateTier = (index: number, field: 'upTo' | 'percent', value: string) => {
    const updated = [...tiers];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const addTier = () => {
    // Insert before the last (catch-all) tier
    const updated = [...tiers];
    updated.splice(tiers.length - 1, 0, { upTo: '', percent: '' });
    onChange(updated);
  };

  const removeTier = (index: number) => {
    if (tiers.length <= 1) return;
    const updated = tiers.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {tiers.map((tier, i) => {
        const isLast = i === tiers.length - 1;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            {isLast ? (
              <span style={{ width: '130px', color: '#666', fontSize: '12px' }}>Above</span>
            ) : (
              <>
                <span style={{ color: '#666', fontSize: '12px' }}>Up to $</span>
                <input
                  type="number"
                  value={tier.upTo}
                  onChange={(e) => updateTier(i, 'upTo', e.target.value)}
                  placeholder="10000"
                  style={{ width: '80px', padding: '4px 6px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '3px', textAlign: 'right' }}
                  min="0"
                />
              </>
            )}
            <span style={{ color: '#666', fontSize: '12px' }}>:</span>
            <input
              type="number"
              value={tier.percent}
              onChange={(e) => updateTier(i, 'percent', e.target.value)}
              placeholder="20"
              style={{ width: '50px', padding: '4px 6px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '3px', textAlign: 'right' }}
              min="0"
              max="100"
              step="0.5"
            />
            <span style={{ color: '#666', fontSize: '12px' }}>%</span>
            {!isLast && tiers.length > 1 && (
              <button
                onClick={() => removeTier(i)}
                style={{ padding: '2px 6px', fontSize: '11px', color: '#f44336', backgroundColor: 'transparent', border: '1px solid #f44336', borderRadius: '3px', cursor: 'pointer' }}
                title="Remove tier"
              >
                x
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={addTier}
        type="button"
        style={{ alignSelf: 'flex-start', padding: '3px 8px', fontSize: '11px', color: '#2196F3', backgroundColor: 'transparent', border: '1px solid #2196F3', borderRadius: '3px', cursor: 'pointer', marginTop: '2px' }}
      >
        + Add Tier
      </button>
    </div>
  );
}

function tiersToData(tiers: TierRow[]): DepositTier[] | null {
  const result: DepositTier[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const isLast = i === tiers.length - 1;
    const percent = parseFloat(tiers[i].percent);
    if (isNaN(percent) || percent < 0 || percent > 100) return null;
    if (isLast) {
      result.push({ upTo: null, percent });
    } else {
      const upTo = parseFloat(tiers[i].upTo);
      if (isNaN(upTo) || upTo <= 0) return null;
      result.push({ upTo, percent });
    }
  }
  return result;
}

function dataToTiers(depositTiers?: DepositTier[]): TierRow[] {
  if (!depositTiers || depositTiers.length === 0) {
    return [{ upTo: '', percent: '20' }];
  }
  const sorted = [...depositTiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  return sorted.map(t => ({
    upTo: t.upTo != null ? String(t.upTo) : '',
    percent: String(t.percent),
  }));
}

export function ManufacturerConfig() {
  const [configs, setConfigs] = useState<ManufacturerConfigType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newDepositMode, setNewDepositMode] = useState<DepositMode>('fixed');
  const [newDepositPercent, setNewDepositPercent] = useState('20');
  const [newTiers, setNewTiers] = useState<TierRow[]>([{ upTo: '10000', percent: '15' }, { upTo: '', percent: '20' }]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTemplateId, setEditTemplateId] = useState('');
  const [editDepositMode, setEditDepositMode] = useState<DepositMode>('fixed');
  const [editDepositPercent, setEditDepositPercent] = useState('');
  const [editTiers, setEditTiers] = useState<TierRow[]>([]);
  const [editActive, setEditActive] = useState(true);

  // Preview state
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [, setPreviewPdfFile] = useState<File | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToManufacturerConfigs((data) => {
      setConfigs(data);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
    };
  }, [previewPdfUrl]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setError('Manufacturer name is required');
      return;
    }

    let depositPercent: number | null = null;
    let depositTiers: DepositTier[] | undefined = undefined;

    if (newDepositMode === 'fixed') {
      const p = parseFloat(newDepositPercent);
      if (isNaN(p) || p < 0 || p > 100) {
        setError('Deposit percent must be between 0 and 100');
        return;
      }
      depositPercent = p;
    } else if (newDepositMode === 'tiered') {
      const parsed = tiersToData(newTiers);
      if (!parsed) {
        setError('All tier amounts and percentages must be valid numbers');
        return;
      }
      depositTiers = parsed;
    }

    setSaving(true);
    setError(null);

    try {
      await saveManufacturerConfig({
        name: newName.trim(),
        signNowTemplateId: newTemplateId.trim(),
        depositPercent,
        depositTiers,
        active: true,
      });
      setNewName('');
      setNewTemplateId('');
      setNewDepositMode('fixed');
      setNewDepositPercent('20');
      setNewTiers([{ upTo: '10000', percent: '15' }, { upTo: '', percent: '20' }]);
    } catch (err) {
      console.error('Error adding manufacturer config:', err);
      setError('Failed to add manufacturer');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (config: ManufacturerConfigType) => {
    const mode = getDepositMode(config);
    setEditingId(config.id!);
    setEditTemplateId(config.signNowTemplateId || '');
    setEditDepositMode(mode);
    setEditDepositPercent(config.depositPercent != null ? String(config.depositPercent) : '20');
    setEditTiers(dataToTiers(config.depositTiers));
    setEditActive(config.active);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    let depositPercent: number | null = null;
    let depositTiers: DepositTier[] | undefined = undefined;

    if (editDepositMode === 'fixed') {
      const p = parseFloat(editDepositPercent);
      if (isNaN(p) || p < 0 || p > 100) {
        setError('Deposit percent must be between 0 and 100');
        return;
      }
      depositPercent = p;
    } else if (editDepositMode === 'tiered') {
      const parsed = tiersToData(editTiers);
      if (!parsed) {
        setError('All tier amounts and percentages must be valid numbers');
        return;
      }
      depositTiers = parsed;
    }

    setSaving(true);
    setError(null);

    try {
      await updateManufacturerConfig(editingId, {
        signNowTemplateId: editTemplateId.trim(),
        depositPercent,
        depositTiers: depositTiers || [],
        active: editActive,
      });
      setEditingId(null);
    } catch (err) {
      console.error('Error updating manufacturer config:', err);
      setError('Failed to update manufacturer');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (config: ManufacturerConfigType) => {
    if (!window.confirm(`Delete configuration for "${config.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteManufacturerConfig(config.id!);
    } catch (err) {
      console.error('Error deleting manufacturer config:', err);
      setError('Failed to delete manufacturer');
    }
  };

  const handlePreviewFields = (templateId: string) => {
    setPreviewTemplateId(templateId);
    setPreviewPdfFile(null);
    setPreviewPdfUrl(null);
  };

  const handlePreviewFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPreviewPdfFile(file);
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      setPreviewPdfUrl(URL.createObjectURL(file));
    }
  };

  const closePreview = () => {
    setPreviewTemplateId(null);
    setPreviewPdfFile(null);
    if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
    setPreviewPdfUrl(null);
  };

  const renderDepositModeSelector = (
    mode: DepositMode,
    setMode: (m: DepositMode) => void,
    prefix: string,
  ) => (
    <div style={{ display: 'flex', gap: '4px', fontSize: '12px' }}>
      {(['fixed', 'tiered', 'none'] as DepositMode[]).map((m) => (
        <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', color: mode === m ? '#2196F3' : '#666' }}>
          <input
            type="radio"
            name={`${prefix}-deposit-mode`}
            checked={mode === m}
            onChange={() => setMode(m)}
            style={{ margin: 0 }}
          />
          {m === 'fixed' ? 'Fixed %' : m === 'tiered' ? 'Tiered' : 'None'}
        </label>
      ))}
    </div>
  );

  if (loading) {
    return <div style={styles.loading}>Loading manufacturer config...</div>;
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Manufacturer Templates</h3>
      <p style={styles.subtitle}>
        Configure SignNow template IDs and deposit percentages per manufacturer.
        Use "Tiered" for price-based deposit rates. Use "None" to skip deposit validation.
      </p>

      {error && <div style={styles.error}>{error}</div>}

      {/* Add Form */}
      <form onSubmit={handleAdd} style={styles.addForm}>
        <div style={styles.formRow}>
          <input
            type="text"
            placeholder="Manufacturer name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ ...styles.input, width: '180px' }}
            required
          />
          <input
            type="text"
            placeholder="SignNow Template ID"
            value={newTemplateId}
            onChange={(e) => setNewTemplateId(e.target.value)}
            style={{ ...styles.input, width: '280px', fontFamily: 'monospace', fontSize: '13px' }}
          />
        </div>
        <div style={{ marginTop: '12px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px', fontWeight: 500 }}>Deposit:</div>
            {renderDepositModeSelector(newDepositMode, setNewDepositMode, 'new')}
          </div>
          <div style={{ flex: 1 }}>
            {newDepositMode === 'fixed' && (
              <div style={styles.percentWrapper}>
                <input
                  type="number"
                  placeholder="20"
                  value={newDepositPercent}
                  onChange={(e) => setNewDepositPercent(e.target.value)}
                  style={{ ...styles.input, width: '80px', textAlign: 'right' }}
                  min="0"
                  max="100"
                  step="0.5"
                />
                <span style={styles.percentSign}>%</span>
              </div>
            )}
            {newDepositMode === 'tiered' && (
              <TierEditor tiers={newTiers} onChange={setNewTiers} />
            )}
            {newDepositMode === 'none' && (
              <span style={{ fontSize: '12px', color: '#999', fontStyle: 'italic' }}>Deposit validation will be skipped</span>
            )}
          </div>
          <button type="submit" disabled={saving} style={styles.addButton}>
            {saving ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {/* Config List */}
      <div style={styles.list}>
        <div style={styles.listHeader}>
          <span style={{ ...styles.headerCell, width: '180px' }}>Manufacturer</span>
          <span style={{ ...styles.headerCell, flex: 1 }}>Template ID</span>
          <span style={{ ...styles.headerCell, width: '120px' }}>Deposit</span>
          <span style={{ ...styles.headerCell, width: '70px' }}>Status</span>
          <span style={{ ...styles.headerCell, width: '200px' }}>Actions</span>
        </div>

        {configs.length === 0 ? (
          <div style={styles.emptyState}>
            No manufacturers configured. Add one above to get started.
          </div>
        ) : (
          configs.map((config) => (
            <div key={config.id} style={{ ...styles.row, alignItems: editingId === config.id ? 'flex-start' : 'center' }}>
              {editingId === config.id ? (
                // Edit mode
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ width: '180px', fontWeight: 500, fontSize: '14px' }}>
                      {config.name}
                    </span>
                    <input
                      type="text"
                      value={editTemplateId}
                      onChange={(e) => setEditTemplateId(e.target.value)}
                      style={{ ...styles.input, flex: 1, fontFamily: 'monospace', fontSize: '12px' }}
                      placeholder="SignNow Template ID"
                    />
                    <label style={styles.toggleLabel}>
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                      />
                      {editActive ? 'Active' : 'Inactive'}
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px', fontWeight: 500 }}>Deposit:</div>
                      {renderDepositModeSelector(editDepositMode, setEditDepositMode, 'edit')}
                    </div>
                    <div style={{ flex: 1 }}>
                      {editDepositMode === 'fixed' && (
                        <div style={styles.percentWrapper}>
                          <input
                            type="number"
                            value={editDepositPercent}
                            onChange={(e) => setEditDepositPercent(e.target.value)}
                            style={{ ...styles.input, width: '80px', textAlign: 'right' }}
                            min="0"
                            max="100"
                            step="0.5"
                          />
                          <span style={styles.percentSign}>%</span>
                        </div>
                      )}
                      {editDepositMode === 'tiered' && (
                        <TierEditor tiers={editTiers} onChange={setEditTiers} />
                      )}
                      {editDepositMode === 'none' && (
                        <span style={{ fontSize: '12px', color: '#999', fontStyle: 'italic' }}>Deposit validation will be skipped</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={handleSaveEdit} disabled={saving} style={styles.saveButton}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} style={styles.cancelButton}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <>
                  <span style={{ ...styles.cell, width: '180px', fontWeight: 500 }}>
                    {config.name}
                  </span>
                  <span
                    style={{
                      ...styles.cell,
                      flex: 1,
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      color: config.signNowTemplateId ? '#333' : '#999',
                    }}
                  >
                    {config.signNowTemplateId
                      ? `${config.signNowTemplateId.substring(0, 12)}...${config.signNowTemplateId.substring(config.signNowTemplateId.length - 8)}`
                      : 'Not configured'}
                  </span>
                  <span style={{ ...styles.cell, width: '120px' }}>
                    {config.depositTiers && config.depositTiers.length > 0 ? (
                      <span style={{ fontSize: '12px' }}>
                        <span style={{ fontWeight: 500, color: '#1565c0' }}>Tiered</span>
                        <span style={{ color: '#666', marginLeft: '4px' }}>
                          ({formatDepositDisplay(config)})
                        </span>
                      </span>
                    ) : config.depositPercent != null ? (
                      <span style={{ fontWeight: 500 }}>{config.depositPercent}%</span>
                    ) : (
                      <span style={{ color: '#999' }}>None</span>
                    )}
                  </span>
                  <span style={{ ...styles.cell, width: '70px' }}>
                    <span
                      style={{
                        ...styles.statusBadge,
                        backgroundColor: config.active ? '#e8f5e9' : '#ffebee',
                        color: config.active ? '#2e7d32' : '#c62828',
                      }}
                    >
                      {config.active ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                  <span style={{ ...styles.cell, width: '200px', display: 'flex', gap: '6px' }}>
                    <button onClick={() => handleStartEdit(config)} style={styles.editButton}>
                      Edit
                    </button>
                    {config.signNowTemplateId && (
                      <button
                        onClick={() => handlePreviewFields(config.signNowTemplateId)}
                        style={styles.previewButton}
                      >
                        Preview
                      </button>
                    )}
                    <button onClick={() => handleDelete(config)} style={styles.deleteButton}>
                      Delete
                    </button>
                  </span>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Preview Modal */}
      {previewTemplateId && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>Signature Field Preview</h3>
              <button onClick={closePreview} style={styles.modalCloseButton}>
                Close
              </button>
            </div>

            {!previewPdfUrl ? (
              <div style={styles.filePickerArea}>
                <p style={{ margin: '0 0 16px 0', color: '#666' }}>
                  Select a sample PDF to preview where signature fields will be placed.
                </p>
                <label style={styles.filePickerButton}>
                  Choose PDF File
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handlePreviewFileSelect}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            ) : (
              <SignatureFieldPreview
                pdfUrl={previewPdfUrl}
                templateId={previewTemplateId}
                scale={1.0}
                onClose={closePreview}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#666',
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    fontWeight: 600,
  },
  subtitle: {
    margin: '0 0 20px 0',
    color: '#666',
    fontSize: '14px',
  },
  error: {
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    marginBottom: '16px',
    fontSize: '14px',
  },
  addForm: {
    marginBottom: '24px',
    padding: '16px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
  },
  formRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  input: {
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
  },
  percentWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  percentSign: {
    fontSize: '14px',
    color: '#666',
    fontWeight: 500,
  },
  addButton: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'white',
    backgroundColor: '#4caf50',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  list: {
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
    fontWeight: 600,
    fontSize: '12px',
    color: '#666',
    textTransform: 'uppercase',
  },
  headerCell: {
    padding: '0 8px',
  },
  row: {
    display: 'flex',
    padding: '12px 16px',
    borderBottom: '1px solid #f0f0f0',
  },
  cell: {
    padding: '0 8px',
    fontSize: '14px',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: '11px',
    fontWeight: 600,
    borderRadius: '12px',
  },
  editButton: {
    padding: '4px 10px',
    fontSize: '12px',
    color: '#2196F3',
    backgroundColor: 'transparent',
    border: '1px solid #2196F3',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  previewButton: {
    padding: '4px 10px',
    fontSize: '12px',
    color: '#9c27b0',
    backgroundColor: 'transparent',
    border: '1px solid #9c27b0',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  deleteButton: {
    padding: '4px 10px',
    fontSize: '12px',
    color: '#f44336',
    backgroundColor: 'transparent',
    border: '1px solid #f44336',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  saveButton: {
    padding: '4px 10px',
    fontSize: '12px',
    color: 'white',
    backgroundColor: '#4caf50',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  cancelButton: {
    padding: '4px 10px',
    fontSize: '12px',
    color: '#666',
    backgroundColor: 'transparent',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  emptyState: {
    padding: '40px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '90vw',
    maxWidth: '900px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid #e0e0e0',
  },
  modalCloseButton: {
    padding: '8px 16px',
    fontSize: '14px',
    color: '#666',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  filePickerArea: {
    padding: '60px 24px',
    textAlign: 'center',
  },
  filePickerButton: {
    display: 'inline-block',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'white',
    backgroundColor: '#2196F3',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

export default ManufacturerConfig;
