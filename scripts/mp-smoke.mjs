import WebSocket from 'ws';
const url = 'ws://127.0.0.1:8787/ws';
const a = new WebSocket(url);
const b = new WebSocket(url);
let room = null, snaps = { a: 0, b: 0 }, events = 0, states = 0, metas = 0, started = 0;
const sendJ = (ws, m) => ws.send(JSON.stringify(m));
a.on('message', (d, bin) => {
  if (bin) { snaps.a++; return; }
  const m = JSON.parse(d);
  if (m.t === 'welcome') sendJ(a, { t: 'hello', name: 'alice', v: 1 });
  if (m.t === 'room' && m.room && !room) { room = m.room.id; console.log('room', room, m.room.seats.map(s => s.faction + ':' + (s.client ? 'X' : '-')).join(' ')); sendJ(b, { t: 'join', room }); }
  if (m.t === 'room' && m.room && m.room.seats[1].client && !m.room.seats[1].ready === false) {}
  if (m.t === 'start') { started++; console.log('start a you', m.you, m.map, m.seats.map(s => s.name + '/' + s.faction + '/' + s.human).join(', ')); }
  if (m.t === 'events') events += m.events.length;
  if (m.t === 'state') states++;
  if (m.t === 'meta') metas++;
  if (m.t === 'error') console.log('error a', m.text);
});
b.on('message', (d, bin) => {
  if (bin) { snaps.b++; return; }
  const m = JSON.parse(d);
  if (m.t === 'welcome') sendJ(b, { t: 'hello', name: 'bob', v: 1 });
  if (m.t === 'room' && m.room && m.room.seats[1].client && !m.room.seats[1].ready && m.room.state === 'lobby') { sendJ(b, { t: 'seat', index: 1, faction: 'ming' }); sendJ(b, { t: 'ready', ready: true }); }
  if (m.t === 'room' && m.room && m.room.seats[1].ready && m.room.state === 'lobby') sendJ(a, { t: 'start' });
  if (m.t === 'start') { started++; console.log('start b you', m.you); setTimeout(() => sendJ(b, { t: 'cmd', cmd: { type: 'order', ids: [20, 21, 22], order: { type: 'move', x: 0, z: 0 } } }), 500); }
  if (m.t === 'error') console.log('error b', m.text);
});
a.on('open', () => setTimeout(() => sendJ(a, { t: 'create', name: 'test', map: 'hallyeo', size: 2 }), 300));
setTimeout(() => { console.log('snaps', snaps, 'events', events, 'states', states, 'metas', metas, 'started', started); process.exit(0); }, 8000);
