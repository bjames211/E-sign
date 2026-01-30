import React, { useState } from 'react';
import { DropdownManager } from './DropdownManager';
import { seedAdminOptions } from '../../services/adminService';
import { AdminOptionType, ALL_ADMIN_OPTION_TYPES, ADMIN_OPTION_LABELS } from '../../types/admin';

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<AdminOptionType>('manufacturers');
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const handleSeedData = async () => {
    if (!window.confirm('This will reset all admin options to default values. Continue?')) {
      return;
    }
    setSeeding(true);
    setSeedMessage(null);
    try {
      await seedAdminOptions();
      setSeedMessage('Admin options seeded successfully! Refresh the page to see changes.');
    } catch (err) {
      setSeedMessage('Failed to seed admin options');
      console.error(err);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Admin Panel</h2>
        <p style={styles.subtitle}>Manage dropdown options for the order form</p>
        <button
          onClick={handleSeedData}
          disabled={seeding}
          style={styles.seedButton}
        >
          {seeding ? 'Seeding...' : 'Reset to Defaults'}
        </button>
        {seedMessage && (
          <div style={styles.seedMessage}>{seedMessage}</div>
        )}
      </div>

      <div style={styles.content}>
        {/* Tabs */}
        <div style={styles.tabs}>
          {ALL_ADMIN_OPTION_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              style={{
                ...styles.tab,
                ...(activeTab === type ? styles.activeTab : {}),
              }}
            >
              {ADMIN_OPTION_LABELS[type]}
            </button>
          ))}
        </div>

        {/* Active panel */}
        <div style={styles.panel}>
          <DropdownManager key={activeTab} optionType={activeTab} />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
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
    margin: '0 0 16px 0',
    color: '#666',
  },
  seedButton: {
    padding: '8px 16px',
    backgroundColor: '#ff9800',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  seedMessage: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    borderRadius: '4px',
    fontSize: '14px',
  },
  content: {
    display: 'flex',
    gap: '24px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  tabs: {
    display: 'flex',
    flexDirection: 'column',
    width: '200px',
    backgroundColor: '#f5f5f5',
    borderRight: '1px solid #e0e0e0',
    padding: '8px 0',
  },
  tab: {
    padding: '12px 16px',
    textAlign: 'left',
    backgroundColor: 'transparent',
    border: 'none',
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
    transition: 'all 0.2s',
  },
  activeTab: {
    backgroundColor: 'white',
    borderLeftColor: '#2196F3',
    fontWeight: 600,
    color: '#2196F3',
  },
  panel: {
    flex: 1,
    minHeight: '500px',
  },
};
