// Player-conditioned ally support: actual openings, income, free hulls, storage and a human Ming/Japan battle.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = { root, configFile:false, logLevel:'error', appType:'custom', server:{middlewareMode:true,hmr:false,ws:false}, optimizeDeps:{noDiscovery:true,include:[]} };
const server = await createServer(config);
const servers = [server];
let checks = 0;
const check = (name, test) => { test(); checks++; console.log(`ok ${name}`); };
const clone = (g) => JSON.parse(JSON.stringify(g));
const savedStorage = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
try {
  const {newGrand,endTurn,autoResolveContact} = await server.ssrLoadModule('/src/sim/grand/turn.ts');
  const {START} = await server.ssrLoadModule('/src/sim/grand/regions.ts');
  const {factionIncome,listStrength,migrateGrandBalance} = await server.ssrLoadModule('/src/sim/grand/economy.ts');
  const {supportAlly,supportReinforcements} = await server.ssrLoadModule('/src/sim/grand/support.ts');
  const {applyEffect,EVENTS,chooseEvent} = await server.ssrLoadModule('/src/sim/grand/events.ts');
  const {orderMove,orderRecruit,cancelRecruit,orderDeclareWar,orderAlliance} = await server.ssrLoadModule('/src/sim/grand/orders.ts');
  const {describeContact} = await server.ssrLoadModule('/src/sim/grand/bridge.ts');
  const {buildGrandConquest} = await server.ssrLoadModule('/src/sim/grand/spawn.ts');
  const {SIM_DT} = await server.ssrLoadModule('/src/sim/battle.ts');
  const {shipSpec} = await server.ssrLoadModule('/src/sim/competitive.ts');
  const factions = ['joseon','japan','ming'];
  const opening = (g,f) => g.fleets.filter(fl=>fl.faction===f && START.fleets.some(s=>s.faction===f && s.name===fl.name));
  const composition = (ships) => Object.fromEntries([...new Set(ships.map(s=>s.kind))].sort().map(k=>[k,ships.filter(s=>s.kind===k).length]));
  const roster = (g,f) => composition(opening(g,f).flatMap(fl=>fl.ships));
  const base = {joseon:{hyeopseon:10,panokseon:14},japan:{atakebune:19,kobaya:21,sekibune:24},ming:{mingship:12,mingsmall:16}};
  const branches = new Map([['joseon',newGrand('joseon',4701592)],['ming',newGrand('ming',4701592)],['japan',newGrand('japan',4701592)],[null,newGrand(null,4701592)]]);
  check('four new-campaign branches weaken only the original allied computer',()=>{
    assert.equal(branches.get('joseon').allySupport.faction,'ming');
    assert.equal(branches.get('ming').allySupport.faction,'joseon');
    assert.equal(branches.get('joseon').allySupport.version,'player-ally-v1');
    for(const player of ['japan',null]) assert.equal(Object.hasOwn(branches.get(player),'allySupport'),false);
    for(const [player,g] of branches) for(const f of factions) assert.equal(supportAlly(g,f),(player==='joseon'&&f==='ming')||(player==='ming'&&f==='joseon'));
  });
  check('Joseon selection keeps24 own and64 Japanese ships, reduces Ming28 to17',()=>{
    const g=branches.get('joseon');assert.deepEqual(roster(g,'joseon'),base.joseon);assert.deepEqual(roster(g,'japan'),base.japan);assert.deepEqual(roster(g,'ming'),{mingship:7,mingsmall:10});
  });
  check('Ming selection keeps28 own and64 Japanese ships, reduces Joseon24 to14',()=>{
    const g=branches.get('ming');assert.deepEqual(roster(g,'ming'),base.ming);assert.deepEqual(roster(g,'japan'),base.japan);assert.deepEqual(roster(g,'joseon'),{hyeopseon:6,panokseon:8});
  });
  check('Japan selection and all-computer opening rosters stay full',()=>{
    for(const player of ['japan',null]) for(const f of factions) assert.deepEqual(roster(branches.get(player),f),base[f]);
  });
  check('new openings preserve ship stats, guards, starting data and main RNG',()=>{
    const startSnapshot=JSON.stringify(START), rng=branches.get(null).rng;
    for(const g of branches.values()) {
      assert.deepEqual(g.rng,rng);
      for(const fl of g.fleets) for(const s of fl.ships) assert.deepEqual([s.hull,s.crew,s.supply,s.kills],[1,1,1,0]);
      for(const id of Object.keys(g.regions)) assert.deepEqual(g.regions[id].garrison,branches.get(null).regions[id].garrison);
    }
    assert.equal(JSON.stringify(START),startSnapshot);
  });
  check('income reduces only the selected ally including capital/event income; all difficulty settings preserve own/enemy income',()=>{
    for(const player of ['joseon','ming','japan',null]) for(const difficulty of ['easy','normal','hard']) {
      const g=newGrand(player,4701592,difficulty), legacy=clone(g);delete legacy.allySupport;
      g.events.mods.push({faction:'ming',mult:1.17,left:3});legacy.events.mods.push({faction:'ming',mult:1.17,left:3});
      for(const f of factions) assert.equal(factionIncome(g,f),supportAlly(g,f)?Math.round(factionIncome(legacy,f)*.65):factionIncome(legacy,f));
    }
  });
  check('event reinforcements carry fractional heavy/scout hulls rather than round each arrival up',()=>{
    const g=newGrand('joseon',4701592);g.allySupport.reinforcementCarry={};
    const before=g.fleets.length,rng=clone(g.rng);
    const e={ships:{at:'liaodong',name:'support-test',kinds:{mingship:1,mingsmall:2}}};
    applyEffect(g,'ming',e);
    assert.deepEqual(composition(g.fleets.slice(before).flatMap(fl=>fl.ships)),{mingsmall:1});
    applyEffect(g,'ming',e);
    assert.deepEqual(composition(g.fleets.slice(before).flatMap(fl=>fl.ships)),{mingship:1,mingsmall:2});
    for(let n=2;n<5;n++) applyEffect(g,'ming',e);
    assert.deepEqual(composition(g.fleets.slice(before).flatMap(fl=>fl.ships)),{mingship:3,mingsmall:6});
    assert.deepEqual(g.rng,rng);
  });
  check('a sub-hull free grant creates no empty fleet and player/enemy free grants remain full',()=>{
    const g=newGrand('ming',4701592);g.allySupport.reinforcementCarry={};
    const before=g.fleets.length;
    applyEffect(g,'joseon',{ships:{at:'yeosu',name:'support-test',kinds:{panokseon:1}}});
    assert.equal(g.fleets.length,before);
    applyEffect(g,'ming',{ships:{at:'liaodong',name:'own-test',kinds:{mingship:1}}});
    applyEffect(g,'japan',{ships:{at:'nagoya',name:'foe-test',kinds:{atakebune:1}}});
    assert.equal(g.fleets.at(-2).ships.length,1);assert.equal(g.fleets.at(-1).ships.length,1);
  });
  check('actual turn8 scheduled reinforcements share the same smaller ally policy',()=>{
    const g=newGrand('joseon',4701592);g.turn=8;g.fleets=[];g.allySupport.reinforcementCarry={};
    for(const f of factions) g.factions[f].gold=0;
    for(const e of EVENTS) g.events.done[e.id]=-2;g.events.pending=null;
    endTurn(g);
    assert.equal(g.turn,9);
    const ships=f=>g.fleets.filter(fl=>fl.faction===f).flatMap(fl=>fl.ships);
    assert.deepEqual(composition(ships('ming')),{mingsmall:1});
    assert.deepEqual(composition(ships('joseon')),{hyeopseon:2,panokseon:1});
    assert.deepEqual(composition(ships('japan')),{atakebune:1,kobaya:2,sekibune:3});
    assert.ok(Math.abs(g.allySupport.reinforcementCarry.mingship-.6)<1e-8);
  });
  check('scheduled and event support carry survives reload and continues exactly',()=>{
    const g=newGrand('ming',4701592);g.allySupport.reinforcementCarry={};
    supportReinforcements(g,'joseon',{panokseon:1,hyeopseon:2});
    const restored=clone(g), frozen=JSON.stringify(g);
    assert.deepEqual(supportReinforcements(g,'joseon',{panokseon:1,hyeopseon:2}),{panokseon:1,hyeopseon:1});
    supportReinforcements(restored,'joseon',{panokseon:1,hyeopseon:2});
    assert.deepEqual(g,restored);assert.notEqual(JSON.stringify(g),frozen);
    for(let i=0;i<5;i++) {if(g.events.pending)chooseEvent(g,0);if(restored.events.pending)chooseEvent(restored,0);endTurn(g);endTurn(restored);while(g.pending.length)autoResolveContact(g,g.pending[0].id);while(restored.pending.length)autoResolveContact(restored,restored.pending[0].id);}
    assert.deepEqual(g,restored);
  });
  check('breaking the original alliance suspends reductions and returning preserves carry',()=>{
    const g=newGrand('joseon',4701592);supportReinforcements(g,'ming',{mingship:1});const carry=clone(g.allySupport.reinforcementCarry);
    assert.ok(orderDeclareWar(g,'joseon','ming').ok);assert.equal(supportAlly(g,'ming'),false);
    const ships={mingship:1};assert.equal(supportReinforcements(g,'ming',ships),ships);assert.deepEqual(g.allySupport.reinforcementCarry,carry);
    const old=clone(g);delete old.allySupport;assert.equal(factionIncome(g,'ming'),factionIncome(old,'ming'));
    assert.ok(orderAlliance(g,'joseon','ming').ok);assert.equal(supportAlly(g,'ming'),true);assert.deepEqual(g.allySupport.reinforcementCarry,carry);
  });
  check('unsupported save versions and mismatched human/faction markers have no effect',()=>{
    const g=newGrand('joseon',4701592),legacy=clone(g);delete legacy.allySupport;
    g.allySupport.version='future-support-v2';assert.equal(factionIncome(g,'ming'),factionIncome(legacy,'ming'));
    g.allySupport.version='player-ally-v1';g.allySupport.faction='joseon';assert.equal(factionIncome(g,'joseon'),factionIncome(legacy,'joseon'));
    g.player='japan';g.allySupport.faction='ming';assert.equal(supportAlly(g,'ming'),false);
  });
  check('the supporting ally retains heavy/scout ships and its ordinary allied sea routes',()=>{
    const g=clone(branches.get('joseon')),fl=opening(g,'ming')[0];
    assert.ok(fl.ships.some(s=>s.kind==='mingship'));assert.ok(fl.ships.some(s=>s.kind==='mingsmall'));
    assert.ok(orderMove(g,fl.id,'myeongnyang').ok);assert.deepEqual(fl.route,['myeongnyang']);
  });
  check('normal paid builds and exact paid refunds ignore support multipliers',()=>{
    const g=newGrand('ming',4701592),before=g.factions.joseon.gold;
    assert.ok(orderRecruit(g,'yeosu','panokseon','joseon').ok);
    const queue=g.regions.yeosu.queue[0],paid=queue.paidGold;
    assert.equal(queue.total,2);assert.equal(paid,284);assert.ok(cancelRecruit(g,'yeosu',queue.id,'joseon').ok);assert.equal(g.factions.joseon.gold,before);
  });
  check('actual human Ming-versus-Japan battle spawns full own ships with normal stats',()=>{
    const g=clone(branches.get('ming')),mf=opening(g,'ming')[0],jf=opening(g,'japan')[0];
    const c={id:'support-ming-japan',regionId:'busan',attacker:'ming',defender:'japan',attackerFleets:[mf.id],defenderFleets:[jf.id],player:true};
    const rb=describeContact(g,c);assert.equal(rb.humanSide,'attacker');assert.equal(rb.attacker.faction,'ming');assert.equal(rb.attacker.human,true);assert.equal(rb.defender.faction,'japan');
    assert.equal(rb.attacker.ships.length,28);
    const built=buildGrandConquest(rb,()=>-80),b=built.battle;
    const own=b.ships.filter(s=>s.owner===0);assert.equal(own.length,28);assert.equal(b.humans.has(0),true);assert.equal(built.conquest.players[0].faction,'ming');
    for(const s of own){assert.equal(s.spec.faction,'ming');assert.equal(s.spec.hull,shipSpec(s.spec.kind).hull);assert.equal(s.crew,s.spec.crew);}
    for(let i=0;i<120;i++)b.step(SIM_DT);
    assert.ok(b.time>1.9);assert.equal(rb.attacker.ships.length,28);
  });

  const memory=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});
  const legacy=clone(branches.get('ming'));delete legacy.allySupport;
  legacy.fleets[0].ships[0].hull=.37;legacy.fleets[0].ships[0].crew=.61;
  legacy.regions.yeosu.queue.push({id:'already-paid',kind:'panokseon',left:1,total:2,paidGold:77});
  const beforeLoad=JSON.stringify(legacy);memory.set('imjin.grand.v1',beforeLoad);
  const store=await server.ssrLoadModule('/src/campaign/grand.ts');
  check('actual campaign-store legacy load preserves living hulls/queues/gold/RNG and never adds a rule',()=>{
    assert.equal(JSON.stringify(store.useGrand.getState().grand),beforeLoad);assert.equal(Object.hasOwn(store.useGrand.getState().grand,'allySupport'),false);
    const g=store.useGrand.getState().grand,migrated=clone(g);migrateGrandBalance(migrated);assert.deepEqual(migrated,g);
  });
  check('actual new Ming campaign persists its chosen rule and full player-event reinforcement',()=>{
    const g=store.startGrand('ming','normal',4701592),before=g.fleets.filter(fl=>fl.faction==='ming').flatMap(fl=>fl.ships).length;
    assert.equal(g.allySupport.faction,'joseon');assert.equal(store.chooseGrandEvent(0).ok,true);
    const now=store.useGrand.getState().grand;assert.equal(now.fleets.filter(fl=>fl.faction==='ming').flatMap(fl=>fl.ships).length,before+1);
    assert.deepEqual(JSON.parse(memory.get('imjin.grand.v1')),now);
  });
  const freshServer=await createServer(config);servers.push(freshServer);
  const reloadedStore=await freshServer.ssrLoadModule('/src/campaign/grand.ts');
  check('a fresh campaign-store module reload retains rule/carry/state without double-scaling',()=>{
    const expected=JSON.parse(memory.get('imjin.grand.v1'));
    assert.deepEqual(reloadedStore.useGrand.getState().grand,expected);
    assert.deepEqual(reloadedStore.useGrand.getState().grand,store.useGrand.getState().grand);
  });
  console.log(JSON.stringify({openingShips:Object.fromEntries([...branches].map(([player,g])=>[player??'all-computer',Object.fromEntries(factions.map(f=>[f,{openingShips:opening(g,f).flatMap(fl=>fl.ships).length,totalIncludingChosenTurn1Events:g.fleets.filter(fl=>fl.faction===f).flatMap(fl=>fl.ships).length,income:factionIncome(g,f),openingStrength:listStrength(opening(g,f).flatMap(fl=>fl.ships))}]))])),checks},null,2));
} finally {
  if(savedStorage)Object.defineProperty(globalThis,'localStorage',savedStorage);else delete globalThis.localStorage;
  await Promise.all(servers.map(s=>s.close()));
}
console.log(`Grand support ${checks} checks passed`);
