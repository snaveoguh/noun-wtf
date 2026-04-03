import { getStore } from '@netlify/blobs';

type DraftMode = '2d' | '3d';

interface PixelDraft {
  image: string;
  pixels: string[][];
  updatedAt: string;
}

interface VoxelDraft extends PixelDraft {
  voxelData: string;
}

interface NounDayDrafts {
  nounId: number;
  pixel?: PixelDraft;
  voxel?: VoxelDraft;
}

const STORE_NAME = 'noun-day-drafts';
const META_KEY = 'all-drafts';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readDrafts(store: ReturnType<typeof getStore>) {
  const raw = await store.get(META_KEY);
  if (!raw) return {} as Record<string, NounDayDrafts>;
  return JSON.parse(raw) as Record<string, NounDayDrafts>;
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const store = getStore(STORE_NAME);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const nounId = Number(url.searchParams.get('nounId'));
    if (!Number.isFinite(nounId)) {
      return new Response(JSON.stringify({ error: 'nounId required' }), { status: 400, headers });
    }

    const drafts = await readDrafts(store);
    return new Response(JSON.stringify(drafts[String(nounId)] ?? null), { headers });
  }

  if (req.method === 'PUT') {
    const body = (await req.json()) as {
      nounId?: number;
      mode?: DraftMode;
      image?: string;
      pixels?: string[][];
      voxelData?: string;
    };

    if (!Number.isFinite(body.nounId)) {
      return new Response(JSON.stringify({ error: 'nounId required' }), { status: 400, headers });
    }
    if (body.mode !== '2d' && body.mode !== '3d') {
      return new Response(JSON.stringify({ error: 'mode must be 2d or 3d' }), {
        status: 400,
        headers,
      });
    }
    if (!body.image || !body.image.startsWith('data:image/')) {
      return new Response(JSON.stringify({ error: 'image data URL required' }), {
        status: 400,
        headers,
      });
    }
    if (!Array.isArray(body.pixels) || body.pixels.length !== 32) {
      return new Response(JSON.stringify({ error: '32x32 pixels grid required' }), {
        status: 400,
        headers,
      });
    }
    if (body.mode === '3d' && (!body.voxelData || typeof body.voxelData !== 'string')) {
      return new Response(JSON.stringify({ error: 'voxelData required for 3d drafts' }), {
        status: 400,
        headers,
      });
    }

    const drafts = await readDrafts(store);
    const nounId = Number(body.nounId);
    const key = String(nounId);
    const existing = drafts[key] ?? { nounId };
    const updatedAt = new Date().toISOString();

    if (body.mode === '2d') {
      existing.pixel = {
        image: body.image,
        pixels: body.pixels,
        updatedAt,
      };
    } else {
      existing.voxel = {
        image: body.image,
        pixels: body.pixels,
        voxelData: body.voxelData!,
        updatedAt,
      };
    }

    drafts[key] = existing;
    await store.set(META_KEY, JSON.stringify(drafts));

    return new Response(JSON.stringify(existing), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}
