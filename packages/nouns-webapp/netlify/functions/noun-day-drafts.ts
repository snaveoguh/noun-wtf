import { connectLambda, getStore } from '@netlify/blobs';

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

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  rawUrl?: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

const STORE_NAME = 'noun-day-drafts';
const META_KEY = 'all-drafts';
const FALLBACK_URL = 'https://noun.wtf/.netlify/functions/noun-day-drafts';

const headers = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function json(body: unknown, statusCode = 200): HandlerResponse {
  return {
    body: JSON.stringify(body),
    headers,
    statusCode,
  };
}

function parseBody<T>(event: HandlerEvent): T {
  return JSON.parse(event.body ?? '{}') as T;
}

function getRequestUrl(event: HandlerEvent): URL {
  return new URL(event.rawUrl ?? FALLBACK_URL);
}

async function readDrafts(store: ReturnType<typeof getStore>) {
  const raw = await store.get(META_KEY);
  if (!raw) return {} as Record<string, NounDayDrafts>;
  return JSON.parse(raw) as Record<string, NounDayDrafts>;
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  if (event.httpMethod === 'OPTIONS') {
    return {
      body: '',
      headers,
      statusCode: 204,
    };
  }

  connectLambda({
    blobs: event.blobs ?? '',
    headers: event.headers ?? {},
  });

  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    try {
      const url = getRequestUrl(event);
      const nounId = Number(url.searchParams.get('nounId'));
      if (!Number.isFinite(nounId)) {
        return json({ error: 'nounId required' }, 400);
      }

      const drafts = await readDrafts(store);
      return json(drafts[String(nounId)] ?? null);
    } catch {
      return json(null);
    }
  }

  if (event.httpMethod === 'PUT') {
    try {
      const body = parseBody<{
        image?: string;
        mode?: DraftMode;
        nounId?: number;
        pixels?: string[][];
        voxelData?: string;
      }>(event);

      if (!Number.isFinite(body.nounId)) {
        return json({ error: 'nounId required' }, 400);
      }
      if (body.mode !== '2d' && body.mode !== '3d') {
        return json({ error: 'mode must be 2d or 3d' }, 400);
      }
      if (!body.image || !body.image.startsWith('data:image/')) {
        return json({ error: 'image data URL required' }, 400);
      }
      if (!Array.isArray(body.pixels) || body.pixels.length !== 32) {
        return json({ error: '32x32 pixels grid required' }, 400);
      }
      // 3D drafts may omit voxelData when the editor is in mesh mode
      // (vertex-color edits don't have a voxel grid representation — the
      // image snapshot is the canonical render the community sees). Accept
      // an empty string in that case so the snapshot still persists.
      if (body.mode === '3d' && body.voxelData != null && typeof body.voxelData !== 'string') {
        return json({ error: 'voxelData must be a string when provided' }, 400);
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
          updatedAt,
          // voxelData is optional for mesh-mode edits — store empty string
          // so the field is still present (the type's contract).
          voxelData: body.voxelData ?? '',
        };
      }

      drafts[key] = existing;
      await store.set(META_KEY, JSON.stringify(drafts));

      return json(existing);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save draft';
      return json({ error: message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
