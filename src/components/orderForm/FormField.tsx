import React from 'react';

interface FormFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'number';
  placeholder?: string;
  required?: boolean;
  error?: string;
  multiline?: boolean;
  rows?: number;
}

export function FormField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
  error,
  multiline = false,
  rows = 3,
}: FormFieldProps) {
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    onChange(name, e.target.value);
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>
        {label}
        {required && <span style={styles.required}>*</span>}
      </label>
      {multiline ? (
        <textarea
          name={name}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          rows={rows}
          style={{
            ...styles.input,
            ...styles.textarea,
            ...(error ? styles.inputError : {}),
          }}
        />
      ) : (
        <input
          type={type}
          name={name}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          style={{
            ...styles.input,
            ...(error ? styles.inputError : {}),
          }}
        />
      )}
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
  input: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    transition: 'border-color 0.2s',
  },
  textarea: {
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  inputError: {
    borderColor: '#dc3545',
  },
  errorText: {
    fontSize: '12px',
    color: '#dc3545',
  },
};
