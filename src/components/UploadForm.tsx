import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { uploadDocument, SignerInfo } from '../services/uploadService';

interface UploadFormProps {
  onUploadComplete?: (documentId: string) => void;
}

const INSTALLERS = [
  { value: 'Eagle Carports', label: 'Eagle Carports' },
  { value: 'American Carports', label: 'American West Coast' },
];

export function UploadForm({ onUploadComplete }: UploadFormProps) {
  const [signerEmail, setSignerEmail] = useState('');
  const [signerName, setSignerName] = useState('');
  const [installer, setInstaller] = useState('Eagle Carports');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string>('');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setStatus('');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !signerEmail || !signerName) {
      setStatus('Please fill all fields and upload a PDF');
      return;
    }

    setUploading(true);
    setStatus('Uploading...');

    try {
      const signerInfo: SignerInfo = { email: signerEmail, name: signerName };
      const result = await uploadDocument(file, signerInfo, installer);

      setStatus(`Document uploaded! ID: ${result.documentId}. E-signature request will be sent automatically.`);
      setFile(null);
      setSignerEmail('');
      setSignerName('');
      onUploadComplete?.(result.documentId);
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Upload failed'}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <h2 style={styles.title}>Upload Document for E-Signature</h2>

      <div style={styles.field}>
        <label style={styles.label}>Signer Name</label>
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="John Doe"
          style={styles.input}
          required
        />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Signer Email</label>
        <input
          type="email"
          value={signerEmail}
          onChange={(e) => setSignerEmail(e.target.value)}
          placeholder="john@example.com"
          style={styles.input}
          required
        />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Installer</label>
        <select
          value={installer}
          onChange={(e) => setInstaller(e.target.value)}
          style={styles.select}
          required
        >
          {INSTALLERS.map((inst) => (
            <option key={inst.value} value={inst.value}>
              {inst.label}
            </option>
          ))}
        </select>
      </div>

      <div
        {...getRootProps()}
        style={{
          ...styles.dropzone,
          borderColor: isDragActive ? '#4CAF50' : '#ccc',
          backgroundColor: isDragActive ? '#f0fff0' : '#fafafa',
        }}
      >
        <input {...getInputProps()} />
        {file ? (
          <p style={styles.fileName}>{file.name}</p>
        ) : isDragActive ? (
          <p>Drop the PDF here...</p>
        ) : (
          <p>Drag & drop a PDF here, or click to select</p>
        )}
      </div>

      <button
        type="submit"
        disabled={uploading || !file}
        style={{
          ...styles.button,
          opacity: uploading || !file ? 0.6 : 1,
        }}
      >
        {uploading ? 'Uploading...' : 'Upload & Send for Signature'}
      </button>

      {status && (
        <p style={{
          ...styles.status,
          color: status.includes('Error') ? '#d32f2f' : '#4CAF50',
        }}>
          {status}
        </p>
      )}
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    maxWidth: 500,
    margin: '40px auto',
    padding: 30,
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
  },
  title: {
    marginBottom: 24,
    fontSize: 24,
    fontWeight: 600,
    color: '#333',
  },
  field: {
    marginBottom: 20,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 14,
    fontWeight: 500,
    color: '#555',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16,
    border: '1px solid #ddd',
    borderRadius: 8,
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16,
    border: '1px solid #ddd',
    borderRadius: 8,
    outline: 'none',
    backgroundColor: '#fff',
    cursor: 'pointer',
  },
  dropzone: {
    padding: 40,
    border: '2px dashed #ccc',
    borderRadius: 8,
    textAlign: 'center' as const,
    cursor: 'pointer',
    marginBottom: 20,
    transition: 'all 0.2s',
  },
  fileName: {
    fontWeight: 500,
    color: '#4CAF50',
  },
  button: {
    width: '100%',
    padding: 14,
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#2196F3',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  status: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    fontSize: 14,
  },
};
