import React, { useState, useEffect, useRef } from 'react';
import { Quote } from '../../types/order';
import { getQuotes } from '../../services/orderService';

interface QuoteSearchProps {
  onSelectQuote: (quote: Quote) => void;
  onStartBlank: () => void;
}

export function QuoteSearch({
  onSelectQuote,
  onStartBlank,
}: QuoteSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [filteredQuotes, setFilteredQuotes] = useState<Quote[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadQuotes();
  }, []);

  useEffect(() => {
    // Handle click outside to close dropdown
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // Filter quotes based on search term
    if (searchTerm.trim()) {
      const filtered = quotes.filter(
        (q) =>
          q.quoteNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          q.customerName.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredQuotes(filtered);
    } else {
      setFilteredQuotes(quotes);
    }
  }, [searchTerm, quotes]);

  const loadQuotes = async () => {
    setLoading(true);
    try {
      const data = await getQuotes();
      setQuotes(data);
      setFilteredQuotes(data);
    } catch (err) {
      console.error('Failed to load quotes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQuote = (quote: Quote) => {
    setSelectedQuote(quote);
    setSearchTerm(`${quote.quoteNumber} - ${quote.customerName}`);
    setIsOpen(false);
    onSelectQuote(quote);
  };

  const handleClear = () => {
    setSelectedQuote(null);
    setSearchTerm('');
    onStartBlank();
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Start from Quote</h3>
        <p style={styles.subtitle}>
          Search for an existing quote to auto-fill the form, or start with a blank form.
        </p>
      </div>

      <div style={styles.searchRow} ref={wrapperRef}>
        <div style={styles.searchWrapper}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search by quote number or customer name..."
            style={styles.searchInput}
          />
          {selectedQuote && (
            <button onClick={handleClear} style={styles.clearButton}>
              ×
            </button>
          )}

          {isOpen && (
            <div style={styles.dropdown}>
              {loading ? (
                <div style={styles.dropdownItem}>Loading quotes...</div>
              ) : filteredQuotes.length === 0 ? (
                <div style={styles.dropdownItem}>No quotes found</div>
              ) : (
                filteredQuotes.map((quote) => (
                  <div
                    key={quote.id}
                    style={{
                      ...styles.dropdownItem,
                      ...(selectedQuote?.id === quote.id
                        ? styles.dropdownItemSelected
                        : {}),
                    }}
                    onClick={() => handleSelectQuote(quote)}
                  >
                    <div style={styles.quoteNumber}>{quote.quoteNumber}</div>
                    <div style={styles.customerName}>{quote.customerName}</div>
                    <div style={styles.quoteDetails}>
                      {quote.building.manufacturer} - {quote.building.buildingType} |
                      ${quote.pricing.subtotalBeforeTax.toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button onClick={handleClear} style={styles.blankButton}>
          Start Blank
        </button>
      </div>

      {selectedQuote && (
        <div style={styles.selectedInfo}>
          <span style={styles.selectedLabel}>Selected:</span>
          <span style={styles.selectedValue}>
            {selectedQuote.quoteNumber} - {selectedQuote.customerName}
          </span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
    padding: '20px 24px',
    marginBottom: '24px',
  },
  header: {
    marginBottom: '16px',
  },
  title: {
    margin: '0 0 4px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#1565c0',
  },
  subtitle: {
    margin: 0,
    fontSize: '14px',
    color: '#666',
  },
  searchRow: {
    display: 'flex',
    gap: '12px',
    position: 'relative',
  },
  searchWrapper: {
    flex: 1,
    position: 'relative',
  },
  searchInput: {
    width: '100%',
    padding: '12px 40px 12px 16px',
    border: '1px solid #90caf9',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
    boxSizing: 'border-box',
  },
  clearButton: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '20px',
    color: '#666',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1,
  },
  blankButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    border: '1px solid #90caf9',
    borderRadius: '4px',
    fontSize: '14px',
    color: '#1565c0',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    maxHeight: '300px',
    overflowY: 'auto',
    zIndex: 100,
    marginTop: '4px',
  },
  dropdownItem: {
    padding: '12px 16px',
    cursor: 'pointer',
    borderBottom: '1px solid #eee',
    transition: 'background-color 0.2s',
  },
  dropdownItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  quoteNumber: {
    fontWeight: 600,
    fontSize: '14px',
    color: '#1565c0',
  },
  customerName: {
    fontSize: '14px',
    color: '#333',
    marginTop: '2px',
  },
  quoteDetails: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  selectedInfo: {
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: 'white',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  selectedLabel: {
    fontSize: '12px',
    color: '#666',
  },
  selectedValue: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#1565c0',
  },
};
