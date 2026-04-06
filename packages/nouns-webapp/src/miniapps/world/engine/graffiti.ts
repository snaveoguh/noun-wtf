// ── Graffiti System — Spray paint on billboards, saved permanently ────
//
// Players pick up paint cans, approach a billboard, press G to open
// a pixel canvas, draw their tag, and save it. Tags are broadcast
// to all players via PartyKit and stored permanently.

export interface GraffitiTag {
  id: string;
  billboardId: string;
  pixels: string; // base64 encoded 32x32 RGBA image data
  author: string; // wallet address or player ID
  timestamp: number;
  color: string; // primary spray color
}

export interface PaintCanState {
  hasPaint: boolean;
  color: string;
  sprayCount: number; // remaining sprays
}

// ── Paint can colors ─────────────────────────────────────────────────

export const PAINT_COLORS = [
  '#ff0000', '#00ff00', '#0000ff', '#ffff00',
  '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
  '#ff0088', '#00ff88', '#ffffff', '#000000',
];

// ── Paint can pickups ────────────────────────────────────────────────

export interface PaintCan {
  id: number;
  worldX: number;
  worldY: number;
  color: string;
  picked: boolean;
}

let _nextPaintId = 0;
const _paintCans: PaintCan[] = [];

export function spawnPaintCan(worldX: number, worldY: number, color?: string): PaintCan {
  const can: PaintCan = {
    id: _nextPaintId++,
    worldX,
    worldY,
    color: color || PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)],
    picked: false,
  };
  _paintCans.push(can);
  return can;
}

export function getActivePaintCans(): PaintCan[] {
  return _paintCans.filter(c => !c.picked);
}

export function checkPaintPickup(
  playerX: number,
  playerY: number,
  paintState: PaintCanState,
): PaintCan | null {
  for (const can of _paintCans) {
    if (can.picked) continue;
    const dx = playerX - can.worldX;
    const dy = playerY - can.worldY;
    if (Math.sqrt(dx * dx + dy * dy) < 24) {
      can.picked = true;
      paintState.hasPaint = true;
      paintState.color = can.color;
      paintState.sprayCount = 100;
      return can;
    }
  }
  return null;
}

export function createPaintState(): PaintCanState {
  return { hasPaint: false, color: '#ff0000', sprayCount: 0 };
}

// ── Graffiti canvas — 32x32 pixel drawing ────────────────────────────

export function createGraffitiCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  // Start with transparent
  ctx.clearRect(0, 0, 32, 32);
  return canvas;
}

export function drawOnGraffiti(
  canvas: HTMLCanvasElement,
  x: number, // 0-31
  y: number, // 0-31
  color: string,
  brushSize = 1,
) {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  for (let dx = -brushSize + 1; dx < brushSize; dx++) {
    for (let dy = -brushSize + 1; dy < brushSize; dy++) {
      const px = Math.floor(x) + dx;
      const py = Math.floor(y) + dy;
      if (px >= 0 && px < 32 && py >= 0 && py < 32) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

export function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

export function base64ToTexture(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = base64;
  });
}

// ── Tag storage (in-memory + PartyKit broadcast) ─────────────────────

const _tags: Map<string, GraffitiTag> = new Map();

export function saveTag(tag: GraffitiTag) {
  _tags.set(tag.id, tag);
}

export function getTagsForBillboard(billboardId: string): GraffitiTag[] {
  return Array.from(_tags.values()).filter(t => t.billboardId === billboardId);
}

export function getLatestTag(billboardId: string): GraffitiTag | null {
  const tags = getTagsForBillboard(billboardId);
  if (tags.length === 0) return null;
  return tags.sort((a, b) => b.timestamp - a.timestamp)[0];
}

export function getAllTags(): GraffitiTag[] {
  return Array.from(_tags.values());
}

// ── Billboard positions (center of island) ───────────────────────────

export const CENTER_BILLBOARDS = [
  { id: 'center-1', worldX: 512, worldY: 500, text: 'DEPOSIT TO\nNOUNIRL.ETH\nYOUR AD HERE', rotation: 0 },
  { id: 'center-2', worldX: 520, worldY: 512, text: 'TAG THIS\n⌐◧-◧', rotation: Math.PI / 3 },
  { id: 'center-3', worldX: 504, worldY: 520, text: 'NOUNS WORLD\nWAS HERE', rotation: -Math.PI / 4 },
];
