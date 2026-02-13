import React, { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Order } from '../types/order';

interface SearchResult {
  type: 'order' | 'change-order';
  id: string;
  title: string;
  subtitle: string;
  orderNumber: string;
  status: string;
  changeOrderId?: string;
}

interface GlobalSearchProps {
  onSelectOrder: (orderNumber: string) => void;
  onSelectChangeOrder?: (orderId: string, changeOrderId: string) => void;
}

export function GlobalSearch({ onSelectOrder, onSelectChangeOrder }: GlobalSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [changeOrders, setChangeOrders] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut to focus search (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadData = async () => {
    try {
      // Load orders
      const ordersQuery = query(
        collection(db, 'orders'),
        orderBy('createdAt', 'desc'),
        limit(500)
      );
      const ordersSnapshot = await getDocs(ordersQuery);
      const ordersData: Order[] = [];
      ordersSnapshot.forEach((doc) => {
        ordersData.push({ ...doc.data(), id: doc.id } as Order);
      });
      setOrders(ordersData);

      // Load change orders
      const coQuery = query(
        collection(db, 'change_orders'),
        orderBy('createdAt', 'desc'),
        limit(500)
      );
      const coSnapshot = await getDocs(coQuery);
      const coData: any[] = [];
      coSnapshot.forEach((doc) => {
        coData.push({ ...doc.data(), id: doc.id });
      });
      setChangeOrders(coData);
    } catch (err) {
      console.error('Failed to load search data:', err);
    }
  };

  // Search when term changes
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    const term = searchTerm.toLowerCase();

    const searchResults: SearchResult[] = [];

    // Search orders
    orders.forEach((order) => {
      const orderNum = order.orderNumber?.toLowerCase() || '';
      const firstName = order.customer?.firstName?.toLowerCase() || '';
      const lastName = order.customer?.lastName?.toLowerCase() || '';
      const email = order.customer?.email?.toLowerCase() || '';
      const fullName = `${firstName} ${lastName}`;

      if (
        orderNum.includes(term) ||
        firstName.includes(term) ||
        lastName.includes(term) ||
        fullName.includes(term) ||
        email.includes(term)
      ) {
        searchResults.push({
          type: 'order',
          id: (order as any).id,
          title: order.orderNumber,
          subtitle: `${order.customer?.firstName || ''} ${order.customer?.lastName || ''} - ${order.customer?.email || ''}`,
          orderNumber: order.orderNumber,
          status: order.status,
        });
      }
    });

    // Search change orders
    changeOrders.forEach((co) => {
      const coNum = co.changeOrderNumber?.toLowerCase() || '';
      const parentOrder = orders.find((o) => (o as any).id === co.orderId);
      const orderNum = parentOrder?.orderNumber?.toLowerCase() || '';

      if (coNum.includes(term) || orderNum.includes(term)) {
        searchResults.push({
          type: 'change-order',
          id: co.orderId,
          title: co.changeOrderNumber,
          subtitle: `Change Order for ${parentOrder?.orderNumber || 'Unknown Order'}`,
          orderNumber: parentOrder?.orderNumber || '',
          status: co.status,
          changeOrderId: co.id,
        });
      }
    });

    // Limit results
    setResults(searchResults.slice(0, 10));
    setLoading(false);
    setSelectedIndex(-1);
  }, [searchTerm, orders, changeOrders]);

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'order') {
      onSelectOrder(result.orderNumber);
    } else if (result.type === 'change-order' && onSelectChangeOrder && result.changeOrderId) {
      onSelectChangeOrder(result.id, result.changeOrderId);
    } else {
      // Fallback to order view
      onSelectOrder(result.orderNumber);
    }
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return { bg: '#f5f5f5', color: '#666' };
      case 'pending_payment':
        return { bg: '#fff3e0', color: '#e65100' };
      case 'sent_for_signature':
      case 'pending_signature':
        return { bg: '#e3f2fd', color: '#1565c0' };
      case 'signed':
        return { bg: '#e8f5e9', color: '#2e7d32' };
      case 'ready_for_manufacturer':
        return { bg: '#c8e6c9', color: '#1b5e20' };
      default:
        return { bg: '#f5f5f5', color: '#666' };
    }
  };

  return (
    <div ref={containerRef} style={styles.container}>
      <div style={styles.inputWrapper}>
        <svg style={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search orders... (Cmd+K)"
          style={styles.input}
        />
        {searchTerm && (
          <button
            onClick={() => {
              setSearchTerm('');
              setResults([]);
            }}
            style={styles.clearButton}
          >
            ×
          </button>
        )}
      </div>

      {isOpen && searchTerm && (
        <div style={styles.dropdown}>
          {loading ? (
            <div style={styles.loadingState}>Searching...</div>
          ) : results.length === 0 ? (
            <div style={styles.emptyState}>No results found</div>
          ) : (
            <div style={styles.resultsList}>
              {results.map((result, index) => {
                const statusColor = getStatusColor(result.status);
                return (
                  <div
                    key={`${result.type}-${result.id}-${result.changeOrderId || ''}`}
                    onClick={() => handleSelect(result)}
                    style={{
                      ...styles.resultItem,
                      backgroundColor: index === selectedIndex ? '#f0f7ff' : 'transparent',
                    }}
                  >
                    <div style={styles.resultLeft}>
                      <span
                        style={{
                          ...styles.typeBadge,
                          backgroundColor: result.type === 'order' ? '#e3f2fd' : '#fff3e0',
                          color: result.type === 'order' ? '#1565c0' : '#e65100',
                        }}
                      >
                        {result.type === 'order' ? 'Order' : 'CO'}
                      </span>
                      <div style={styles.resultText}>
                        <div style={styles.resultTitle}>{result.title}</div>
                        <div style={styles.resultSubtitle}>{result.subtitle}</div>
                      </div>
                    </div>
                    <span
                      style={{
                        ...styles.statusBadge,
                        backgroundColor: statusColor.bg,
                        color: statusColor.color,
                      }}
                    >
                      {result.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '300px',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    width: '16px',
    height: '16px',
    color: 'rgba(255,255,255,0.7)',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    padding: '8px 32px 8px 36px',
    fontSize: '14px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: 'white',
    outline: 'none',
  },
  clearButton: {
    position: 'absolute',
    right: '8px',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 4px',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '8px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    overflow: 'hidden',
    zIndex: 1000,
    maxHeight: '400px',
    overflowY: 'auto',
  },
  loadingState: {
    padding: '16px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  },
  emptyState: {
    padding: '16px',
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
  },
  resultsList: {
    padding: '8px 0',
  },
  resultItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  resultLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  typeBadge: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  resultText: {
    display: 'flex',
    flexDirection: 'column',
  },
  resultTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  resultSubtitle: {
    fontSize: '12px',
    color: '#666',
    marginTop: '2px',
  },
  statusBadge: {
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
    textTransform: 'capitalize',
  },
};

export default GlobalSearch;
