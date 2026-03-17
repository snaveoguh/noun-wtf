import React, { useEffect, useState } from 'react';

interface AsciiPixel {
  ch: string;
  r: number;
  g: number;
  b: number;
}

interface AsciiData {
  pixels: AsciiPixel[];
  width: number;
  height: number;
}

interface Props {
  imageUrl: string;
  cols?: number;
}

const API_BASE = import.meta.env.VITE_MAINNET_SUBGRAPH
  || 'https://spirited-flexibility-production-3c30.up.railway.app';

// Module-level cache to avoid refetching
const asciiCache = new Map<string, AsciiData>();

export default function AsciiImage({ imageUrl, cols = 70 }: Props) {
  const [data, setData] = useState<AsciiData | null>(asciiCache.get(`${imageUrl}:${cols}`) || null);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState(false);

  useEffect(() => {
    const cacheKey = `${imageUrl}:${cols}`;
    if (asciiCache.has(cacheKey)) {
      setData(asciiCache.get(cacheKey)!);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    fetch(`${API_BASE}/api/ascii-image?url=${encodeURIComponent(imageUrl)}&cols=${cols}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result: AsciiData) => {
        if (cancelled) return;
        asciiCache.set(cacheKey, result);
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [imageUrl, cols]);

  if (loading) {
    return (
      <div style={{ color: '#333', fontSize: '11px', padding: '8px 0' }}>
        converting image to ascii...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ color: '#333', fontSize: '11px', padding: '8px 0' }}>
        [image could not be converted]
      </div>
    );
  }

  // Render colored ASCII art
  const rows: React.ReactElement[] = [];
  for (let y = 0; y < data.height; y++) {
    const spans: React.ReactElement[] = [];
    // Group consecutive pixels with same color for efficiency
    let runStart = 0;
    let runColor = '';
    let runChars = '';

    for (let x = 0; x <= data.width; x++) {
      const px = x < data.width ? data.pixels[y * data.width + x] : null;
      const color = px ? `rgb(${px.r},${px.g},${px.b})` : '';

      if (color !== runColor || !px) {
        // Flush previous run
        if (runChars.length > 0) {
          spans.push(
            <span key={runStart} style={{ color: runColor }}>
              {runChars}
            </span>
          );
        }
        runStart = x;
        runColor = color;
        runChars = px ? px.ch : '';
      } else {
        runChars += px.ch;
      }
    }

    rows.push(
      <div key={y} style={{ height: '10px', lineHeight: '10px' }}>
        {spans}
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
        fontSize: '8px',
        letterSpacing: '0.5px',
        lineHeight: '10px',
        whiteSpace: 'pre',
        overflow: 'hidden',
        padding: '8px 0',
      }}
    >
      {rows}
    </div>
  );
}
