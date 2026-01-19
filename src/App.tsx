import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { UploadForm } from './components/UploadForm';
import { Dashboard } from './components/Dashboard';

type View = 'upload' | 'dashboard';

function AppContent() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>('upload');

  if (!user) {
    return <Login />;
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>E-Sign Automation</h1>
          <nav style={styles.nav}>
            <button
              onClick={() => setView('upload')}
              style={{
                ...styles.navButton,
                backgroundColor: view === 'upload' ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              Upload
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
        {view === 'upload' ? (
          <UploadForm onUploadComplete={() => setView('dashboard')} />
        ) : (
          <DashboardContent />
        )}
      </main>
    </div>
  );
}

function DashboardContent() {
  return <Dashboard />;
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
