import React, { useState } from 'react';

interface OptionsListProps {
  options: string[];
  onAdd: (value: string) => void;
  onEdit: (oldValue: string, newValue: string) => void;
  onDelete: (value: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function OptionsList({
  options,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
}: OptionsListProps) {
  const [newValue, setNewValue] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = () => {
    if (newValue.trim() && !options.includes(newValue.trim())) {
      onAdd(newValue.trim());
      setNewValue('');
    }
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(options[index]);
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && editValue.trim()) {
      onEdit(options[editingIndex], editValue.trim());
      setEditingIndex(null);
      setEditValue('');
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditValue('');
  };

  const handleMoveUp = (index: number) => {
    if (index > 0) {
      onReorder(index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index < options.length - 1) {
      onReorder(index, index + 1);
    }
  };

  return (
    <div style={styles.container}>
      {/* Add new option */}
      <div style={styles.addRow}>
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Add new option..."
          style={styles.input}
          onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button onClick={handleAdd} style={styles.addButton}>
          Add
        </button>
      </div>

      {/* Options list */}
      <div style={styles.list}>
        {options.length === 0 ? (
          <p style={styles.emptyText}>No options yet. Add one above.</p>
        ) : (
          options.map((option, index) => (
            <div key={`${option}-${index}`} style={styles.listItem}>
              {editingIndex === index ? (
                <div style={styles.editRow}>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={styles.editInput}
                    onKeyPress={(e) => e.key === 'Enter' && handleSaveEdit()}
                    autoFocus
                  />
                  <button onClick={handleSaveEdit} style={styles.saveButton}>
                    Save
                  </button>
                  <button onClick={handleCancelEdit} style={styles.cancelButton}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span style={styles.optionText}>{option}</span>
                  <div style={styles.actions}>
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      style={{
                        ...styles.iconButton,
                        opacity: index === 0 ? 0.3 : 1,
                      }}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === options.length - 1}
                      style={{
                        ...styles.iconButton,
                        opacity: index === options.length - 1 ? 0.3 : 1,
                      }}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleStartEdit(index)}
                      style={styles.iconButton}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => onDelete(option)}
                      style={{ ...styles.iconButton, color: '#dc3545' }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  addRow: {
    display: 'flex',
    gap: '8px',
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  addButton: {
    padding: '8px 16px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  list: {
    border: '1px solid #ddd',
    borderRadius: '4px',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid #eee',
  },
  optionText: {
    flex: 1,
    fontSize: '14px',
  },
  actions: {
    display: 'flex',
    gap: '4px',
  },
  iconButton: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  editRow: {
    display: 'flex',
    gap: '8px',
    width: '100%',
  },
  editInput: {
    flex: 1,
    padding: '6px 10px',
    border: '1px solid #2196F3',
    borderRadius: '4px',
    fontSize: '14px',
  },
  saveButton: {
    padding: '6px 12px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  cancelButton: {
    padding: '6px 12px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  emptyText: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
  },
};
