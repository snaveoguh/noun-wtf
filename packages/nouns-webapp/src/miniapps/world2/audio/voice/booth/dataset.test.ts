import { describe, expect, it } from 'vitest';

import { parseCallout, parseChatVoice } from '../../../net/Net';

import { calloutId, datasetRows, metadataCsv, readme } from './dataset';
import { type StoredClip } from './voiceDb';

const clip = (key: string): StoredClip => ({
  key,
  blob: new Blob([new Uint8Array(4)]),
  mime: 'audio/webm',
  t0: 0,
  t1: 1,
  gain: 1,
  dur: 1,
  at: 1,
  uploadedAt: 0,
});

describe('voice dataset', () => {
  it('rows: training sentences in order, then callouts, with their text', () => {
    const train = new Map([
      ['train_002', clip('train_002')],
      ['train_001', clip('train_001')],
      ['train_999', clip('train_999')], // not a prompt: dropped
    ]);
    const clips = new Map([
      ['bail.0.c', clip('bail.0.c')],
      ['nope', clip('nope')],
    ]);
    const rows = datasetRows(train, clips);
    expect(rows.map(r => r.id)).toEqual(['train_001', 'train_002', 'callout_bail_0_c']);
    expect(rows[2]!.text).toBe('Ahh, shoot!');
    expect(calloutId('speed.3')).toBe('callout_speed_3');
  });

  it('metadata.csv is LJSpeech id|text', () => {
    expect(
      metadataCsv([
        { id: 'a', text: 'Hi | there\n' },
        { id: 'b', text: 'Yo.' },
      ]),
    ).toBe('a|Hi there\nb|Yo.\n');
  });

  it('README points only at the official Piper project and is honest about time', () => {
    const r = readme(3, 90);
    expect(r).toContain('github.com/rhasspy/piper');
    expect(r).toContain('1-3 hours');
    expect(r).toContain('1.5 minutes');
    const links = r.match(/https?:\/\/\S+/g) ?? [];
    for (const l of links)
      expect(l).toMatch(
        /github\.com\/(rhasspy|OHF-Voice)\/|huggingface\.co\/datasets\/rhasspy\/|colab\.research\.google\.com/,
      );
  });
});

describe('callout relay (pose blob)', () => {
  it('parses co and cv, rejects junk', () => {
    expect(parseCallout([3, 0, 2, 1])).toEqual({ seq: 3, ev: 'bail', index: 2, clean: true });
    expect(parseCallout([3, 2, 5, 0])).toEqual({ seq: 3, ev: 'record', index: 5, clean: false });
    for (const bad of [null, 'x', [1, 9, 0, 0], [1, 0, -1, 0], [1.5, 0, 0, 0], [1, 0]])
      expect(parseCallout(bad)).toBeNull();
    const tag = 'a'.repeat(24);
    const id = 'b'.repeat(16);
    expect(parseChatVoice([tag, id, 4])).toEqual({ tag, id, seq: 4 });
    expect(parseChatVoice(['nope', id, 4])).toBeNull();
    expect(parseChatVoice([tag, '../x', 4])).toBeNull();
  });
});
