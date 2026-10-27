// The hide & seek relay (packages/nouns-party/src/hideseekRelay.ts): who
// gets what, sender ids rewritten, games forgotten when the host goes.

import { beforeEach, describe, expect, it } from 'vitest';

import { HideSeekRelay, type RelayConn } from '../../../../../../nouns-party/src/hideseekRelay';

let inbox: Map<string, Record<string, unknown>[]>;
let conns: RelayConn[];
let relay: HideSeekRelay;

function connect(...ids: string[]) {
  for (const id of ids) {
    inbox.set(id, []);
    conns.push({ id, send: (s: string) => inbox.get(id)!.push(JSON.parse(s)) });
  }
}
const conn = (id: string) => conns.find(c => c.id === id)!;
const got = (id: string) => inbox.get(id)!;
const types = (id: string) => got(id).map(m => m.type);
const clear = () => {
  for (const k of inbox.keys()) inbox.set(k, []);
};
const send = (from: string, m: Record<string, unknown>) => relay.handle(m, conn(from), conns);

const P = (id: string, cpu = false) => ({ id, name: id, cpu });

beforeEach(() => {
  inbox = new Map();
  conns = [];
  relay = new HideSeekRelay();
  connect('h', 'a', 'b', 'x');
});

/** h hosts g; a and b join; h lists them. */
function lobby() {
  send('h', { type: 'hideseek:roster', gid: 'g', players: [P('h')], cpu: 0 });
  send('a', { type: 'hideseek:join', gid: 'g' });
  send('b', { type: 'hideseek:join', gid: 'g' });
  send('h', { type: 'hideseek:roster', gid: 'g', players: [P('h'), P('a'), P('b')], cpu: 1 });
}

const config = { gid: 'g', players: [P('h'), P('a'), P('b'), P('cpu:0', true), P('x')] };

describe('hide & seek relay', () => {
  it('lobby presence goes to everyone else, sender rewritten', () => {
    send('a', { type: 'hideseek:lobby', from: 'spoof', open: null });
    expect(got('h')[0]).toMatchObject({ from: 'a' });
    expect(got('x')).toHaveLength(1);
    expect(got('a')).toHaveLength(0);
  });

  it('joins go to the host only, with the real sender', () => {
    send('h', { type: 'hideseek:roster', gid: 'g', players: [P('h')], cpu: 0 });
    send('a', { type: 'hideseek:join', gid: 'g', from: 'b' });
    expect(got('h').at(-1)).toMatchObject({ type: 'hideseek:join', from: 'a' });
    expect(types('b')).toEqual([]);
  });

  it('rosters go to everyone who asked, even if left out', () => {
    send('h', { type: 'hideseek:roster', gid: 'g', players: [P('h')], cpu: 0 });
    send('a', { type: 'hideseek:join', gid: 'g' });
    send('b', { type: 'hideseek:join', gid: 'g' });
    clear();
    send('h', { type: 'hideseek:roster', gid: 'g', players: [P('h'), P('a')], cpu: 0 });
    expect(types('a')).toEqual(['hideseek:roster']);
    expect(types('b')).toEqual(['hideseek:roster']);
    expect(types('x')).toEqual([]);
  });

  it("someone else can't take over a game's roster or start", () => {
    lobby();
    clear();
    send('x', { type: 'hideseek:roster', gid: 'g', players: [P('x')], cpu: 0 });
    send('x', { type: 'hideseek:start', gid: 'g', config });
    expect(types('a')).toEqual([]);
  });

  it('start goes to the host + the humans who asked, never to the unasked', () => {
    lobby();
    clear();
    send('h', { type: 'hideseek:start', gid: 'g', config });
    expect(types('a')).toEqual(['hideseek:start']);
    expect(types('b')).toEqual(['hideseek:start']);
    expect(types('x')).toEqual([]);
    expect(got('a')[0]).toMatchObject({ host: 'h' });
  });

  it('snapshots from the host go to members; acts from members go to the host', () => {
    lobby();
    send('h', { type: 'hideseek:start', gid: 'g', config });
    clear();
    send('h', { type: 'hideseek:s', gid: 'g', s: {} });
    expect(types('a')).toEqual(['hideseek:s']);
    expect(types('x')).toEqual([]);
    send('a', { type: 'hideseek:s', gid: 'g', s: {} });
    expect(types('b')).toEqual(['hideseek:s']);
    send('a', { type: 'hideseek:act', gid: 'g', a: 'tag', target: 'b', from: 'b' });
    expect(got('h').at(-1)).toMatchObject({ type: 'hideseek:act', from: 'a', target: 'b' });
    send('x', { type: 'hideseek:act', gid: 'g', a: 'tag', target: 'b' });
    expect(got('h').filter(m => m.type === 'hideseek:act')).toHaveLength(1);
  });

  it('a member leaving tells the others; the host leaving ends the game', () => {
    lobby();
    send('h', { type: 'hideseek:start', gid: 'g', config });
    clear();
    relay.close('b', conns);
    expect(got('h').at(-1)).toMatchObject({ type: 'hideseek:leave', gid: 'g', id: 'b' });
    expect(got('a').at(-1)).toMatchObject({ id: 'b' });
    relay.close('h', conns);
    expect(got('a').at(-1)).toMatchObject({ type: 'hideseek:leave', id: 'h' });
    expect(relay.games.size).toBe(0);
  });

  it('end forgets the game', () => {
    lobby();
    send('h', { type: 'hideseek:end', gid: 'g' });
    expect(got('a').at(-1)).toMatchObject({ type: 'hideseek:end' });
    expect(relay.games.size).toBe(0);
  });
});
