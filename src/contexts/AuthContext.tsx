import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// User roles: admin sees everything, manager sees everything, sales_rep sees limited views
export type UserRole = 'admin' | 'manager' | 'sales_rep';

export interface ViewAsUser {
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  userRole: UserRole | null;
  actualRole: UserRole | null; // The real role from Firestore
  userName: string | null; // Display name from user_roles
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isManager: boolean; // manager or admin
  isAdmin: boolean;
  setRoleOverride: (role: UserRole | null) => void; // For testing
  canSwitchRoles: boolean; // Only admins can switch
  viewAsUser: ViewAsUser | null; // Admin viewing as specific user
  setViewAsUser: (user: ViewAsUser | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [roleOverride, setRoleOverride] = useState<UserRole | null>(null); // For testing
  const [viewAsUser, setViewAsUser] = useState<ViewAsUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);

      if (user) {
        // Fetch user role from Firestore
        try {
          const roleDoc = await getDoc(doc(db, 'user_roles', user.email || user.uid));
          if (roleDoc.exists()) {
            const data = roleDoc.data();
            setUserRole(data.role as UserRole);
            setUserName(data.name || null);
          } else {
            // Default to admin if no role set (for initial setup/testing)
            // Change to 'sales_rep' in production
            setUserRole('admin');
          }
        } catch (err) {
          console.error('Error fetching user role:', err);
          setUserRole('admin'); // Default to admin for testing
        }
      } else {
        setUserRole(null);
        setUserName(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signup = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
    setUserRole(null);
  };

  // Use override if set (for testing), otherwise use actual role
  const effectiveRole = roleOverride || userRole;
  const actualRole = userRole;
  const isAdmin = effectiveRole === 'admin';
  const isManager = effectiveRole === 'admin' || effectiveRole === 'manager';
  const canSwitchRoles = userRole === 'admin'; // Only real admins can switch roles

  const value = {
    user,
    userRole: effectiveRole,
    actualRole,
    userName,
    loading,
    login,
    signup,
    logout,
    isManager,
    isAdmin,
    setRoleOverride,
    canSwitchRoles,
    viewAsUser,
    setViewAsUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
