import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { UserRole } from '../../contexts/AuthContext';

interface UserRoleDoc {
  email: string;
  role: UserRole;
  name?: string;
  createdAt?: any;
}

export function UserManagement() {
  const [users, setUsers] = useState<UserRoleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('sales_rep');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load users
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'user_roles'),
      (snapshot) => {
        const usersData: UserRoleDoc[] = [];
        snapshot.forEach((doc) => {
          usersData.push({
            email: doc.id,
            ...doc.data(),
          } as UserRoleDoc);
        });
        // Sort by role priority then by name
        usersData.sort((a, b) => {
          const rolePriority = { admin: 0, manager: 1, sales_rep: 2 };
          const aPriority = rolePriority[a.role] ?? 3;
          const bPriority = rolePriority[b.role] ?? 3;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return (a.name || a.email).localeCompare(b.name || b.email);
        });
        setUsers(usersData);
        setLoading(false);
      },
      (err) => {
        console.error('Error loading users:', err);
        setError('Failed to load users');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) {
      setError('Email is required');
      return;
    }

    const email = newEmail.trim().toLowerCase();

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Invalid email format');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await setDoc(doc(db, 'user_roles', email), {
        role: newRole,
        name: newName.trim() || null,
        createdAt: new Date(),
      });
      setNewEmail('');
      setNewName('');
      setNewRole('sales_rep');
    } catch (err) {
      console.error('Error adding user:', err);
      setError('Failed to add user');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRole = async (email: string, newRole: UserRole) => {
    try {
      const userDoc = users.find(u => u.email === email);
      await setDoc(doc(db, 'user_roles', email), {
        role: newRole,
        name: userDoc?.name || null,
        createdAt: userDoc?.createdAt || new Date(),
      });
    } catch (err) {
      console.error('Error updating role:', err);
      setError('Failed to update role');
    }
  };

  const handleDeleteUser = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the system? They will default to admin role until re-added.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'user_roles', email));
    } catch (err) {
      console.error('Error deleting user:', err);
      setError('Failed to delete user');
    }
  };

  const getRoleBadgeStyle = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return { backgroundColor: '#4caf50', color: 'white' };
      case 'manager':
        return { backgroundColor: '#2196F3', color: 'white' };
      case 'sales_rep':
        return { backgroundColor: '#ff9800', color: 'white' };
      default:
        return { backgroundColor: '#9e9e9e', color: 'white' };
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading users...</div>;
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>User Management</h3>
      <p style={styles.subtitle}>Add and manage user roles. Users not in this list will default to admin role.</p>

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      {/* Add User Form */}
      <form onSubmit={handleAddUser} style={styles.addForm}>
        <div style={styles.formRow}>
          <input
            type="email"
            placeholder="Email address"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ ...styles.input, width: '150px' }}
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
            style={styles.select}
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="sales_rep">Sales Rep</option>
          </select>
          <button type="submit" disabled={saving} style={styles.addButton}>
            {saving ? 'Adding...' : 'Add User'}
          </button>
        </div>
      </form>

      {/* Users List */}
      <div style={styles.usersList}>
        <div style={styles.listHeader}>
          <span style={{ ...styles.headerCell, flex: 2 }}>Email</span>
          <span style={{ ...styles.headerCell, flex: 1 }}>Name</span>
          <span style={{ ...styles.headerCell, width: '120px' }}>Role</span>
          <span style={{ ...styles.headerCell, width: '80px' }}>Actions</span>
        </div>

        {users.length === 0 ? (
          <div style={styles.emptyState}>
            No users configured. Add users above to assign roles.
          </div>
        ) : (
          users.map((user) => (
            <div key={user.email} style={styles.userRow}>
              <span style={{ ...styles.cell, flex: 2, fontFamily: 'monospace' }}>
                {user.email}
              </span>
              <span style={{ ...styles.cell, flex: 1, color: user.name ? '#333' : '#999' }}>
                {user.name || '-'}
              </span>
              <span style={{ ...styles.cell, width: '120px' }}>
                <select
                  value={user.role}
                  onChange={(e) => handleUpdateRole(user.email, e.target.value as UserRole)}
                  style={{
                    ...styles.roleSelect,
                    ...getRoleBadgeStyle(user.role),
                  }}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="sales_rep">Sales Rep</option>
                </select>
              </span>
              <span style={{ ...styles.cell, width: '80px' }}>
                <button
                  onClick={() => handleDeleteUser(user.email)}
                  style={styles.deleteButton}
                  title="Remove user"
                >
                  Remove
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Role Descriptions */}
      <div style={styles.roleDescriptions}>
        <h4 style={styles.roleDescTitle}>Role Permissions</h4>
        <div style={styles.roleDesc}>
          <span style={{ ...styles.roleBadge, ...getRoleBadgeStyle('admin') }}>Admin</span>
          <span>Full access to all features + can switch between roles for testing</span>
        </div>
        <div style={styles.roleDesc}>
          <span style={{ ...styles.roleBadge, ...getRoleBadgeStyle('manager') }}>Manager</span>
          <span>Full access to all features (Orders, Change Orders, Payments, Admin, etc.)</span>
        </div>
        <div style={styles.roleDesc}>
          <span style={{ ...styles.roleBadge, ...getRoleBadgeStyle('sales_rep') }}>Sales Rep</span>
          <span>New Order + Sales Dashboard only</span>
        </div>
      </div>
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
    width: '220px',
  },
  select: {
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
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
  usersList: {
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
  userRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #f0f0f0',
  },
  cell: {
    padding: '0 8px',
    fontSize: '14px',
  },
  roleSelect: {
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'white\'%3e%3cpath d=\'M7 10l5 5 5-5z\'/%3e%3c/svg%3e")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 4px center',
    backgroundSize: '18px',
    paddingRight: '24px',
  },
  deleteButton: {
    padding: '4px 8px',
    fontSize: '12px',
    color: '#f44336',
    backgroundColor: 'transparent',
    border: '1px solid #f44336',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  emptyState: {
    padding: '40px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  roleDescriptions: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
  },
  roleDescTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  roleDesc: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
    fontSize: '13px',
    color: '#666',
  },
  roleBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 600,
    borderRadius: '4px',
    minWidth: '70px',
    textAlign: 'center',
  },
};

export default UserManagement;
