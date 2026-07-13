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
