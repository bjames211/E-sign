import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { UploadForm } from './components/UploadForm';
import { Dashboard } from './components/Dashboard';
import { OrderForm } from './components/orderForm/OrderForm';
import { OrdersList } from './components/orders/OrdersList';
import { ChangeOrdersList } from './components/orders/ChangeOrdersList';
import { AdminPanel } from './components/admin/AdminPanel';
import { ChangeOrderPage } from './components/orders/ChangeOrderPage';

type View = 'upload' | 'dashboard' | 'new-order' | 'orders' | 'change-orders' | 'admin' | 'change-order';

interface ChangeOrderContext {
  orderId: string;
  changeOrderId?: string; // undefined = new, string = editing
}

function AppContent() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>('upload');
  const [changeOrderContext, setChangeOrderContext] = useState<ChangeOrderContext | null>(null);

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
        return <OrdersList onNavigateToChangeOrder={navigateToChangeOrder} />;
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
      default:
        return <UploadForm onUploadComplete={() => setView('dashboard')} />;
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>BBD E-Sign</h1>
          <nav style={styles.nav}>
            <button
              onClick={() => setView('upload')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'upload' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Upload PDF
            </button>
            <button
              onClick={() => setView('new-order')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'new-order' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              New Order
            </button>
            <button
              onClick={() => setView('orders')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'orders' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Orders
            </button>
            <button
              onClick={() => setView('change-orders')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'change-orders' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Change Orders
            </button>
            <button
              onClick={() => setView('dashboard')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'dashboard' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Dashboard
            </button>
            <button
              onClick={() => setView('admin')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'admin' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Admin
            </button>
          </nav>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.userEmail}>{user.email}</span>
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
    gap: 16,
  },
  userEmail: {
    fontSize: 14,
    opacity: 0.9,
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
