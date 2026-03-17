import { getStore } from '@netlify/blobs';

interface Derivative {
  id: string;
  name: string;
  image: string; // base64 data URL (JPEG for static, original for GIFs)
  nounId?: number; // which noun this derivative is for
  auctionUrl?: string; // external auction link (Manifold, Zora, etc.)
  tokenId?: number; // onchain ERC721 token ID (set after mint)
  tokenURI?: string; // IPFS metadata URI (set after pin)
  createdAt: string;
}

// ── IPFS pinning via Pinata ─────────────────────────────────────────────

async function pinToIPFS(
  data: Uint8Array | string,
  filename: string,
  isJSON = false,
): Promise<string> {
  const PINATA_JWT = process.env.PINATA_JWT;
  if (!PINATA_JWT) throw new Error('PINATA_JWT not configured');

  if (isJSON) {
    // Pin JSON directly
    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)),
        pinataMetadata: { name: filename },
      }),
    });
    if (!res.ok) throw new Error(`Pinata JSON pin failed: ${res.status}`);
    const result = await res.json();
    return result.IpfsHash;
  }

  // Pin file via multipart form
  const formData = new FormData();
  const blob = new Blob([data]);
  formData.append('file', blob, filename);
  formData.append('pinataMetadata', JSON.stringify({ name: filename }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Pinata file pin failed: ${res.status}`);
  const result = await res.json();
  return result.IpfsHash;
}

const STORE_NAME = 'noun-derivatives';
const META_KEY = 'all-derivatives';

// CORS headers for the Vite dev server and production
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const store = getStore(STORE_NAME);

  // GET — list derivatives (optionally filtered by nounId)
  if (req.method === 'GET') {
    try {
      const raw = await store.get(META_KEY);
      let derivatives: Derivative[] = raw ? JSON.parse(raw) : [];

      // Filter by nounId if provided
      const url = new URL(req.url);
      const nounIdParam = url.searchParams.get('nounId');
      if (nounIdParam !== null) {
        const nounId = parseInt(nounIdParam, 10);
        if (!isNaN(nounId)) {
          derivatives = derivatives.filter(d => d.nounId === nounId);
        }
      }

      return new Response(JSON.stringify(derivatives), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  // POST — add a new derivative
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { name, image, nounId, auctionUrl } = body as {
        name?: string;
        image?: string;
        nounId?: number;
        auctionUrl?: string;
      };

      // Validate
      if (nounId === undefined || typeof nounId !== 'number') {
        return new Response(JSON.stringify({ error: 'nounId is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Name is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
        return new Response(JSON.stringify({ error: 'Valid image data URL is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      // Max ~3MB for the image data URL (GIFs can be larger)
      if (image.length > 3_000_000) {
        return new Response(JSON.stringify({ error: 'Image too large (max 3MB)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      if (name.trim().length > 100) {
        return new Response(JSON.stringify({ error: 'Name too long (max 100 chars)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      // Validate auctionUrl if provided
      if (auctionUrl && typeof auctionUrl === 'string' && auctionUrl.trim().length > 0) {
        try {
          new URL(auctionUrl.trim());
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid auction URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // Read existing
      let derivatives: Derivative[] = [];
      try {
        const raw = await store.get(META_KEY);
        derivatives = raw ? JSON.parse(raw) : [];
      } catch {
        derivatives = [];
      }

      // Create new derivative
      const trimmedAuctionUrl = auctionUrl?.trim();
      const newDerivative: Derivative = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        image,
        nounId,
        ...(trimmedAuctionUrl && { auctionUrl: trimmedAuctionUrl }),
        createdAt: new Date().toISOString(),
      };

      // Prepend (newest first)
      derivatives.unshift(newDerivative);

      // Save
      await store.set(META_KEY, JSON.stringify(derivatives));

      return new Response(
        JSON.stringify({ success: true, id: newDerivative.id }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Failed to save derivative' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        },
      );
    }
  }

  // PATCH — update fields on an existing derivative (auctionUrl, tokenId, tokenURI)
  if (req.method === 'PATCH') {
    try {
      const body = await req.json();
      const { id, auctionUrl, tokenId, tokenURI } = body as {
        id?: string;
        auctionUrl?: string;
        tokenId?: number;
        tokenURI?: string;
      };

      if (!id || typeof id !== 'string') {
        return new Response(JSON.stringify({ error: 'id is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Validate URL if provided and non-empty
      const trimmedUrl = auctionUrl?.trim() || '';
      if (trimmedUrl) {
        try {
          new URL(trimmedUrl);
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid auction URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      const raw = await store.get(META_KEY);
      const derivatives: Derivative[] = raw ? JSON.parse(raw) : [];
      const idx = derivatives.findIndex(d => d.id === id);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: 'Derivative not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Set or clear the auctionUrl
      if (trimmedUrl) {
        derivatives[idx].auctionUrl = trimmedUrl;
      } else if (auctionUrl !== undefined) {
        delete derivatives[idx].auctionUrl;
      }

      // Set onchain tokenId if provided
      if (tokenId !== undefined && typeof tokenId === 'number') {
        derivatives[idx].tokenId = tokenId;
      }

      // Set IPFS tokenURI if provided
      if (tokenURI && typeof tokenURI === 'string') {
        derivatives[idx].tokenURI = tokenURI;
      }

      await store.set(META_KEY, JSON.stringify(derivatives));

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to update' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  // PUT — pin a derivative's image to IPFS and return tokenURI
  if (req.method === 'PUT') {
    try {
      const body = await req.json();
      const { id } = body as { id?: string };

      if (!id || typeof id !== 'string') {
        return new Response(JSON.stringify({ error: 'id is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const raw = await store.get(META_KEY);
      const derivatives: Derivative[] = raw ? JSON.parse(raw) : [];
      const deriv = derivatives.find(d => d.id === id);
      if (!deriv) {
        return new Response(JSON.stringify({ error: 'Derivative not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Already pinned?
      if (deriv.tokenURI) {
        return new Response(JSON.stringify({ tokenURI: deriv.tokenURI }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Decode base64 image
      const base64Match = deriv.image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!base64Match) {
        return new Response(JSON.stringify({ error: 'Invalid image format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const [, ext, b64] = base64Match;
      const imageBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

      // 1. Pin image to IPFS
      const imageHash = await pinToIPFS(imageBytes, `derivative-${id}.${ext}`);

      // 2. Build + pin ERC721 metadata JSON
      const metadata = {
        name: deriv.name,
        description: `Derivative of Noun #${deriv.nounId ?? 'unknown'}`,
        image: `ipfs://${imageHash}`,
        attributes: [
          { trait_type: 'Noun ID', value: deriv.nounId ?? 0 },
          { trait_type: 'Creator', value: deriv.name },
        ],
      };
      const metadataHash = await pinToIPFS(JSON.stringify(metadata), `metadata-${id}.json`, true);
      const tokenURI = `ipfs://${metadataHash}`;

      // 3. Store tokenURI back on the derivative record
      const idx = derivatives.findIndex(d => d.id === id);
      derivatives[idx].tokenURI = tokenURI;
      await store.set(META_KEY, JSON.stringify(derivatives));

      return new Response(JSON.stringify({ tokenURI, imageHash, metadataHash }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pin failed';
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders });
};
