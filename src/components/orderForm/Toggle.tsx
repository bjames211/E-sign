import React from 'react';

interface ToggleProps {
  label: string;
  name: string;
  value: boolean;
  onChange: (name: string, value: boolean) => void;
}

export function Toggle({ label, name, value, onChange }: ToggleProps) {
  const handleClick = () => {
    onChange(name, !value);
  };

  return (
    <div style={styles.container} onClick={handleClick}>
      <span style={styles.label}>{label}</span>
      <div style={{ ...styles.track, ...(value ? styles.trackActive : {}) }}>
        <div style={{ ...styles.thumb, ...(value ? styles.thumbActive : {}) }} />
      </div>
      <span style={styles.value}>{value ? 'Yes' : 'No'}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    padding: '8px 0',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    flex: 1,
  },
  track: {
    width: '44px',
    height: '24px',
    backgroundColor: '#ddd',
    borderRadius: '12px',
    position: 'relative',
    transition: 'background-color 0.2s',
  },
  trackActive: {
    backgroundColor: '#2196F3',
  },
  thumb: {
    width: '20px',
    height: '20px',
    backgroundColor: 'white',
    borderRadius: '50%',
    position: 'absolute',
    top: '2px',
    left: '2px',
    transition: 'left 0.2s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  },
  thumbActive: {
    left: '22px',
  },
  value: {
    fontSize: '14px',
    color: '#666',
    width: '30px',
  },
};
