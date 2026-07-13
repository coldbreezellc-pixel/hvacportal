/**
 * Pre-deploy test for ot/index.html — renders the real page in a real DOM.
 *   node test_ot.js [path] [--crew]
 */
const fs = require('fs');
const https = require('https');
const { JSDOM } = require('jsdom');

const HTML = process.argv[2] || '/home/claude/ot_index.html';
const AS_CREW = process.argv.includes('--crew');
const BASE = 'https://local68.up.railway.app';

const get = (p) => new Promise((res, rej) => {
  https.get(BASE + p, r => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>{ try{res(JSON.parse(b));}catch(e){rej(e);} }); }).on('error', rej);
});

const OT_STATUSES = ['worked','declined','noshow'];
const src = fs.readFileSync('/home/claude/server.js','utf8');
eval(src.match(/function computeOtTotals[\s\S]*?\n}/)[0]);

let pass=0, fail=0; const out=[];
const check=(n,c,d)=>{ c?(pass++,out.push(['✓',n,d||''])):(fail++,out.push(['✗',n,d||''])); };

(async () => {
  const baseline = JSON.parse(fs.readFileSync('/tmp/ot_baseline.json','utf8'));
  const timeOff  = await get('/api/time-off');          // real time off, so OFF cells are real
  const users    = await get('/api/data/pm_users');

  // A realistic set of OT entries for the current week (Mon 13 Jul 2026)
  const entries = [
    { id:'OT-1', employee:'Ray Sinnott',   date:'2026-07-14', hours:8,  status:'worked',   note:'' },
    { id:'OT-2', employee:"Christian Dell'Andrino", date:'2026-07-16', hours:8, status:'worked', note:'' },
    { id:'OT-3', employee:'Brian Scudder', date:'2026-07-17', hours:8,  status:'worked',   note:'' },
    { id:'OT-4', employee:'Sean Fanning',  date:'2026-07-18', hours:8,  status:'declined', note:'Called 6am — said no, family thing' },
    { id:'OT-5', employee:'Tyler Dellorusso', date:'2026-07-18', hours:16, status:'worked', note:'Double' },
    { id:'OT-6', employee:'Ray Mursch',    date:'2026-07-19', hours:8,  status:'noshow',   note:'No call, no show' },
  ];
  const otPayload = {
    entries, baseline,
    totals: computeOtTotals(entries, baseline),
    statuses: OT_STATUSES, defaultHours: 8
  };

  const dom = new JSDOM(fs.readFileSync(HTML,'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true,
    url: BASE + '/ot/',
    beforeParse(w) {
      const me = AS_CREW
        ? { displayName:'Ray Sinnott', username:'rsinnott', role:'crew' }
        : { displayName:'Mateusz Targosz', username:'mtargosz', role:'admin' };
      w.localStorage.setItem('hvac_session', JSON.stringify(me));
      w.fetch = (url, opts) => {
        const u = String(url);
        if (opts && opts.method && opts.method !== 'GET')
          return Promise.resolve({ ok:true, json:()=>Promise.resolve({success:true}) });
        if (u.includes('/api/ot'))            return Promise.resolve({ok:true,json:()=>Promise.resolve(otPayload)});
        if (u.includes('/api/time-off'))      return Promise.resolve({ok:true,json:()=>Promise.resolve(timeOff)});
        if (u.includes('/api/data/pm_users')) return Promise.resolve({ok:true,json:()=>Promise.resolve(users)});
        return Promise.resolve({ok:true,json:()=>Promise.resolve({})});
      };
      w.__errors=[];
      w.addEventListener('error', e=>w.__errors.push(e.message));
      const ce=w.console.error; w.console.error=(...a)=>{w.__errors.push(a.join(' ')); ce(...a);};
      w.confirm = () => true;
    }
  });

  const w=dom.window, d=w.document;
  await new Promise(r=>setTimeout(r,1200));
  const ev = e => { try { return w.eval(e); } catch(x){ return undefined; } };
  const html = id => { const e=d.getElementById(id); return e?e.innerHTML.trim():''; };

  check('No JS errors on load', w.__errors.length===0, w.__errors.slice(0,2).join(' | '));

  // Data actually loaded
  check('OT entries loaded', (ev('OT.entries.length')||0) === 6);
  check('Totals loaded', Object.keys(ev('OT.totals')||{}).length === 10);
  check('Time off loaded (for OFF cells)', (ev('TIMEOFF.requests.length')||0) > 50);

  // Grid rendered
  const grid = html('otGrid');
  check('Grid rendered', grid.length > 0);
  check('Grid has all 10 engineers', (grid.match(/ot-nm/g)||[]).length === 10, `${(grid.match(/ot-nm/g)||[]).length} rows`);
  check('Grid has 7 day columns', (grid.match(/<th>/g)||[]).length === 9, `${(grid.match(/<th>/g)||[]).length} (7 days + Week + Total)`);

  // The three colour states from the old sheet
  check('Black "worked" cells render', (grid.match(/ot-cell worked/g)||[]).length === 4,
        `${(grid.match(/ot-cell worked/g)||[]).length} worked`);
  check('Red "said no" cells render', (grid.match(/ot-cell declined/g)||[]).length === 1);
  check('Blue "no call/show" cells render', (grid.match(/ot-cell noshow/g)||[]).length === 1);
  check('OFF cells pulled from time off', (grid.match(/ot-cell off/g)||[]).length > 0,
        `${(grid.match(/ot-cell off/g)||[]).length} OFF cells`);
  check('Comment marker shows on noted entries', (grid.match(/class="cm"/g)||[]).length === 3,
        `${(grid.match(/class="cm"/g)||[]).length} of 3 entries have comments`);

  // Rotation
  const call = html('callList');
  check('Call list rendered', call.length > 0 && !/No OT list/.test(call));
  const order = ev('rotation().map(x=>x[0])') || [];
  check('Rotation excludes Mateusz', !order.includes('Mateusz Targosz'));
  check('Rotation sorted fewest-hours-first',
        order.every((n,i)=> i===0 || ev(`OT.totals[${JSON.stringify(order[i-1])}].total`) <= ev(`OT.totals[${JSON.stringify(n)}].total`)),
        order.slice(0,3).join(' → '));

  // The fairness rule, end to end through the page's own totals
  const seanTotal = ev("OT.totals['Sean Fanning'].total");
  check('Declining charged the hours (Sean 448 → 456)', seanTotal === 456, `got ${seanTotal}`);
  const murschTotal = ev("OT.totals['Ray Mursch'].total");
  check('No-show charged the hours (Mursch 456 → 464)', murschTotal === 464, `got ${murschTotal}`);
  const tyler = ev("OT.totals['Tyler Dellorusso'].total");
  check('Double OT counted as 16 (Tyler 448 → 464)', tyler === 464, `got ${tyler}`);

  // Week navigation
  const t1 = d.getElementById('wkTitle').textContent;
  ev('shiftWeek(1)');
  const t2 = d.getElementById('wkTitle').textContent;
  check('Week nav moves forward', t1 !== t2, `${t1.slice(0,14)} → ${t2.slice(0,14)}`);
  ev('shiftWeek(-1)');

  // Logging modal
  if (!AS_CREW) {
    ev("openCell('Brian Scudder','2026-07-15')");
    check('Admin: modal opens on cell tap', d.getElementById('otModal').className.includes('show'));
    check('Admin: status picker present', (html('otModal').match(/st-btn/g)||[]).length >= 3);
    ev("pickStatus('declined')");
    check('Admin: can pick "said no"', ev('mStatus') === 'declined');
    ev("pickHours(16)");
    check('Admin: can pick 16 hrs', ev('mHours') === 16);
    ev('closeModal()');

    // Editing an existing entry preloads its comment
    ev("openCell('Sean Fanning','2026-07-18')");
    check('Admin: editing preloads the comment',
          /said no, family thing/.test(d.getElementById('m_note').value));
    check('Admin: editing preloads status', ev('mStatus') === 'declined');
    check('Admin: delete button appears on existing entry',
          d.getElementById('delBtn').style.display !== 'none');
    ev('closeModal()');

    // On a day the person is off, warn
    ev("openCell('Sean Fanning','2026-07-15')");   // Sean on vacation 7/13-7/17
    check('Admin: warns when logging OT on a day off', /time off/i.test(html('offWarn')), html('offWarn').slice(0,50));
    ev('closeModal()');
  } else {
    ev("openCell('Brian Scudder','2026-07-15')");
    check('Crew: cannot open the logging modal', !d.getElementById('otModal').className.includes('show'));
    check('Crew: still sees the grid', (html('otGrid').match(/ot-nm/g)||[]).length === 10);
    check('Crew: still sees the call list', html('callList').length > 0);
  }

  console.log(`\n═══ OT PAGE TEST — as ${AS_CREW?'CREW':'ADMIN'} ═══\n`);
  out.forEach(([m,n,dd]) => console.log(`  ${m} ${n}${dd?'  → '+dd:''}`));
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail?1:0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
