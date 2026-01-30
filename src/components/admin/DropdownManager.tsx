import React, { useState, useEffect } from 'react';
import { OptionsList } from './OptionsList';
import {
  getAdminOptions,
  addAdminOption,
  removeAdminOption,
  updateAdminOption,
  reorderAdminOptions,
} from '../../services/adminService';
import { AdminOptionType, ADMIN_OPTION_LABELS } from '../../types/admin';

interface DropdownManagerProps {
  optionType: AdminOptionType;
}

export function DropdownManager({ optionType }: DropdownManagerProps) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOptions();
  }, [optionType]);

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminOptions(optionType);
      setOptions(data);
    } catch (err) {
      setError('Failed to load options');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (value: string) => {
    setSaving(true);
    setError(null);
    try {
      await addAdminOption(optionType, value);
      setOptions([...options, value]);
    } catch (err) {
      setError('Failed to add option');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (oldValue: string, newValue: string) => {
    setSaving(true);
    setError(null);
    try {
      await updateAdminOption(optionType, oldValue, newValue);
      setOptions(options.map((opt) => (opt === oldValue ? newValue : opt)));
    } catch (err) {
      setError('Failed to update option');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (value: string) => {
    if (!window.confirm(`Are you sure you want to delete "${value}"?`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await removeAdminOption(optionType, value);
      setOptions(options.filter((opt) => opt !== value));
    } catch (err) {
      setError('Failed to delete option');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleReorder = async (fromIndex: number, toIndex: number) => {
    setSaving(true);
    setError(null);
    try {
      await reorderAdminOptions(optionType, fromIndex, toIndex);
      const newOptions = [...options];
      const [removed] = newOptions.splice(fromIndex, 1);
      newOptions.splice(toIndex, 0, removed);
      setOptions(newOptions);
    } catch (err) {
      setError('Failed to reorder options');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading options...</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>{ADMIN_OPTION_LABELS[optionType]}</h3>
        <span style={styles.count}>{options.length} options</span>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {saving && <div style={styles.saving}>Saving...</div>}

      <OptionsList
        options={options}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onReorder={handleReorder}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
  },
  count: {
    fontSize: '14px',
    color: '#666',
    backgroundColor: '#f0f0f0',
    padding: '4px 8px',
    borderRadius: '12px',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#666',
  },
  error: {
    padding: '12px',
    marginBottom: '16px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '14px',
  },
  saving: {
    padding: '8px 12px',
    marginBottom: '16px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    borderRadius: '4px',
    fontSize: '14px',
  },
};
