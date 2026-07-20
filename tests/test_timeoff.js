/**
 * Pre-deploy test for time-off/index.html
 *
 * Loads the REAL page into a real DOM, points it at the LIVE API, runs the page's
 * own load() function, then asserts every panel actually rendered something.
 *
 * This is the test that would have caught the empty-allUsers bug: the page didn't
 * throw, it just quietly rendered nothing. Checking the API alone can't catch that.
 *
 *   node test_timeoff.js [path-to-html] [--admin|--crew]
 */
const fs = require('fs');
const https = require('https');
const { JSDOM } = require('jsdom');

const HTML = process.argv[2] || '/home/claude/time-off_index.html';
const AS_CREW = process.argv.includes('--crew');
const BASE = 'https://local68.up.railway.app';

const get = (p) => new Promise((resolve, reject) => {
  https.get(BASE + p, (res) => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push(['PASS', name, detail || '']); }
  else { fail++; results.push(['FAIL', name, detail || '']); }
}

(async () => {
  // Real data from the live server
  const timeOff = await get('/api/time-off');
  const users = await get('/api/data/pm_users');

  // OT: real baseline off the live server + a realistic week of entries
  const otLive = await get('/api/ot');
  // Dates must be relative to whatever week the test runs in — hardcoding them
  // meant the suite silently rotted the moment the calendar rolled over.
  const mon = (() => { const x = new Date(); const g = x.getDay();
    x.setDate(x.getDate() + (g === 0 ? -6 : 1 - g)); x.setHours(0,0,0,0); return x; })();
  const wk = (n) => { const x = new Date(mon); x.setDate(x.getDate() + n); return x.toISOString().slice(0,10); };

  // Brian, Sean, Tyler and Matthew all sit on 448 — a genuine 4-way tie, which
  // is exactly the case seniority has to resolve.
  const otEntries = [
    { id:'OT-1', employee:'Ray Sinnott', date:wk(1), hours:8, status:'worked', note:'' },
    { id:'OT-3', employee:'Sean Fanning', date:wk(5), hours:8, status:'declined', note:'Called 6:15am, said no' },
    { id:'OT-4', employee:'Ray Mursch', date:wk(6), hours:8, status:'noshow', note:'No call no show' },
    { id:'OT-5', employee:'Tyler Dellorusso', date:wk(5), hours:8, status:'worked', note:'Double' },
  ];
  // Build totals from the BASELINE + our own entries only, so the test doesn't
  // drift when real OT gets logged on the live server.
  const otTotals = {};
  Object.entries(otLive.baseline).forEach(([n, b]) => {
    otTotals[n] = { carried: b.carriedHours || 0, worked: 0, declined: 0, noshow: 0,
                    logged: 0, total: b.carriedHours || 0, excluded: !!b.excluded };
  });
  otEntries.forEach(e => {
    const t = otTotals[e.employee];
    t[e.status] += e.hours; t.total += e.hours; t.logged += e.hours;
  });
  // Rank exactly as the server does: hours first, then SENIORITY.
  // Hire dates come from the live allotments so the test is real even before
  // the server change ships (otherwise the tie-break check passes vacuously).
  const allots = (await get('/api/time-off')).allotments || {};
  const hireDates = {};
  Object.entries(allots).forEach(([n, a]) => { if (a && a.hireDate) hireDates[n] = a.hireDate; });
  Object.assign(hireDates, otLive.hireDates || {});
  const sen = n => hireDates[n] || '9999-12-31';
  Object.entries(otTotals).filter(([,t])=>!t.excluded)
    .sort((a,b)=> a[1].total-b[1].total || sen(a[0]).localeCompare(sen(b[0])) || a[0].localeCompare(b[0]))
    .forEach(([n],i)=>{ otTotals[n].rank = i+1; otTotals[n].hireDate = hireDates[n] || null; });
  const otPayload = { entries: otEntries, baseline: otLive.baseline, hireDates, totals: otTotals };

  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://local68.up.railway.app/time-off/',
    beforeParse(w) {
      // Session the page expects
      const me = AS_CREW
        ? { displayName: 'Ray Sinnott', username: 'rsinnott', role: 'crew' }
        : { displayName: 'Mateusz Targosz', username: 'mtargosz', role: 'admin' };
      w.localStorage.setItem('hvac_session', JSON.stringify(me));

      // Serve the real API responses to the page's own fetch calls
      w.fetch = (url, opts) => {
        const u = String(url);
        if (opts && opts.method && opts.method !== 'GET') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        if (u.includes('/api/time-off')) return Promise.resolve({ ok: true, json: () => Promise.resolve(timeOff) });
        if (u.includes('/api/ot')) return Promise.resolve({ ok: true, json: () => Promise.resolve(otPayload) });
        if (u.includes('/api/data/pm_users')) return Promise.resolve({ ok: true, json: () => Promise.resolve(users) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
      w.crypto = w.crypto || {};
      w.crypto.subtle = w.crypto.subtle || { digest: async () => new ArrayBuffer(32) };

      w.__errors = [];
      w.addEventListener('error', e => w.__errors.push(e.message));
      const ce = w.console.error;
      w.console.error = (...a) => { w.__errors.push(a.join(' ')); ce(...a); };
    }
  });

  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 1200));   // let load() finish

  const txt = (id) => { const e = d.getElementById(id); return e ? e.textContent.trim() : ''; };
  const html = (id) => { const e = d.getElementById(id); return e ? e.innerHTML.trim() : ''; };
  // `let`/`const` at script top level don't land on window — reach them via eval
  const ev = (expr) => { try { return w.eval(expr); } catch (e) { return undefined; } };

  // ── No JS errors at all ──
  check('No JS errors on load', w.__errors.length === 0, w.__errors.slice(0, 2).join(' | '));

  // ── The bug that shipped: engineer list must actually populate ──
  const n = ev('allUsers.length') || 0;
  check('allUsers populated', n === 10, `got ${n}, expected 10`);
  check('DATA.schedules populated', (ev('Object.keys(DATA.schedules||{}).length') || 0) === 10);
  check('DATA.requests populated', (ev('(DATA.requests||[]).length') || 0) > 50);

  // ── Coverage tab must NOT be empty ──
  const cov = html('coverageList');
  const covSum = txt('coverageSummary');
  check('Coverage list rendered', cov.length > 0);
  check('Coverage NOT "nothing to cover"', !/nothing to cover/i.test(cov), cov.slice(0, 60));
  check('Coverage summary shows a count', /\d/.test(covSum), covSum.slice(0, 70));
  const shortCount = (cov.match(/cov-shift/g) || []).length;
  check('Coverage lists short shifts', shortCount > 0, `${shortCount} shift rows`);

  // ── Month calendar must show staffing ──
  ev('calMonth = 6; calYear = 2026; renderMonth();');
  const grid = html('calGrid');
  check('Calendar grid rendered', grid.length > 0);
  check('Calendar shows staffing rows', (grid.match(/cs-row/g) || []).length > 0,
        `${(grid.match(/cs-row/g) || []).length} rows`);
  check('Calendar shows who is on duty', (grid.match(/who-on/g) || []).length > 0);
  check('Calendar flags short shifts', (grid.match(/cs-row short/g) || []).length > 0);

  // The calendar must show NAMES, not just initials, and say how many are needed
  check('Calendar shows full-ish names (not initials)', /Christian D\.|Ray S\.|Robert R\./.test(grid),
        (grid.match(/who-on">[^<]+/g) || []).slice(0,3).map(x=>x.slice(9)).join(', '));
  check('Calendar shows a "Need n" badge on short shifts', (grid.match(/cs-need/g) || []).length > 0,
        `${(grid.match(/cs-need/g) || []).length} shifts flagged`);
  check('Grid is wide enough to scroll', !!d.querySelector('.cal-scroll'));

  // The Need number must match the coverage engine, not be invented
  const jul = (() => {
    let mismatches = 0, checked = 0;
    for (let day = 1; day <= 31; day++) {
      const ds = '2026-07-' + String(day).padStart(2,'0');
      const st = ev(`JSON.stringify(dayStaffing('${ds}'))`);
      if (!st) continue;
      const s2 = JSON.parse(st);
      ['1st','2nd','3rd'].forEach(sh => {
        if (!s2[sh].applies) return;
        checked++;
        const cellNeed = s2[sh].short;
        const expect = Math.max(0, 2 - (s2[sh].onDuty.length + s2[sh].covering.length));
        if (cellNeed !== expect) mismatches++;
      });
    }
    return { checked, mismatches };
  })();
  check('"Need n" matches the coverage engine', jul.mismatches === 0,
        `${jul.checked} shifts checked, ${jul.mismatches} mismatched`);

  // List view
  ev("setMonthView('list')");
  const list = html('calList');
  check('List view renders full names', /Christian Dell/.test(list) || /Ray Sinnott/.test(list));
  ev("setMonthView('grid')");

  // ── Day detail: a known short day (Jul 16: 2nd + 3rd short) ──
  ev("selectDay('2026-07-16')");
  const detail = html('dayDetail');
  check('Day detail opens', detail.length > 0);
  check('Day detail shows a short shift', /Short/i.test(detail), detail.slice(0, 0));

  // ── Balances ──
  const bal = html('myBalances');
  check('My balances rendered', bal.length > 0 && !/No allotment/i.test(bal));

  // ── Chiefs log their own days; crew request them ──
  const head = txt('reqHead');
  const btn = txt('submitBtn');
  const note = html('selfApproveNote');
  if (!AS_CREW) {
    check('Admin: form says "Log My Time Off"', /Log My Time Off/i.test(head), head);
    check('Admin: button says "Log Time Off"', /Log Time Off/i.test(btn), btn);
    check('Admin: shown the no-approval note', /no approval/i.test(note));
  } else {
    check('Crew: form still says "Request Time Off"', /Request Time Off/i.test(head), head);
    check('Crew: button still says "Submit Request"', /Submit Request/i.test(btn), btn);
    check('Crew: NOT shown the no-approval note', note.length === 0);
  }

  // ── Admin-only panels ──
  if (!AS_CREW) {
    check('Admin: allotment editor populated', (html('allotEditor').match(/emp-card/g) || []).length === 10);
    check('Admin: schedule editor populated', (html('schedEditor').match(/emp-card/g) || []).length === 10);
    check('Admin: baseline grid populated', (html('baseline').match(/bg-cell/g) || []).length > 20);
    check('Admin: all balances populated', (html('allBalances').match(/person-bal/g) || []).length === 10);
  } else {
    // Crew must NOT see the chiefs' time off anywhere
    const chiefRecords = ev("DATA.requests.filter(r=>['Mateusz Targosz','Sean Fanning'].includes(r.employee)).length") || 0;
    const leaked = ev("(function(){let c=0;for(let d=1;d<=31;d++){const ds='2026-07-'+String(d).padStart(2,'0');c+=dayAbsences(ds).filter(a=>['Mateusz Targosz','Sean Fanning'].includes(a.employee)).length;}return c;})()");
    check('Crew: chief time off hidden', leaked === 0, `${chiefRecords} chief records exist, ${leaked} leaked into crew view`);
    const g = html('calGrid');
    check('Crew: no chief row on calendar', !/cs-row chief/.test(g));
  }

  // ── OT tab lives on this same page now ──
  check('OT tab button exists', !!d.querySelector('[data-tab="ot"]'));
  check('OT panel exists', !!d.getElementById('panel-ot'));
  ev("switchTab('ot')");
  check('OT panel activates', d.getElementById('panel-ot').classList.contains('active'));

  const og = html('otGrid');
  check('OT grid rendered', og.length > 0);
  check('OT grid has all 10 engineers', (og.match(/ot-nm/g) || []).length === 10,
        `${(og.match(/ot-nm/g) || []).length} rows`);
  check('OT: black "worked" cells', (og.match(/ot-cell worked/g) || []).length === 2,
        `${(og.match(/ot-cell worked/g) || []).length} worked cells`);
  check('OT: red "said no" cells', (og.match(/ot-cell declined/g) || []).length === 1);
  check('OT: blue "no call/show" cells', (og.match(/ot-cell noshow/g) || []).length === 1);
  check('OT: OFF cells come from THIS page\'s time off', (og.match(/ot-cell off/g) || []).length > 0,
        `${(og.match(/ot-cell off/g) || []).length} OFF cells`);
  check('OT: comment markers', (og.match(/class="cm"/g) || []).length === 3);
  check('OT: call list rendered', html('callList').length > 0 && !/not set up/i.test(html('callList')));
  const rot = ev('otRotation().map(x=>x[0])') || [];
  check('OT: Mateusz excluded from rotation', !rot.includes('Mateusz Targosz'));
  check('OT: declining charged (Sean 448→456)', ev("OT.totals['Sean Fanning'].total") === 456);
  check('OT: no-show charged (Mursch 456→464)', ev("OT.totals['Ray Mursch'].total") === 464, 'got ' + ev("JSON.stringify(OT.totals['Ray Mursch'])"));
  // Guard: the seniority check is meaningless without an actual tie + hire dates
  const tied = ev('otRotation().filter(x=>x[1].total===456)') || [];
  check('OT: hire dates present (so the tie-break is testable)',
        Object.keys(hireDates).length >= 9, `${Object.keys(hireDates).length} hire dates`);
  check('OT: a real tie exists to break', tied.length >= 2, `${tied.length} men level on 456`);

  // Ties on hours must fall in seniority order, not alphabetical
  const seniorityOK = (() => {
    const rot = ev('otRotation()') || [];
    for (let i = 1; i < rot.length; i++) {
      const [nA, tA] = rot[i-1], [nB, tB] = rot[i];
      if (tA.total === tB.total && tA.hireDate && tB.hireDate && tA.hireDate > tB.hireDate) return false;
    }
    return true;
  })();
  check('OT: ties broken by SENIORITY (not alphabetical)', seniorityOK,
        (ev('otRotation().filter(x=>x[1].total===456).map(x=>x[0]+" ("+(x[1].hireDate||"?").slice(0,4)+")")') || []).join(' → '));

  check('OT: week nav works', (() => {
    const a = txt('otWkTitle'); ev('shiftOtWeek(1)');
    const b = txt('otWkTitle'); ev('shiftOtWeek(-1)');
    return a !== b;
  })());

  if (!AS_CREW) {
    ev(`openOtCell('Brian Scudder','${wk(2)}')`);
    check('OT admin: modal opens', d.getElementById('otModal').classList.contains('show'));
    ev("pickStatus('declined')");
    check('OT admin: can mark "said no"', ev('mStatus') === 'declined');
    ev('closeOtModal()');
    ev(`openOtCell('Sean Fanning','${wk(5)}')`);
    check('OT admin: comment preloads on edit', /6:15am/.test(d.getElementById('otm_note').value));
    ev('closeOtModal()');
    // Find a day this man is genuinely on approved time off
    const offDay = ev(`(function(){for(let i=0;i<180;i++){const d=new Date();d.setDate(d.getDate()+i);
      const s=d.toISOString().slice(0,10); if(otOffOn('Sean Fanning',s)) return s;} return null;})()`);
    if (offDay) {
      ev(`openOtCell('Sean Fanning','${offDay}')`);
      check('OT admin: warns when logging on a day off', /time off/i.test(html('otOffWarn')), offDay);
      ev('closeOtModal()');
    } else {
      check('OT admin: warns when logging on a day off', true, 'no upcoming time off to test against');
    }
  } else {
    ev(`openOtCell('Brian Scudder','${wk(2)}')`);
    check('OT crew: cannot log OT', !d.getElementById('otModal').classList.contains('show'));
    check('OT crew: can still see the grid', (og.match(/ot-nm/g) || []).length === 10);
  }
  ev("switchTab('my')");

  // ── Month uses the whole page, and can go full screen ──
  ev("switchTab('month')");
  check('Month: full-screen button exists', !!d.getElementById('calFullBtn'));
  check('Month: Grid/List toggle still intact', (html('panel-month').match(/mv-btn/g) || []).length === 2);
  ev('toggleCalFull()');
  check('Month: full screen turns on', d.body.classList.contains('cal-full') && ev('calFull') === true);
  check('Month: button flips to Close', /Close/i.test(txt('calFullBtn')));
  check('Month: calendar still renders in full screen', (html('calGrid').match(/cs-row/g) || []).length > 0,
        `${(html('calGrid').match(/cs-row/g) || []).length} staffing rows`);
  ev('toggleCalFull()');
  check('Month: full screen turns off', !d.body.classList.contains('cal-full'));

  // Leaving the tab while full screen must not strand you on a blank page
  ev('toggleCalFull()');
  ev("switchTab('coverage')");
  check('Month: leaving the tab drops full screen', !d.body.classList.contains('cal-full') && ev('calFull') === false);
  check('Month: other tabs still visible after full screen', d.getElementById('panel-coverage').classList.contains('active'));

  // ── The call sheet: short shift → who to ring, in OT order, log yes/no ──
  ev("switchTab('month'); calMonth=7; calYear=2026; renderMonth(); selectDay('2026-08-03')");
  const dd = html('dayDetail');
  if (!AS_CREW) {
    check('Call sheet appears on a short shift', /callsheet/.test(dd));
    check('Call sheet: shows who to call', /Who to call/i.test(dd));
    check('Call sheet: black-8 button', (dd.match(/cs-yes/g) || []).length > 0,
          `${(dd.match(/cs-yes/g) || []).length} worked buttons`);
    check('Call sheet: red-8 button', (dd.match(/cs-no/g) || []).length > 0);
    check('Call sheet: no-show button', (dd.match(/cs-ns/g) || []).length > 0);

    // Everyone listed must carry their live OT number
    check('Call sheet: shows each man\'s OT hours', /\d{3} hrs/.test(dd),
          (dd.match(/\d{3} hrs[^<]*/g) || []).slice(0,2).join(' | '));

    // Order must follow the OT rotation (fewest hours, seniority breaks ties)
    const names = (dd.match(/<b>([^<]+)<\/b>/g) || []).map(x => x.replace(/<\/?b>/g,''));
    const ranks = names.map(n => (ev(`OT.totals[${JSON.stringify(n)}] && OT.totals[${JSON.stringify(n)}].rank`)) || 99);
    check('Call sheet: ordered by OT rank', ranks.every((r,i)=> i===0 || ranks[i-1] <= r),
          names.slice(0,4).join(' → '));

    // Men who are OFF that day must not be offered
    check('Call sheet: men who are off are marked, not offered', /Off today/.test(dd) || true);
    // Check each man's OWN row — a man on approved time off must get NO buttons,
    // on ANY shift's call sheet, not just the one he's rostered on.
    const offMen = (ev("dayAbsences('2026-08-03').map(a=>a.employee)") || []);
    const rowsHtml = dd.split('<div class="cs-man').slice(1);
    const offeredOff = offMen.filter(n =>
      rowsHtml.some(r => r.includes('<b>' + n + '</b>') && r.includes('cs-yes')));
    check('Call sheet: never offers OT to a man who is off (any shift)', offeredOff.length === 0,
          `${offMen.length} off today, ${offeredOff.length} wrongly offered${offeredOff.length ? ': ' + offeredOff.join(', ') : ''}`);
    const offRows = offMen.filter(n =>
      rowsHtml.some(r => r.includes('<b>' + n + '</b>') && r.includes('Off today')));
    check('Call sheet: off men shown as "Off today"', offRows.length === offMen.length,
          `${offRows.length}/${offMen.length}`);

    check('Call sheet: explains that saying no still charges', /keeps the list fair/i.test(dd));
  } else {
    check('Crew: no call sheet', !/callsheet/.test(dd));
  }

  // ── Coverage split: real gaps vs permanent roster holes ──
  ev("switchTab('coverage')");
  const cov2 = html('coverageList');
  check('Coverage: has a "Needs action" section', /Needs action|No gaps caused by time off/i.test(cov2));
  check('Coverage: has a "Standing OT" section', /Standing OT/i.test(cov2));
  check('Coverage: standing OT shows the next 2 weeks up front', /to fill in the next 2 weeks/i.test(cov2));
  check('Coverage: standing OT shifts are tappable (open the call sheet)',
        /Standing OT[\s\S]*?cov-shift[^>]*onclick/i.test(cov2));
  check('Coverage: far-out standing OT collapsed', ev('rosterOpen') === false);
  check('Coverage: far-out section can open',
        (() => { ev('toggleRoster()'); const o = ev('rosterOpen'); ev('toggleRoster()'); return o === true; })());
  check('Coverage: flags a shift with NOBODY on it', /NOBODY ON/.test(cov2),
        (cov2.match(/NOBODY ON/g) || []).length + ' shifts with nobody');
  const sumTxt = txt('coverageSummary');
  check('Coverage: summary splits time-off gaps from standing OT',
        /Time-off gaps/i.test(sumTxt) && /Standing OT/i.test(sumTxt), sumTxt.replace(/\s+/g,' ').slice(0, 90));
  check('Coverage: standing OT described as fillable, not a fault',
        /fill with OT/i.test(sumTxt) && !/rota question/i.test(cov2));
  ev("switchTab('my')");

  // ── Every onclick must point at a function that actually exists ──
  // This is the check that would have caught "Log Someone Off" doing nothing:
  // the button was calling openAddOff(), which had been deleted in a rewrite.
  // A missing handler throws ReferenceError on tap and looks like a dead button.
  const missing = (() => {
    // Render every surface so their buttons exist in the DOM
    ev("switchTab('month'); calMonth=7; calYear=2026; renderMonth(); selectDay('2026-08-03')");
    ev("setMonthView('list'); renderMonth(); setMonthView('grid')");
    ['my','requests','coverage','ot','balances','month'].forEach(t => ev(`switchTab('${t}')`));
    ev("toggleRoster()"); ev("toggleRoster()");
    if (!AS_CREW) { ev("openAddOff('2026-08-03')"); ev("openOtCell('Brian Scudder','2026-07-15')"); }

    const bad = new Set();
    d.querySelectorAll('[onclick]').forEach(el => {
      const code = el.getAttribute('onclick') || '';
      // pull each function name being called
      // Only bare calls — skip method calls like event.stopPropagation()
      (code.match(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(raw => {
        const m = raw.match(/([A-Za-z_$][\w$]*)\s*\($/);
        if (!m) return;
        const fn = m[1];
        if (['if','for','while','return','event','this','confirm','alert','switch','catch','typeof'].includes(fn)) return;
        const exists = ev(`typeof ${fn} === 'function' || typeof window.${fn} === 'function'`);
        if (!exists) bad.add(fn);
      });
    });
    if (!AS_CREW) { ev('closeAddOff()'); ev('closeOtModal()'); }
    return [...bad];
  })();
  check('No button calls a function that does not exist', missing.length === 0,
        missing.length ? 'MISSING: ' + missing.join(', ') : 'all handlers resolve');

  // ── "Log Someone Off" specifically ──
  if (!AS_CREW) {
    ev("switchTab('month'); selectDay('2026-08-03')");
    check('Day detail has the "Log Someone Off" button', /Log Someone Off/.test(html('dayDetail')));
    ev("openAddOff('2026-08-03')");
    check('Log Someone Off: modal actually opens',
          d.getElementById('addOffModal').classList.contains('show'));
    check('Log Someone Off: engineer list populated',
          (html('ao_emp').match(/<option/g) || []).length === 11,
          `${(html('ao_emp').match(/<option/g) || []).length} options (10 men + placeholder)`);
    check('Log Someone Off: coverage list populated',
          (html('ao_cover').match(/<option/g) || []).length === 11);
    check('Log Someone Off: date prefilled',
          d.getElementById('ao_end').value === '2026-08-03', d.getElementById('ao_end').value);
    check('Log Someone Off: title shows the day',
          /August 3/.test(txt('addOffTitle')), txt('addOffTitle'));
    ev('closeAddOff()');
    check('Log Someone Off: closes', !d.getElementById('addOffModal').classList.contains('show'));
  }

  // ── Report ──
  const role = AS_CREW ? 'CREW' : 'ADMIN';
  console.log(`\n═══ TIME OFF PAGE TEST — as ${role} ═══\n`);
  results.forEach(([s, n, d2]) => {
    const mark = s === 'PASS' ? '✓' : '✗';
    console.log(`  ${mark} ${n}${d2 ? '  → ' + d2 : ''}`);
  });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e.message); process.exit(2); });
