import React from 'react';

interface FormDropdownProps {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  error?: string;
  loading?: boolean;
}

export function FormDropdown({
  label,
  name,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  required = false,
  error,
  loading = false,
}: FormDropdownProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(name, e.target.value);
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>
        {label}
        {required && <span style={styles.required}>*</span>}
      </label>
      <select
        name={name}
        value={value}
        onChange={handleChange}
        disabled={loading}
        style={{
          ...styles.select,
          ...(error ? styles.selectError : {}),
          ...(loading ? styles.selectLoading : {}),
        }}
      >
        <option value="">{loading ? 'Loading...' : placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && <span style={styles.errorText}>{error}</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  required: {
    color: '#dc3545',
    marginLeft: '4px',
  },
  select: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  selectError: {
    borderColor: '#dc3545',
  },
  selectLoading: {
    backgroundColor: '#f5f5f5',
    cursor: 'wait',
  },
  errorText: {
    fontSize: '12px',
    color: '#dc3545',
  },
};
