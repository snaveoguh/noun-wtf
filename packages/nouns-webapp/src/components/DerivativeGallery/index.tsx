import React, { useCallback, useRef, useState } from 'react';

// ─── Image processing ───────────────────────────────────────────────────────

/** For GIFs: read as data URL directly (preserves animation) */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

/** For static images: compress via canvas to JPEG */
const compressImage = (file: File, maxSize = 600, quality = 0.75): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });

/** Process file: GIFs stay as-is (animation preserved), others get compressed */
async function processImage(file: File): Promise<string> {
  const isGif = file.type === 'image/gif';
  if (isGif) {
    if (file.size > 2_000_000) {
      throw new Error('GIF too large — max 2MB');
    }
    return readFileAsDataUrl(file);
  }
  return compressImage(file);
}

// ─── API helper ─────────────────────────────────────────────────────────────

const API_URL = '/.netlify/functions/derivatives';

async function uploadDerivative(
  name: string,
  image: string,
  nounId: number,
  auctionUrl?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, image, nounId, ...(auctionUrl && { auctionUrl }) }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) return { success: false, error: data.error ?? 'Upload failed' };
    return { success: true };
  } catch {
    return { success: false, error: 'Network error — please try again' };
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface DerivativeUploadFormProps {
  nounId: number;
  onUploaded?: () => void;
}

const DerivativeUploadForm: React.FC<DerivativeUploadFormProps> = ({ nounId, onUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [name, setName] = useState('');
  const [auctionUrl, setAuctionUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [imageData, setImageData] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    if (file.size > 5_000_000) {
      setError('File too large (max 5MB)');
      return;
    }
    setError('');
    try {
      const processed = await processImage(file);
      setPreview(processed);
      setImageData(processed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file !== undefined) handleFile(file);
    },
    [handleFile],
  );

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setError('Please enter a name for this tab');
      return;
    }
    if (!imageData) {
      setError('Please upload an image');
      return;
    }
    setError('');
    setSuccess('');
    setUploading(true);

    const result = await uploadDerivative(
      name.trim(),
      imageData,
      nounId,
      auctionUrl.trim() || undefined,
    );
    setUploading(false);

    if (result.success) {
      setSuccess('Added to this noun.');
      setName('');
      setAuctionUrl('');
      setPreview('');
      setImageData('');
      onUploaded?.();
      setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(result.error || 'Upload failed');
    }
  }, [auctionUrl, imageData, name, nounId, onUploaded]);

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '4px 0',
      }}
    >
      <p
        style={{
          fontSize: '0.8rem',
          fontWeight: 800,
          color: '#222',
          margin: 0,
          letterSpacing: '0.02em',
          fontFamily: "'PT Root UI', sans-serif",
        }}
      >
        Add artwork for Noun {nounId}
      </p>

      {/* Drop zone */}
      <div
        style={{
          border: `2px dashed ${dragActive ? '#d97706' : 'rgba(0,0,0,0.15)'}`,
          borderRadius: 12,
          padding: preview ? 10 : 24,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'border-color 0.2s, background 0.2s',
          fontSize: '0.7rem',
          fontWeight: 600,
          color: '#777',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          minHeight: 60,
          justifyContent: 'center',
          background: dragActive ? 'rgba(217, 119, 6, 0.05)' : 'rgba(255,255,255,0.4)',
          fontFamily: "'PT Root UI', sans-serif",
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {preview ? (
          <>
            <img
              src={preview}
              alt="Preview"
              style={{
                maxWidth: '100%',
                maxHeight: 200,
                borderRadius: 8,
                objectFit: 'contain',
              }}
            />
            <span style={{ fontSize: '0.6rem', color: '#aaa' }}>Click or drop to replace</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{'\u{1F3A8}'}</span>
            <span>Drop your artwork here or click to browse</span>
            <span style={{ fontSize: '0.55rem', color: '#bbb' }}>
              PNG, JPG, GIF (animated OK!) — max 5MB
            </span>
          </>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file !== undefined) handleFile(file);
        }}
      />

      {/* Artist / title + link + submit */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Artist / title"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: '0.72rem',
            fontWeight: 600,
            outline: 'none',
            flex: 1,
            minWidth: 140,
            fontFamily: "'PT Root UI', sans-serif",
            background: 'rgba(255,255,255,0.6)',
          }}
          maxLength={30}
          onKeyDown={e => {
            if (e.key === 'Enter' && !uploading) handleSubmit();
          }}
        />
        <input
          type="url"
          placeholder="Link (optional — site, social, auction)"
          value={auctionUrl}
          onChange={e => setAuctionUrl(e.target.value)}
          style={{
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: '0.72rem',
            fontWeight: 600,
            outline: 'none',
            flex: 1,
            minWidth: 140,
            fontFamily: "'PT Root UI', sans-serif",
            background: 'rgba(255,255,255,0.6)',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !uploading) handleSubmit();
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={uploading || !name.trim() || !imageData}
          style={{
            background: uploading || !name.trim() || !imageData ? '#ccc' : '#d97706',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 20px',
            fontWeight: 700,
            fontSize: '0.72rem',
            cursor: uploading || !name.trim() || !imageData ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            fontFamily: "'PT Root UI', sans-serif",
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            if (!uploading && name.trim() && imageData)
              e.currentTarget.style.background = '#b45309';
          }}
          onMouseLeave={e => {
            if (!uploading && name.trim() && imageData)
              e.currentTarget.style.background = '#d97706';
          }}
        >
          {uploading ? 'Uploading...' : 'Add Art'}
        </button>
      </div>

      {error && (
        <span style={{ color: '#dc2626', fontSize: '0.65rem', fontWeight: 600 }}>{error}</span>
      )}
      {success && (
        <span style={{ color: '#16a34a', fontSize: '0.65rem', fontWeight: 600 }}>{success}</span>
      )}
    </div>
  );
};

export default DerivativeUploadForm;
