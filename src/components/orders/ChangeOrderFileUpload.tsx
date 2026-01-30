import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { ChangeOrderPendingFiles } from '../../types/changeOrder';
import { PendingFile } from '../../types/order';

interface ChangeOrderFileUploadProps {
  files: ChangeOrderPendingFiles;
  onChange: (files: ChangeOrderPendingFiles) => void;
}

interface FileDropzoneProps {
  label: string;
  description: string;
  accept: Record<string, string[]>;
  multiple: boolean;
  files: PendingFile[];
  onDrop: (acceptedFiles: File[]) => void;
  onRemove: (index: number) => void;
}

function FileDropzone({
  label,
  description,
  accept,
  multiple,
  files,
  onDrop,
  onRemove,
}: FileDropzoneProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    multiple,
  });

  return (
    <div style={styles.dropzoneContainer}>
      <label style={styles.label}>{label}</label>
      <p style={styles.description}>{description}</p>

      <div
        {...getRootProps()}
        style={{
          ...styles.dropzone,
          ...(isDragActive ? styles.dropzoneActive : {}),
        }}
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <p style={styles.dropText}>Drop files here...</p>
        ) : (
          <p style={styles.dropText}>
            Drag & drop {multiple ? 'files' : 'a file'} here, or click to select
          </p>
        )}
      </div>

      {files.length > 0 && (
        <div style={styles.fileList}>
          {files.map((pendingFile, index) => (
            <div key={index} style={styles.fileItem}>
              <div style={styles.fileInfo}>
                <span style={styles.fileName}>{pendingFile.file.name}</span>
                <span style={styles.fileSize}>
                  {(pendingFile.file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                style={styles.removeButton}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChangeOrderFileUpload({ files, onChange }: ChangeOrderFileUploadProps) {
  const handleOrderFormPdfDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onChange({
          ...files,
          orderFormPdf: { file: acceptedFiles[0] },
        });
      }
    },
    [files, onChange]
  );

  const handleRenderingsDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newFiles = acceptedFiles.map((file) => ({ file }));
      onChange({
        ...files,
        renderings: [...files.renderings, ...newFiles],
      });
    },
    [files, onChange]
  );

  const handleExtraFilesDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newFiles = acceptedFiles.map((file) => ({ file }));
      onChange({
        ...files,
        extraFiles: [...files.extraFiles, ...newFiles],
      });
    },
    [files, onChange]
  );

  const handleInstallerFilesDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newFiles = acceptedFiles.map((file) => ({ file }));
      onChange({
        ...files,
        installerFiles: [...files.installerFiles, ...newFiles],
      });
    },
    [files, onChange]
  );

  const removeOrderFormPdf = () => {
    onChange({ ...files, orderFormPdf: null });
  };

  const removeRendering = (index: number) => {
    onChange({
      ...files,
      renderings: files.renderings.filter((_, i) => i !== index),
    });
  };

  const removeExtraFile = (index: number) => {
    onChange({
      ...files,
      extraFiles: files.extraFiles.filter((_, i) => i !== index),
    });
  };

  const removeInstallerFile = (index: number) => {
    onChange({
      ...files,
      installerFiles: files.installerFiles.filter((_, i) => i !== index),
    });
  };

  return (
    <div style={styles.section}>
      <h5 style={styles.sectionTitle}>Files & Documents</h5>

      <div style={styles.uploadGrid}>
        {/* Order Form PDF */}
        <FileDropzone
          label="Order Form PDF"
          description="New PDF to send for e-signature (optional - uses existing if not provided)"
          accept={{ 'application/pdf': ['.pdf'] }}
          multiple={false}
          files={files.orderFormPdf ? [files.orderFormPdf] : []}
          onDrop={handleOrderFormPdfDrop}
          onRemove={removeOrderFormPdf}
        />

        {/* 3D Renderings */}
        <FileDropzone
          label="3D Renderings"
          description="Upload updated building renderings"
          accept={{
            'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
          }}
          multiple={true}
          files={files.renderings}
          onDrop={handleRenderingsDrop}
          onRemove={removeRendering}
        />

        {/* Extra Files */}
        <FileDropzone
          label="Extra Files"
          description="Any additional documents"
          accept={{
            'application/pdf': ['.pdf'],
            'image/*': ['.png', '.jpg', '.jpeg', '.gif'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          }}
          multiple={true}
          files={files.extraFiles}
          onDrop={handleExtraFilesDrop}
          onRemove={removeExtraFile}
        />

        {/* Files for Installer */}
        <FileDropzone
          label="Files for Installer"
          description="Documents for the installer"
          accept={{
            'application/pdf': ['.pdf'],
            'image/*': ['.png', '.jpg', '.jpeg', '.gif'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          }}
          multiple={true}
          files={files.installerFiles}
          onDrop={handleInstallerFilesDrop}
          onRemove={removeInstallerFile}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  uploadGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  dropzoneContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#333',
  },
  description: {
    fontSize: '11px',
    color: '#666',
    margin: 0,
  },
  dropzone: {
    border: '2px dashed #ddd',
    borderRadius: '6px',
    padding: '16px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    backgroundColor: 'white',
  },
  dropzoneActive: {
    borderColor: '#1565c0',
    backgroundColor: '#e3f2fd',
  },
  dropText: {
    margin: 0,
    color: '#666',
    fontSize: '12px',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '6px',
  },
  fileItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
  },
  fileInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  fileName: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#333',
  },
  fileSize: {
    fontSize: '10px',
    color: '#666',
  },
  removeButton: {
    padding: '3px 6px',
    backgroundColor: 'transparent',
    border: '1px solid #c62828',
    borderRadius: '4px',
    color: '#c62828',
    fontSize: '11px',
    cursor: 'pointer',
  },
};
