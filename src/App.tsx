import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, where, getDocs } from 'firebase/firestore';
import { db } from './config/firebase';
import { setDepositConfigs } from './types/order';
import { AuthProvider, useAuth, ViewAsUser } from './contexts/AuthContext';
import { Login } from './components/Login';
import { UploadForm } from './components/UploadForm';
import { Dashboard } from './components/Dashboard';
import { OrderForm } from './components/orderForm/OrderForm';
import { OrdersList } from './components/orders/OrdersList';
import { ChangeOrdersList } from './components/orders/ChangeOrdersList';
import { AdminPanel } from './components/admin/AdminPanel';
import { ChangeOrderPage } from './components/orders/ChangeOrderPage';
import { ManagerPayments } from './components/manager/ManagerPayments';
import { SalesDashboard } from './components/sales/SalesDashboard';
import { GlobalSearch } from './components/GlobalSearch';

type View = 'upload' | 'dashboard' | 'new-order' | 'orders' | 'change-orders' | 'admin' | 'change-order' | 'manager-payments' | 'sales-dashboard';

interface ChangeOrderContext {
  orderId: string;
  changeOrderId?: string; // undefined = new, string = editing
}

function AppContent() {
  const { user, logout, userRole, actualRole, isManager, canSwitchRoles, setRoleOverride, viewAsUser, setViewAsUser } = useAuth();
  const [view, setView] = useState<View>('new-order'); // Default to new-order for sales reps
  const [changeOrderContext, setChangeOrderContext] = useState<ChangeOrderContext | null>(null);
  const [initialOrderNumber, setInitialOrderNumber] = useState<string | null>(null);
  const [salesRepUsers, setSalesRepUsers] = useState<ViewAsUser[]>([]);

  // Load sales rep users for admin view-as picker
  useEffect(() => {
    if (!canSwitchRoles) return;
    const q = query(collection(db, 'user_roles'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users: ViewAsUser[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        users.push({ name: data.name || doc.id, email: doc.id });
      });
      users.sort((a, b) => a.name.localeCompare(b.name));
      setSalesRepUsers(users);
    });
    return unsubscribe;
  }, [canSwitchRoles]);

  // Load manufacturer config from Firestore (deposit percentages + tiers)
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const q = query(collection(db, 'manufacturer_config'), where('active', '==', true));
        const snapshot = await getDocs(q);
        const configs: Record<string, { percent?: number | null; tiers?: { upTo: number | null; percent: number }[] }> = {};
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.name && (data.depositPercent != null || (data.depositTiers && data.depositTiers.length > 0))) {
            configs[data.name] = {
              percent: data.depositPercent ?? null,
              tiers: data.depositTiers,
            };
          }
        });
        if (Object.keys(configs).length > 0) {
          setDepositConfigs(configs);
        }
      } catch (err) {
        console.warn('Could not load manufacturer config, using defaults:', err);
      }
    };
    loadConfig();
  }, []);

  // Handle URL query parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get('order');
    if (orderParam) {
      setInitialOrderNumber(orderParam.toUpperCase());
      setView('orders');
      // Clear the URL param after reading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Navigation helper for change orders
  const navigateToChangeOrder = (orderId: string, changeOrderId?: string) => {
    setChangeOrderContext({ orderId, changeOrderId });
    setView('change-order');
  };

  if (!user) {
    return <Login />;
  }

  const renderContent = () => {
    switch (view) {
      case 'upload':
        return <UploadForm onUploadComplete={() => setView('dashboard')} />;
      case 'dashboard':
        return <Dashboard />;
      case 'new-order':
        return <OrderForm onOrderCreated={() => setView('orders')} />;
      case 'orders':
        return (
          <OrdersList
            onNavigateToChangeOrder={navigateToChangeOrder}
            initialOrderNumber={initialOrderNumber}
            onInitialOrderHandled={() => setInitialOrderNumber(null)}
          />
        );
      case 'change-orders':
        return <ChangeOrdersList onNavigateToChangeOrder={navigateToChangeOrder} />;
      case 'admin':
        return <AdminPanel />;
      case 'change-order':
        if (!changeOrderContext) {
          // Fallback if no context set
          setView('orders');
          return null;
        }
        return (
          <ChangeOrderPage
            orderId={changeOrderContext.orderId}
            changeOrderId={changeOrderContext.changeOrderId}
            onComplete={() => {
              setChangeOrderContext(null);
              setView('orders');
            }}
            onCancel={() => {
              setChangeOrderContext(null);
              setView('orders');
            }}
          />
        );
      case 'manager-payments':
        return <ManagerPayments />;
      case 'sales-dashboard':
        return (
          <SalesDashboard
            onNavigateToChangeOrder={navigateToChangeOrder}
          />
        );
      default:
        return <UploadForm onUploadComplete={() => setView('dashboard')} />;
    }
  };

  return (
    <div style={styles.container}>
      <header className="app-header" style={styles.header}>
        <div className="app-header-left" style={styles.headerLeft}>
          <h1 style={styles.logo}>BBD E-Sign</h1>
          <nav className="app-nav" style={styles.nav}>
            {/* Manager-only: Upload PDF */}
            {isManager && (
              <button
                onClick={() => setView('upload')}
                style={{
                  ...styles.navButton,
                  backgroundColor: view === 'upload' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                Upload PDF
              </button>
            )}
            {/* All users: New Order */}
            <button
              onClick={() => setView('new-order')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'new-order' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              New Order
            </button>
            {/* Manager-only: Orders list */}
            {isManager && (
              <button
                onClick={() => setView('orders')}
                style={{
                  ...styles.navButton,
                  backgroundColor: view === 'orders' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                Orders
              </button>
            )}
            {/* Manager-only: Change Orders */}
            {isManager && (
              <button
                onClick={() => setView('change-orders')}
                style={{
                  ...styles.navButton,
                  backgroundColor: view === 'change-orders' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                Change Orders
              </button>
            )}
            {/* Manager-only: Dashboard */}
            {isManager && (
              <button
                onClick={() => setView('dashboard')}
                style={{
                  ...styles.navButton,
                  backgroundColor: view === 'dashboard' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                Dashboard
              </button>
            )}
            {/* Manager-only: Admin */}
            {isManager && (
              <button
                onClick={() => setView('admin')}
                style={{
                  ...styles.navButton,
                  backgroundColor: view === 'admin' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                Admin
              </button>
            )}
            {/* Manager-only: Payments */}
            {isManager && (
              <button
                onClick={() => setView('manager-payments')}
                style={{
                  ...styles.navButton,
                  backgroundColor: view === 'manager-payments' ? 'rgba(255,255,255,0.2)' : 'transparent',
                }}
              >
                Payments
              </button>
            )}
            {/* All users: Sales Dashboard */}
            <button
              onClick={() => setView('sales-dashboard')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'sales-dashboard' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Sales
            </button>
          </nav>
        </div>
        <div className="app-header-right" style={styles.headerRight}>
          {/* Only show search for managers */}
          {isManager && (
            <GlobalSearch
              onSelectOrder={(orderNumber) => {
                setInitialOrderNumber(orderNumber);
                setView('orders');
              }}
              onSelectChangeOrder={(orderId, changeOrderId) => {
                setChangeOrderContext({ orderId, changeOrderId });
                setView('change-order');
              }}
            />
          )}
          <div style={styles.userInfo}>
            <span style={styles.userEmail}>{user.email}</span>
            {canSwitchRoles ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  value={userRole || 'sales_rep'}
                  onChange={(e) => {
                    const newRole = e.target.value as 'admin' | 'manager' | 'sales_rep';
                    setRoleOverride(newRole === actualRole ? null : newRole);
                    if (newRole !== 'sales_rep') {
                      setViewAsUser(null);
                    }
                  }}
                  style={styles.roleSelect}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="sales_rep">Sales Rep</option>
                </select>
                {userRole === 'sales_rep' && salesRepUsers.length > 0 && (
                  <select
                    value={viewAsUser?.email || ''}
                    onChange={(e) => {
                      const selected = salesRepUsers.find(u => u.email === e.target.value);
                      setViewAsUser(selected || null);
                    }}
                    style={{ ...styles.roleSelect, minWidth: 120 }}
                  >
                    <option value="">View as...</option>
                    {salesRepUsers.map((u) => (
                      <option key={u.email} value={u.email}>{u.name}</option>
                    ))}
                  </select>
                )}
                {viewAsUser && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                    as {viewAsUser.name}
                  </span>
                )}
              </div>
            ) : (
              <span style={{
                ...styles.roleBadge,
                backgroundColor: userRole === 'admin' ? '#4caf50' : userRole === 'manager' ? '#2196F3' : '#ff9800',
              }}>
                {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Manager' : 'Sales Rep'}
              </span>
            )}
          </div>
          <button onClick={logout} style={styles.logoutButton}>
            Sign Out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        {renderContent()}
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 30px',
    height: 64,
    backgroundColor: '#2196F3',
    color: '#fff',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 40,
  },
  logo: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
  },
  nav: {
    display: 'flex',
    gap: 8,
  },
  navButton: {
    padding: '8px 16px',
    fontSize: 14,
    fontWeight: 500,
    color: '#fff',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  userEmail: {
    fontSize: 14,
    opacity: 0.9,
  },
  roleBadge: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    color: 'white',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  roleSelect: {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: 'white',
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
  },
  logoutButton: {
    padding: '8px 16px',
    fontSize: 14,
    color: '#2196F3',
    backgroundColor: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500,
  },
  main: {
    padding: 0,
  },
};

export default App;
