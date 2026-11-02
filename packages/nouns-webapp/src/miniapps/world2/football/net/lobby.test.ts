import { describe, expect, it } from 'vitest';

import { FootballRelay } from '../../../../../../nouns-party/src/footballRelay';

import { FootballLobby, INVITE_MS, LOBBY_TTL_MS, type LobbyEvent } from './lobby';
import { StubSim, stubConfig } from './stubSim';
import { FootballHost } from './sync';
import { LoopbackHub } from './transport';

function world(ids: string[], busy: Record<string, boolean> = {}) {
  const hub = new LoopbackHub({ relay: new FootballRelay(), latencyMs: 20 });
  const ev = new Map<string, LobbyEvent[]>();
  const lobby = new Map<string, FootballLobby>();
  for (const id of ids) {
    ev.set(id, []);
    lobby.set(
      id,
      new FootballLobby({
        transport: hub.endpoint(id),
        now: () => hub.now,
        myName: () => id.toUpperCase(),
        busy: () => busy[id] === true,
        onEvent: e => ev.get(id)!.push(e),
      }),
    );
  }
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      hub.advance(100);
      for (const l of lobby.values()) l.tick();
    }
  };
  const kinds = (id: string) => ev.get(id)!.map(e => e.kind);
  return { hub, lobby: (id: string) => lobby.get(id)!, ev, kinds, step };
}

describe('football lobby', () => {
  it('hosts a lobby others discover; it expires without announcements', () => {
    const w = world(['h', 'a']);
    const gid = w.lobby('h').host(7);
    w.step(100);
    const seen = w.lobby('a').lobbies.get(gid)!;
    expect(seen).toMatchObject({ host: 'h', hostName: 'H', size: 7, live: false });
    expect(seen.players).toEqual([{ id: 'h', name: 'H', team: 0 }]);
    // Re-announced every 2 s: still there after 10 s
    w.step(10000);
    expect(w.lobby('a').lobbies.has(gid)).toBe(true);
    // The host vanishes (no close): gone ~6 s later
    w.hub.disconnect('h');
    w.step(LOBBY_TTL_MS + 500);
    expect(w.lobby('a').lobbies.has(gid)).toBe(false);
  });

  it('closing forgets it at once', () => {
    const w = world(['h', 'a']);
    const gid = w.lobby('h').host(5);
    w.step(100);
    w.lobby('h').close();
    w.step(100);
    expect(w.lobby('a').lobbies.has(gid)).toBe(false);
  });

  it('join a team, switch, leave; teams are capped at size', () => {
    const w = world(['h', 'a', 'b', 'c', 'd', 'e', 'f']);
    const gid = w.lobby('h').host(5);
    w.step(100);
    expect(w.lobby('a').joinTeam(gid, 1)).toBe(true);
    w.step(200);
    expect(w.kinds('h')).toContain('joined');
    expect(w.lobby('h').mine!.players).toContainEqual({ id: 'a', name: 'A', team: 1 });
    expect(w.lobby('a').inTeam).toBe(true);
    // Switch teams
    w.lobby('a').joinTeam(gid, 0);
    w.step(200);
    expect(w.lobby('h').mine!.players.find(p => p.id === 'a')!.team).toBe(0);
    // Team 0 has h + a; fill it to 5, the 6th is refused
    for (const id of ['b', 'c', 'd', 'e']) w.lobby(id).joinTeam(gid, 0);
    w.step(300);
    expect(w.lobby('h').mine!.players.filter(p => p.team === 0).length).toBe(5);
    expect(w.lobby('e').inTeam).toBe(false);
    w.lobby('a').leaveTeam();
    w.step(200);
    expect(w.kinds('h')).toContain('left');
    expect(w.lobby('h').mine!.players.some(p => p.id === 'a')).toBe(false);
  });

  it('challenge → accept → the challenger hosts, the accepter gets its start as a member', () => {
    const w = world(['h', 'a']);
    w.step(100);
    const gid = w.lobby('h').challenge('a', 'A', 11);
    w.step(100);
    expect(w.kinds('a')).toEqual(['invite']);
    const inv = w.lobby('a').incoming!;
    expect(inv).toMatchObject({ gid, who: 'h', name: 'H', size: 11, coop: false });
    w.lobby('a').accept();
    w.step(100);
    const acc = w.ev.get('h')!.find(e => e.kind === 'accepted');
    expect(acc).toBeDefined();
    const config = stubConfig(11, [
      ['h', 0],
      ['a', 1],
    ]);
    new FootballHost({
      gid,
      config,
      sim: new StubSim(config),
      transport: w.hub.endpoint('h'),
      me: 'h',
      now: () => w.hub.now,
    });
    w.step(100);
    const st = w.ev.get('a')!.find(e => e.kind === 'start');
    expect(st).toMatchObject({ kind: 'start', role: 'member' });
    expect(w.lobby('a').expect).toBeNull();
  });

  it('decline, busy auto-decline, and invites expire after 20 s', () => {
    const w = world(['h', 'a', 'b'], { b: true });
    w.lobby('h').challenge('a', 'A', 5);
    w.step(100);
    w.lobby('a').decline();
    w.step(100);
    expect(w.kinds('h')).toContain('declined');
    w.lobby('h').challenge('b', 'B', 5);
    w.step(200);
    expect(w.kinds('b')).toEqual([]);
    expect(w.kinds('h').filter(k => k === 'declined').length).toBe(2);
    // Unanswered: both sides drop it
    w.lobby('h').challenge('a', 'A', 7, true);
    w.step(100);
    expect(w.lobby('a').incoming!.coop).toBe(true);
    w.step(INVITE_MS + 200);
    expect(w.lobby('a').incoming).toBeNull();
    expect(w.lobby('h').outgoing).toBeNull();
    expect(w.kinds('a')).toContain('expired');
    expect(w.kinds('h')).toContain('expired');
  });

  it('watch a live match: football:watch → the host answers with start {to: me}', () => {
    const w = world(['h', 'a', 'w']);
    const gid = w.lobby('h').host(5);
    const config = stubConfig(5, [
      ['h', 0],
      ['a', 1],
    ]);
    w.step(100);
    w.lobby('a').joinTeam(gid, 1);
    w.step(100);
    const host = new FootballHost({
      gid,
      config,
      sim: new StubSim(config),
      transport: w.hub.endpoint('h'),
      me: 'h',
      now: () => w.hub.now,
    });
    w.lobby('h').setLive(true, [0, 0]);
    w.step(100);
    expect(w.ev.get('a')!.some(e => e.kind === 'start' && e.role === 'member')).toBe(true);
    expect(w.lobby('w').lobbies.get(gid)!.live).toBe(true);
    // Not live → can't watch; live → can
    expect(w.lobby('w').watch('nope')).toBe(false);
    expect(w.lobby('w').watch(gid)).toBe(true);
    w.step(100);
    const st = w.ev.get('w')!.find(e => e.kind === 'start');
    expect(st).toMatchObject({ kind: 'start', role: 'watch' });
    expect(host.watchers.has('w')).toBe(true);
    // A start meant for someone else's watch isn't mine
    expect(w.ev.get('a')!.filter(e => e.kind === 'start').length).toBe(1);
  });
});
