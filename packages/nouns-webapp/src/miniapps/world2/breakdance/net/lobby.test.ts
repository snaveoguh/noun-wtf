// The cypher lobby's state machine: presence, VS CPU, 1V1 challenges (yes,
// no, silence), crews with CPU fill, invites and their timeouts, WATCH.

import type { BreakMsg } from '../contract';

import { beforeEach, describe, expect, it } from 'vitest';

import { BreakLobby, EXPECT_MS, INVITE_MS, PRESENCE_MS, SKILL, type LobbyDeps } from './lobby';

let now = 0;

function lobby(id: string, name: string, busy = false) {
  const sent: BreakMsg[] = [];
  const deps: LobbyDeps = {
    myId: () => id,
    myName: () => name,
    mySeed: () => ({ me: id }),
    seedOf: (pid, key) => ({ them: pid, key }),
    cpuSeed: () => ({ cpu: true }),
    send: m => sent.push(m),
    now: () => now,
    busy: () => busy,
  };
  return { l: new BreakLobby(deps), sent };
}

/** As the relay delivers it: `from` rewritten to the sender. */
const from = <M extends BreakMsg>(m: M, id: string): M => ({ ...m, from: id });

beforeEach(() => {
  now = 1000;
});

describe('BreakLobby', () => {
  it('tracks who is at the cypher and live battles, and forgets them', () => {
    const { l } = lobby('me', 'Me');
    l.onMessage({ type: 'break:lobby', from: 'b', at: true, name: 'Bea', seedKey: '1-2-3-4-5' });
    l.onMessage({
      type: 'break:lobby',
      from: 'c',
      at: true,
      name: 'Cy',
      live: { gid: 'g9', crewSize: 2, names: ['Cy', 'x'] },
    });
    l.onMessage({ type: 'break:lobby', from: 'me', at: true, name: 'Me' }); // my own echo
    expect([...l.here.keys()]).toEqual(['b', 'c']);
    expect(l.live.get('g9')?.hostName).toBe('Cy');
    l.onMessage({ type: 'break:lobby', from: 'b', at: false });
    expect(l.here.has('b')).toBe(false);
    // c's battle ended: its next announce has no `live`
    l.onMessage({ type: 'break:lobby', from: 'c', at: true, name: 'Cy' });
    expect(l.live.size).toBe(0);
    now += PRESENCE_MS + 1;
    l.tick();
    expect(l.here.size).toBe(0);
  });

  it('VS CPU: a full battle straight away, CPU skill by difficulty', () => {
    const { l, sent } = lobby('me', 'Me');
    const cfg = l.vsCpu(1, 'hard');
    expect(sent).toEqual([]);
    expect(cfg.crewSize).toBe(1);
    expect(cfg.dancers.map(d => [d.id, d.crew, d.human])).toEqual([
      ['me', 0, true],
      ['cpu:0', 1, false],
    ]);
    expect(cfg.dancers[0].seed).toEqual({ me: 'me' });
    expect(Math.abs(cfg.dancers[1].skill! - SKILL.hard)).toBeLessThanOrEqual(0.08);
    const crew = l.vsCpu(3, 'easy');
    expect(crew.dancers.filter(d => d.crew === 0)).toHaveLength(3);
    expect(crew.dancers.filter(d => !d.human)).toHaveLength(5);
    expect(new Set(crew.dancers.map(d => d.id)).size).toBe(6);
  });

  it('1V1: challenge → accept → go; the rival expects the start', () => {
    const a = lobby('a', 'Alpha');
    const b = lobby('b', 'Bea');
    expect(a.l.challenge(1, [{ id: 'b', name: 'Bea', crew: 1 }], 'normal')).toEqual({
      kind: 'update',
    });
    const ch = a.sent[0];
    expect(ch).toMatchObject({
      type: 'break:challenge',
      to: 'b',
      crewSize: 1,
      name: 'Alpha',
      crew: 1,
    });
    expect(b.l.onMessage(from(ch, 'a'))).toEqual({ kind: 'invite' });
    expect(b.l.incoming).toMatchObject({ from: 'a', name: 'Alpha', crewSize: 1, crew: 1 });
    b.l.accept();
    expect(b.l.expect).toMatchObject({ host: 'a' });
    const r = a.l.onMessage(from(b.sent[0], 'b'));
    expect(r?.kind).toBe('go');
    if (r?.kind !== 'go') return;
    expect(r.config.gid).toBe((ch as { gid: string }).gid);
    expect(r.config.dancers.map(d => [d.id, d.crew, d.human])).toEqual([
      ['a', 0, true],
      ['b', 1, true],
    ]);
    expect(a.l.outgoing).toBeNull();
    // b takes that host's start as a member, and nobody else's
    const start = { type: 'break:start' as const, host: 'a', config: r.config, at: -3 };
    expect(b.l.wants(start)).toBe('member');
    expect(b.l.wants({ ...start, host: 'z' })).toBeNull();
  });

  it('1V1: a "no" or silence fails it; then the CPU instead', () => {
    const a = lobby('a', 'Alpha');
    a.l.challenge(1, [{ id: 'b', name: 'Bea', crew: 1 }], 'easy');
    a.l.onMessage({ type: 'break:reply', from: 'b', to: 'a', ok: false, gid: a.l.outgoing!.gid });
    expect(a.l.outgoing!.failed).toBe('declined');
    const r = a.l.cpuInstead();
    expect(r?.kind).toBe('go');
    if (r?.kind === 'go') expect(r.config.dancers[1].human).toBe(false);

    const c = lobby('a', 'Alpha');
    c.l.challenge(1, [{ id: 'b', name: 'Bea', crew: 1 }], 'easy');
    now += INVITE_MS + 1;
    c.l.tick();
    expect(c.l.outgoing!.failed).toBe('timeout');
    // A late yes changes nothing
    expect(c.l.onMessage({ type: 'break:reply', from: 'b', to: 'a', ok: true })).toBeNull();
  });

  it('crews: replies fill spots, a "no" becomes a CPU, START NOW / timeout fill the rest', () => {
    const a = lobby('a', 'Alpha');
    a.l.challenge(
      3,
      [
        { id: 'b', name: 'Bea', crew: 0 },
        { id: 'c', name: 'Cy', crew: 1 },
        { id: 'd', name: 'Dee', crew: 1 },
        { id: 'e', name: 'Eve', crew: 0 },
        { id: 'f', name: 'Fox', crew: 0 }, // my crew is full (me + b + e): dropped
      ],
      'normal',
    );
    expect(a.sent.map(m => (m as { to: string }).to)).toEqual(['b', 'c', 'd', 'e']);
    const gid = a.l.outgoing!.gid;
    a.l.onMessage({ type: 'break:reply', from: 'b', to: 'a', ok: true, gid });
    a.l.onMessage({ type: 'break:reply', from: 'c', to: 'a', ok: false, gid });
    a.l.onMessage({ type: 'break:reply', from: 'x', to: 'a', ok: true, gid }); // never asked
    expect(a.l.outgoing!.slots.map(s => [s.id, s.status])).toEqual([
      ['a', 'me'],
      ['b', 'ok'],
      ['c', 'cpu'],
      ['d', 'waiting'],
      ['e', 'waiting'],
    ]);
    a.l.onMessage({ type: 'break:reply', from: 'd', to: 'a', ok: true, gid });
    const r = a.l.startNow(); // e never answered
    expect(r?.kind).toBe('go');
    if (r?.kind !== 'go') return;
    const d = r.config.dancers;
    expect(d.filter(x => x.crew === 0).map(x => x.human)).toEqual([true, true, false]);
    expect(d.filter(x => x.crew === 1).map(x => [x.id, x.human])).toEqual([
      ['d', true],
      ['cpu:1', false],
      ['cpu:2', false],
    ]);
    expect(d.find(x => x.id === 'b')!.seed).toEqual({ them: 'b', key: undefined });
  });

  it('invites: busy players decline at once; unanswered ones decline themselves', () => {
    const busy = lobby('b', 'Bea', true);
    busy.l.onMessage({ type: 'break:challenge', from: 'a', to: 'b', crewSize: 1, gid: 'g1' });
    expect(busy.sent).toEqual([{ type: 'break:reply', to: 'a', ok: false, gid: 'g1' }]);
    expect(busy.l.incoming).toBeNull();

    const b = lobby('b', 'Bea');
    b.l.onMessage({ type: 'break:challenge', from: 'a', to: 'b', crewSize: 2, gid: 'g1', crew: 0 });
    // A second challenge while one is open: declined
    b.l.onMessage({ type: 'break:challenge', from: 'z', to: 'b', crewSize: 1, gid: 'g2' });
    expect(b.sent).toEqual([{ type: 'break:reply', to: 'z', ok: false, gid: 'g2' }]);
    now += INVITE_MS + 1;
    b.l.tick();
    expect(b.l.incoming).toBeNull();
    expect(b.sent[1]).toEqual({ type: 'break:reply', to: 'a', ok: false, gid: 'g1' });
  });

  it('accepted but the host never starts: it falls through', () => {
    const b = lobby('b', 'Bea');
    b.l.onMessage({ type: 'break:challenge', from: 'a', to: 'b', crewSize: 1, gid: 'g1' });
    b.l.accept();
    now += EXPECT_MS + 1;
    expect(b.l.tick()).toEqual([{ kind: 'fellThrough' }]);
    expect(b.l.expect).toBeNull();
  });

  it('WATCH: asks the host, and takes only the start sent to me', () => {
    const s = lobby('s', 'Spec');
    s.l.onMessage({
      type: 'break:lobby',
      from: 'h',
      at: true,
      name: 'Host',
      live: { gid: 'g5', crewSize: 1, names: ['Host', 'cpu'] },
    });
    expect(s.l.watch('nope')).toBe(false);
    expect(s.l.watch('g5')).toBe(true);
    expect(s.sent.at(-1)).toEqual({ type: 'break:watch', gid: 'g5' });
    const cfg = lobby('h', 'Host').l.vsCpu(1, 'normal');
    const start = { type: 'break:start' as const, host: 'h', config: { ...cfg, gid: 'g5' }, at: 4 };
    expect(s.l.wants(start)).toBeNull(); // the members' broadcast
    expect(s.l.wants({ ...start, to: 's' })).toBe('spectator');
  });
});
