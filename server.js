const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_OWNER = "coldbreezellc-pixel";
const GH_REPO = "hvacportal";
const GH_BRANCH = "main";

// ── Resend Email API (HTTPS, no SMTP port issues) ──
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ── Slack integration (optional — set in Railway env vars) ──
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;  // required to receive Slack events
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;            // optional — for posting confirmations
const SLACK_ALLOWED_CHANNELS = (process.env.SLACK_ALLOWED_CHANNELS || '').split(',').map(s=>s.trim()).filter(Boolean);
const SLACK_TRIGGER_KEYWORDS = (process.env.SLACK_TRIGGER_KEYWORDS || 'wo,work order,cold call,repair,emergency').toLowerCase().split(',').map(s=>s.trim());

// ── Cloudflare R2 photo storage (optional — set in Railway env vars) ──
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''); // strip trailing /

const R2_CONFIGURED = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_URL);

let r2Client = null;
if (R2_CONFIGURED) {
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
    });
    console.log('✓ Cloudflare R2 client initialized for bucket:', R2_BUCKET_NAME);
  } catch (e) {
    console.error('R2 init failed:', e.message);
  }
}

async function sendEmail({ to, subject, html, attachments }) {
  const body = {
    from: 'HVAC Portal <noreply@coldbreezellc.com>',
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };
  if (attachments && attachments.length) {
    body.attachments = attachments.map(a => {
      const att = {
        filename: a.filename,
        content: a.content,
        content_type: a.contentType || 'application/octet-stream'
      };
      if (a.cid) att.content_id = a.cid;
      return att;
    });
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.message || JSON.stringify(result));
  return result;
}

app.use(express.json({ limit: '25mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '25mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// Test email endpoint
app.get('/api/test-email', async (req, res) => {
  try {
    if (!RESEND_API_KEY) return res.json({ error: 'RESEND_API_KEY not set' });
    const result = await sendEmail({ to: 'coldbreezellc@gmail.com', subject: 'HVAC Portal Test', html: '<p>Email system is working!</p>' });
    res.json({ success: true, id: result.id });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── Helper: push file to GitHub ──
// Write a file to GitHub. Retries on 409/422 (SHA conflict) — happens when two
// people save at the same moment. Without this, one write silently wins and the
// other is lost. Retries re-read the latest SHA before trying again.
async function ghPut(filePath, content, message, _attempt = 0) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;
  let sha = null;
  try {
    const check = await fetch(url + "?ref=" + GH_BRANCH + "&t=" + Date.now(), { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (check.ok) { const d = await check.json(); sha = d.sha; }
  } catch {}
  const body = { message, content: Buffer.from(content).toString('base64'), branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const resp = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (resp.ok) return await resp.json();
  // SHA conflict — someone else wrote first. Back off and retry with a fresh SHA.
  if ((resp.status === 409 || resp.status === 422) && _attempt < 4) {
    await new Promise(r => setTimeout(r, 400 * Math.pow(2, _attempt) + Math.random() * 300));
    return ghPut(filePath, content, message, _attempt + 1);
  }
  throw new Error(`GitHub PUT failed: ${resp.status}`);
}

// Read-modify-write with conflict retry. `mutate` receives the current parsed
// array/object and returns the new one. Re-reads fresh data on each retry so a
// concurrent write is merged instead of clobbered.
async function ghUpdateJson(filePath, mutate, message, fallback = []) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const d = await ghGet(filePath);
    let current = fallback;
    if (d && d.content) { try { current = JSON.parse(d.content); } catch {} }
    const next = await mutate(current);
    if (next === null) return null; // mutate signalled "nothing to do"
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;
    const body = { message, content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64'), branch: GH_BRANCH };
    if (d && d.sha) body.sha = d.sha;
    const resp = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (resp.ok) return next;
    if (resp.status !== 409 && resp.status !== 422) throw new Error(`GitHub PUT failed: ${resp.status}`);
    await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt) + Math.random() * 300));
  }
  throw new Error('GitHub PUT failed after retries (write conflict)');
}

// ── Helper: get file from GitHub ──
async function ghGet(filePath) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}?ref=${GH_BRANCH}&t=${Date.now()}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
}

// ── GitHub data proxy endpoints ──
app.get('/api/data/:key', async (req, res) => {
  try {
    const data = await ghGet(`data/${req.params.key}.json`);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ key: req.params.key, value: data.content, sha: data.sha });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/data/:key', async (req, res) => {
  try {
    const { value, sha } = req.body;
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${req.params.key}.json`;
    const body = { message: `Update ${req.params.key}`, content: Buffer.from(value).toString('base64'), branch: GH_BRANCH };
    if (sha) body.sha = sha;
    const resp = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) { const err = await resp.text(); return res.status(resp.status).json({ error: err }); }
    const result = await resp.json();
    res.json({ key: req.params.key, value, sha: result.content.sha });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/data/:key', async (req, res) => {
  try {
    const { sha } = req.body;
    if (!sha) return res.status(400).json({ error: 'SHA required' });
    await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${req.params.key}.json`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete ${req.params.key}`, sha, branch: GH_BRANCH })
    });
    res.json({ key: req.params.key, deleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── BACKUP ENDPOINT ──
// Saves a timestamped snapshot of inventory + users + logs to backups/ folder
app.post('/api/backup', async (req, res) => {
  try {
    const { type, technician, details } = req.body;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dateStr = (now.getMonth()+1) + '-' + now.getDate() + '-' + now.getFullYear();
    const techName = (technician || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
    const backupName = `${type || 'backup'}_${techName}_${ts}`;

    const results = [];

    // Backup inventory data
    const inv = await ghGet('data/pm_inventory.json');
    if (inv) {
      await ghPut(`backups/${dateStr}/${backupName}_inventory.json`, inv.content, `Backup inventory — ${type} — ${technician} — ${now.toLocaleString()}`);
      results.push('inventory');
    }

    // Backup users data
    const users = await ghGet('data/pm_users.json');
    if (users) {
      await ghPut(`backups/${dateStr}/${backupName}_users.json`, users.content, `Backup users — ${type} — ${technician}`);
      results.push('users');
    }

    // Backup logs
    const logs = await ghGet('data/pm_logs.json');
    if (logs) {
      await ghPut(`backups/${dateStr}/${backupName}_logs.json`, logs.content, `Backup logs — ${type} — ${technician}`);
      results.push('logs');
    }

    // If report details provided (CSV/text content), save that too
    if (details) {
      await ghPut(`backups/${dateStr}/${backupName}_report.txt`, details, `Report — ${type} — ${technician}`);
      results.push('report');
    }

    res.json({ success: true, backup: backupName, files: results });
  } catch (e) {
    console.error('Backup error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PM WORK ORDER PERMANENT ARCHIVE ──
const MONTHS = ['01-January','02-February','03-March','04-April','05-May','06-June','07-July','08-August','09-September','10-October','11-November','12-December'];

app.post('/api/backup-pm', async (req, res) => {
  try {
    const { technician, facility, equipment, frequency, followUp, followUpNotes, date, emailHtml, safetyData, postJobData, checklistData, signatureData, lotoPhotos, generalComments, tasksCompleted } = req.body;
    const now = new Date();
    const year = now.getFullYear();
    const month = MONTHS[now.getMonth()];
    const day = String(now.getDate()).padStart(2, '0');
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const techName = (technician || 'unknown').replace(/[^a-zA-Z0-9,. ]/g, '').replace(/\s+/g, '_');
    const equipShort = (equipment || 'unknown').split(',')[0].trim().replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 30);
    const freqLabel = frequency === 'Repair' ? 'Repair' : (frequency || 'PM') + '_PM';

    // Build comprehensive PM record
    const record = {
      id: ts + '_' + Math.random().toString(36).slice(2, 6),
      technician,
      facility,
      equipment,
      frequency,
      followUp: followUp || false,
      followUpNotes: followUpNotes || '',
      tasksCompleted: tasksCompleted || '',
      generalComments: generalComments || '',
      safetyData: safetyData || null,
      postJobData: postJobData || null,
      checklistData: checklistData || null,
      signatureData: signatureData || null,
      lotoPhotos: lotoPhotos || null,
      emailHtml: emailHtml || null,
      createdAt: now.toISOString(),
      dateFormatted: `${now.getMonth()+1}/${day}/${year}`,
      archivedBy: technician
    };

    const filename = `${day}_${freqLabel}_${equipShort}_${techName}`;
    const folderPath = `pm-records/${year}/${month}`;

    await ghPut(
      `${folderPath}/${filename}.json`,
      JSON.stringify(record, null, 2),
      `PM ${freqLabel} — ${equipment} — ${technician} — ${now.getMonth()+1}/${day}/${year}`
    );

    console.log(`PM archived: ${folderPath}/${filename}.json`);
    res.json({ success: true, path: `${folderPath}/${filename}.json` });
  } catch (e) {
    console.error('PM Archive error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── EMAIL ENDPOINTS ──

// Send password reset email
app.post('/api/send-reset-email', async (req, res) => {
  try {
    const { displayName, username, tempPassword, userEmail } = req.body;
    if (!displayName || !username || !tempPassword) return res.status(400).json({ error: 'Missing fields' });

    const recipients = ['mateusz.targosz@versantmedia.com', 'sean.fanning@versantmedia.com'];
    if (userEmail) recipients.push(userEmail);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <div style="background: #1B3A5C; color: #fff; padding: 16px 20px; border-radius: 10px 10px 0 0;">
          <h2 style="margin: 0; font-size: 18px;">🔐 Password Reset</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.7;">HVAC Portal — Local 68</p>
        </div>
        <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px 20px; border-radius: 0 0 10px 10px;">
          <p style="color: #334155; font-size: 14px;">Password has been reset for:</p>
          <p style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 4px 0 16px;">${displayName} <span style="color: #64748b; font-weight: 400;">(@${username})</span></p>
          <div style="background: #f0fdf4; border: 2px dashed #86efac; border-radius: 10px; padding: 16px; text-align: center; margin: 16px 0;">
            <p style="font-size: 11px; color: #64748b; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 1px;">Temporary Password</p>
            <p style="font-size: 28px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: 3px; font-family: monospace;">${tempPassword}</p>
          </div>
          <div style="background: #FFF8E1; border: 1px solid #FFE082; border-radius: 8px; padding: 12px; margin-top: 16px;">
            <p style="color: #E65100; font-size: 13px; font-weight: 600; margin: 0;">⚠️ This password must be changed on first login.</p>
          </div>
          <p style="color: #94a3b8; font-size: 11px; margin-top: 20px;">Sent from HVAC Portal at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
        </div>
      </div>`;

    const result = await sendEmail({
      to: recipients,
      subject: `🔐 Password Reset — ${displayName} (${username})`,
      html
    });

    console.log(`Reset email sent for ${username} to ${recipients.join(', ')}`);
    res.json({ success: true, sentTo: recipients, id: result.id });
  } catch (e) {
    console.error('Email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// General email sending (for PM reports, inventory reports)
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, html, attachments } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' });

    const result = await sendEmail({ to, subject, html, attachments });
    console.log(`Email sent: "${subject}" to ${Array.isArray(to) ? to.join(', ') : to}`);
    res.json({ success: true, id: result.id });
  } catch (e) {
    console.error('Email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PM RECORDS BROWSER ──
// List years
app.get('/api/pm-records', async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/pm-records?ref=${GH_BRANCH}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (!resp.ok) return res.json({ items: [] });
    const items = await resp.json();
    const years = items.filter(i => i.type === 'dir').map(i => i.name).sort().reverse();
    res.json({ items: years });
  } catch (e) { res.json({ items: [] }); }
});

// List months in a year
app.get('/api/pm-records/:year', async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/pm-records/${req.params.year}?ref=${GH_BRANCH}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (!resp.ok) return res.json({ items: [] });
    const items = await resp.json();
    const months = items.filter(i => i.type === 'dir').map(i => i.name).sort();
    res.json({ items: months });
  } catch (e) { res.json({ items: [] }); }
});

// List PMs in a month
app.get('/api/pm-records/:year/:month', async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/pm-records/${req.params.year}/${req.params.month}?ref=${GH_BRANCH}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (!resp.ok) return res.json({ items: [] });
    const items = await resp.json();
    const files = items.filter(i => i.type === 'file' && i.name.endsWith('.json')).map(i => i.name.replace('.json', '')).sort().reverse();
    res.json({ items: files });
  } catch (e) { res.json({ items: [] }); }
});

// Get a specific PM record
app.get('/api/pm-records/:year/:month/:file', async (req, res) => {
  try {
    const data = await ghGet(`pm-records/${req.params.year}/${req.params.month}/${req.params.file}.json`);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(data.content));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FULL SNAPSHOT BACKUP ──
// Creates a timestamped snapshot of all data + PM records
app.post('/api/snapshot', async (req, res) => {
  try {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snap = `backups/snapshots/${ts}`;
    const results = [];

    // Back up data files
    const dataFiles = ['pm_users.json', 'pm_inventory.json', 'pm_logs.json', 'pm_history.json', 'inventory.json', 'users.json'];
    for (const fn of dataFiles) {
      try {
        const d = await ghGet(`data/${fn}`);
        if (d && d.content) {
          const rawContent = Buffer.from(d.content, 'base64').toString('utf-8');
          await ghPut(`${snap}/data/${fn}`, rawContent, `Snapshot ${ts} — data/${fn}`);
          results.push(`data/${fn}`);
        }
      } catch (e) { /* skip missing files */ }
    }

    // Back up pm-records recursively (list years → months → files)
    try {
      const yearsResp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/pm-records?ref=${GH_BRANCH}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
      if (yearsResp.ok) {
        const yearsData = await yearsResp.json();
        for (const yearItem of yearsData.filter(i => i.type === 'dir')) {
          const monthsResp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/pm-records/${yearItem.name}?ref=${GH_BRANCH}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
          if (!monthsResp.ok) continue;
          const monthsData = await monthsResp.json();
          for (const monthItem of monthsData.filter(i => i.type === 'dir')) {
            const filesResp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/pm-records/${yearItem.name}/${monthItem.name}?ref=${GH_BRANCH}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
            if (!filesResp.ok) continue;
            const filesData = await filesResp.json();
            for (const file of filesData.filter(i => i.type === 'file' && i.name.endsWith('.json'))) {
              const f = await ghGet(`pm-records/${yearItem.name}/${monthItem.name}/${file.name}`);
              if (f && f.content) {
                const rawContent = Buffer.from(f.content, 'base64').toString('utf-8');
                await ghPut(`${snap}/pm-records/${yearItem.name}/${monthItem.name}/${file.name}`, rawContent, `Snapshot ${ts} — ${file.name}`);
                results.push(`pm-records/${yearItem.name}/${monthItem.name}/${file.name}`);
              }
            }
          }
        }
      }
    } catch (e) { console.error('PM records backup error:', e); }

    // Create manifest
    const manifest = {
      snapshot_id: ts,
      created_at: now.toISOString(),
      triggered_by: req.body.triggeredBy || 'manual',
      files_backed_up: results.length,
      files: results
    };
    await ghPut(`${snap}/MANIFEST.json`, JSON.stringify(manifest, null, 2), `Snapshot ${ts} manifest`);

    console.log(`Snapshot created: ${snap} (${results.length} files)`);
    res.json({ success: true, snapshot: ts, filesBackedUp: results.length });
  } catch (e) {
    console.error('Snapshot error:', e);
    res.status(500).json({ error: e.message });
  }
});

// List available snapshots
app.get('/api/snapshots', async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/backups/snapshots?ref=${GH_BRANCH}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (!resp.ok) return res.json({ snapshots: [] });
    const items = await resp.json();
    const snapshots = items.filter(i => i.type === 'dir').map(i => i.name).sort().reverse();
    res.json({ snapshots });
  } catch (e) { res.json({ snapshots: [] }); }
});

// ── WORK ORDER TRACKING ──
// Work orders stored in data/work_orders.json as an array
async function getWorkOrders() {
  const d = await ghGet('data/work_orders.json');
  if (d && d.content) {
    try { return JSON.parse(d.content); }
    catch (e) { return []; }
  }
  return [];
}

// List all work orders
app.get('/api/work-orders', async (req, res) => {
  try {
    const orders = await getWorkOrders();
    res.json({ orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create a work order
app.post('/api/work-orders', async (req, res) => {
  try {
    const orders = await getWorkOrders();
    const wo = req.body;
    const year = new Date().getFullYear();
    const existingNums = orders.map(o => {
      const m = (o.woNumber || '').match(/WO-\d+-(\d+)/);
      return m ? parseInt(m[1]) : 0;
    });
    const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1;
    wo.woNumber = `WO-${year}-${String(nextNum).padStart(4, '0')}`;
    wo.id = wo.woNumber;
    wo.createdAt = new Date().toISOString();
    wo.visits = wo.visits || [];
    orders.unshift(wo);
    await ghPut('data/work_orders.json', JSON.stringify(orders, null, 2), `Create work order ${wo.woNumber}`);
    res.json({ success: true, workOrder: wo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update a work order (add visit, change status, etc.)
app.put('/api/work-orders/:id', async (req, res) => {
  try {
    const orders = await getWorkOrders();
    const idx = orders.findIndex(o => o.id === req.params.id || o.woNumber === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Work order not found' });
    orders[idx] = { ...orders[idx], ...req.body, id: orders[idx].id, woNumber: orders[idx].woNumber, createdAt: orders[idx].createdAt };
    orders[idx].updatedAt = new Date().toISOString();
    await ghPut('data/work_orders.json', JSON.stringify(orders, null, 2), `Update work order ${orders[idx].woNumber}`);
    res.json({ success: true, workOrder: orders[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a work order
app.delete('/api/work-orders/:id', async (req, res) => {
  try {
    const orders = await getWorkOrders();
    const idx = orders.findIndex(o => o.id === req.params.id || o.woNumber === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Work order not found' });
    const removed = orders.splice(idx, 1)[0];
    await ghPut('data/work_orders.json', JSON.stringify(orders, null, 2), `Delete work order ${removed.woNumber}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// ── TIME OFF & COVERAGE TRACKING ──
// ═══════════════════════════════════════════
// Pools: 'sickPersonal' (Sick + Personal share one balance), 'vacation', 'floating'
// Types that draw down an annual bank of days
const TIMEOFF_POOLS = {
  'Sick': 'sickPersonal',
  'Personal': 'sickPersonal',
  'Vacation': 'vacation',
  'Floating Holiday': 'floating'
};
// Bereavement is NOT a pool — there's no annual entitlement. It's taken as it
// happens (a death in the family) and simply recorded. It draws no balance.
const NO_POOL_TYPES = ['Bereavement'];
const TIMEOFF_TYPES = [...Object.keys(TIMEOFF_POOLS), ...NO_POOL_TYPES];
const isValidType = (t) => TIMEOFF_TYPES.includes(t);

const POOL_KEYS = ['sickPersonal', 'vacation', 'floating'];
const DEFAULT_ALLOTMENT = { sickPersonal: 12, vacation: 10, floating: 3 };

// Every shift must have at least this many engineers on duty. If time off (or
// the schedule itself) drops a shift below this, it's flagged as needing coverage.
const MIN_STAFF = 2;

// Shifts — a day off is always tied to one shift, and that shift needs covering
const SHIFTS = {
  '1st': { label: '1st Shift', time: '6:00 AM – 2:00 PM' },
  '2nd': { label: '2nd Shift', time: '2:00 PM – 10:00 PM' },
  '3rd': { label: '3rd Shift', time: '10:00 PM – 6:00 AM' }
};

async function getTimeOff() {
  const d = await ghGet('data/time_off.json');
  if (d && d.content) { try { return JSON.parse(d.content); } catch (e) { return []; } }
  return [];
}
async function getAllotments() {
  const d = await ghGet('data/time_off_allotments.json');
  if (d && d.content) { try { return JSON.parse(d.content); } catch (e) { return {}; } }
  return {};
}
// Each engineer's regular week: weekday (0=Sun..6=Sat) → shift, or absent if off.
//   coverageExempt: their absence doesn't create a gap and they don't count toward MIN_STAFF
//   private:        their time off is only visible to admins
async function getSchedules() {
  const d = await ghGet('data/schedules.json');
  if (d && d.content) { try { return JSON.parse(d.content); } catch (e) { return {}; } }
  return {};
}

// Recurring weekly coverage gaps — shifts with nobody on them, week after week
async function getCoverageGaps() {
  const d = await ghGet('data/coverage_gaps.json');
  if (d && d.content) { try { return JSON.parse(d.content); } catch (e) { return []; } }
  return [];
}
// Who's covering a recurring gap on a specific date. Key: "<gapId>|<YYYY-MM-DD>"
async function getGapAssignments() {
  const d = await ghGet('data/coverage_assignments.json');
  if (d && d.content) { try { return JSON.parse(d.content); } catch (e) { return {}; } }
  return {};
}

// Count full days inclusive between two dates
function countDays(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

// Every date in a request's range, as YYYY-MM-DD
function datesInRange(start, end) {
  const out = [];
  let d = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (d <= last) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}

// A request can MIX types across its days (e.g. 3 Vacation + 1 Floating in one
// stretch). dayTypes maps each date → type. Falls back to a single type for
// older records that predate mixed stretches.
function requestDayTypes(r) {
  if (r.dayTypes && Object.keys(r.dayTypes).length) return r.dayTypes;
  const out = {};
  datesInRange(r.startDate, r.endDate).forEach(d => { out[d] = r.type; });
  return out;
}

// Days drawn per pool for one request
function poolUsage(r) {
  const use = {};
  POOL_KEYS.forEach(k => { use[k] = 0; });
  Object.values(requestDayTypes(r)).forEach(t => {
    const pool = TIMEOFF_POOLS[t];
    if (pool) use[pool] += 1;
  });
  return use;
}

// ── Benefit years ──
// Vacation runs on the employee's ANNIVERSARY year (hire date → hire date).
// Sick/Personal and Floating Holidays run on the CALENDAR year (Jan 1 → Dec 31).
// So each person can have two different windows open at once.

function ymd(d) { return d.toISOString().slice(0, 10); }

// The anniversary window containing `ref`, based on hireDate.
// e.g. hired Mar 15; on Jul 13 2026 → Mar 15 2026 through Mar 14 2027.
function anniversaryWindow(hireDate, ref) {
  const h = new Date(hireDate + 'T00:00:00');
  if (isNaN(h)) return null;
  const y = ref.getFullYear();
  // This year's anniversary (clamped for Feb 29 hires in non-leap years)
  const anniv = new Date(y, h.getMonth(), h.getDate());
  if (anniv.getMonth() !== h.getMonth()) anniv.setDate(0); // rolled over → snap back
  let start, end;
  if (ref >= anniv) {
    start = anniv;
    end = new Date(y + 1, h.getMonth(), h.getDate());
  } else {
    start = new Date(y - 1, h.getMonth(), h.getDate());
    end = anniv;
  }
  end.setDate(end.getDate() - 1); // window is inclusive of the day before next anniversary
  return { start: ymd(start), end: ymd(end) };
}

function calendarWindow(ref) {
  const y = ref.getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

// Compute balances. Vacation is counted inside the anniversary window;
// sick/personal + floating inside the calendar year.
function computeBalances(requests, allotments, refDateStr) {
  const ref = refDateStr ? new Date(refDateStr + 'T00:00:00') : new Date();
  const calWin = calendarWindow(ref);

  const names = new Set(Object.keys(allotments));
  requests.forEach(r => names.add(r.employee));

  const out = {};
  names.forEach(name => {
    const cfg = allotments[name] || {};
    const allot = {};
    POOL_KEYS.forEach(k => {
      allot[k] = cfg[k] != null ? cfg[k] : DEFAULT_ALLOTMENT[k];
    });
    const hireDate = cfg.hireDate || null;
    // No hire date on file → fall back to calendar year for vacation too
    const vacWin = hireDate ? (anniversaryWindow(hireDate, ref) || calWin) : calWin;

    const used = {}, pending = {};
    POOL_KEYS.forEach(k => { used[k] = 0; pending[k] = 0; });
    // Bereavement has no bank — we just report how many days were taken
    let bereavementDays = 0;
    const bereavementDates = [];

    requests.filter(r => r.employee === name).forEach(r => {
      const bucket = r.status === 'Approved' ? used : (r.status === 'Pending' ? pending : null);
      if (!bucket) return;
      Object.entries(requestDayTypes(r)).forEach(([date, type]) => {
        if (type === 'Bereavement') {
          // Reported on the calendar year, and only once approved
          if (r.status === 'Approved' && date >= calWin.start && date <= calWin.end) {
            bereavementDays += 1;
            bereavementDates.push(date);
          }
          return;
        }
        const pool = TIMEOFF_POOLS[type];
        if (!pool) return;
        const win = pool === 'vacation' ? vacWin : calWin;
        if (date >= win.start && date <= win.end) bucket[pool] += 1;
      });
    });
    bereavementDates.sort();

    const remaining = {}, windows = {};
    POOL_KEYS.forEach(k => {
      remaining[k] = allot[k] - used[k];
      // Vacation runs on the anniversary year; everything else on the calendar year
      windows[k] = (k === 'vacation') ? vacWin : calWin;
    });

    out[name] = {
      allotment: allot,
      used, pending, remaining,
      hireDate,
      windows,
      vacationOnAnniversary: !!hireDate,
      bereavementDays,
      bereavementDates
    };
  });
  return out;
}

// ── Time Off email notifications ──
const TIMEOFF_ADMIN_EMAILS = (process.env.TIMEOFF_NOTIFY_EMAILS ||
  'mateusz.targosz@versantmedia.com,sean.fanning@versantmedia.com')
  .split(',').map(s => s.trim()).filter(Boolean);

function fmtDateLong(d) {
  const x = new Date(d + 'T00:00:00');
  if (isNaN(x)) return d;
  return x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Breakdown of a request's day types, e.g. "3 Vacation + 1 Floating Holiday"
function typeBreakdown(r) {
  const counts = {};
  Object.values(requestDayTypes(r)).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  return Object.entries(counts).map(([t, n]) => `${n} × ${t}`).join(' + ');
}

function timeOffEmailHtml(r, balances) {
  const sh = SHIFTS[r.shift] || {};
  const bal = balances && balances[r.employee];
  const range = r.startDate === r.endDate
    ? fmtDateLong(r.startDate)
    : `${fmtDateLong(r.startDate)} → ${fmtDateLong(r.endDate)}`;

  let balHtml = '';
  if (bal) {
    const rows = [
      ['Sick / Personal', bal.remaining.sickPersonal, bal.allotment.sickPersonal],
      ['Vacation', bal.remaining.vacation, bal.allotment.vacation],
      ['Floating Holidays', bal.remaining.floating, bal.allotment.floating]
    ].map(([label, rem, tot]) =>
      `<tr><td style="padding:5px 10px;font-size:13px;color:#5A6A7E;">${label}</td>
       <td style="padding:5px 10px;font-size:13px;font-weight:700;color:${rem <= 1 ? '#C62828' : '#1B3A5C'};text-align:right;">${rem} of ${tot} left</td></tr>`
    ).join('');
    balHtml = `<div style="margin-top:18px;">
      <div style="font-size:12px;font-weight:700;color:#5A6A7E;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;">Balance if approved is not yet applied</div>
      <table style="width:100%;border-collapse:collapse;background:#F8FAFC;border-radius:8px;">${rows}</table>
    </div>`;
  }

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:22px 16px;">
    <div style="background:linear-gradient(135deg,#1B3A5C,#2A5280);color:#fff;padding:20px;border-radius:12px 12px 0 0;">
      <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;opacity:.85;">HVAC Engineering — Local 68</div>
      <div style="font-size:21px;font-weight:800;margin-top:5px;">Time Off Request</div>
      <div style="font-size:13px;margin-top:3px;opacity:.9;">Awaiting your approval</div>
    </div>
    <div style="background:#fff;padding:22px;border-radius:0 0 12px 12px;border:1px solid #D4DCE8;border-top:none;">
      <div style="font-size:19px;font-weight:800;color:#1E2A3A;">${r.employee}</div>
      <div style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:11px;font-weight:700;padding:3px 9px;border-radius:5px;text-transform:uppercase;margin-top:7px;">Pending</div>

      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;letter-spacing:.5px;width:88px;">Dates</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#1E2A3A;">${range}</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;letter-spacing:.5px;">Days</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#1E2A3A;">${r.days} full day${r.days === 1 ? '' : 's'}</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;letter-spacing:.5px;">Type</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#1E2A3A;">${typeBreakdown(r)}</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;letter-spacing:.5px;">Shift</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#C62828;">${sh.label || r.shift} &nbsp;<span style="color:#5A6A7E;font-weight:500;">${sh.time || ''}</span></td></tr>
      </table>

      <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:11px;margin-top:14px;">
        <div style="font-size:12px;font-weight:700;color:#991B1B;">⚠ This shift will need coverage</div>
        <div style="font-size:12px;color:#5A6A7E;margin-top:3px;">Assign a covering tech when you approve.</div>
      </div>

      ${r.notes ? `<div style="margin-top:14px;padding:11px;background:#F8FAFC;border-radius:8px;">
        <div style="font-size:11px;font-weight:700;color:#8A96A8;text-transform:uppercase;letter-spacing:.5px;">Note from ${r.employee.split(' ')[0]}</div>
        <div style="font-size:14px;color:#1E2A3A;margin-top:4px;font-style:italic;">${escapeHtml(r.notes)}</div>
      </div>` : ''}

      ${balHtml}

      <a href="https://local68.up.railway.app/time-off/"
         style="display:block;text-align:center;background:#2979FF;color:#fff;text-decoration:none;padding:14px;border-radius:9px;font-weight:700;font-size:15px;margin-top:20px;">
        Review &amp; Approve →
      </a>
      <div style="font-size:11px;color:#8A96A8;text-align:center;margin-top:12px;">Request ${r.id}</div>
    </div>
  </div></body></html>`;
}

function decisionEmailHtml(r) {
  const approved = r.status === 'Approved';
  const sh = SHIFTS[r.shift] || {};
  const range = r.startDate === r.endDate
    ? fmtDateLong(r.startDate)
    : `${fmtDateLong(r.startDate)} → ${fmtDateLong(r.endDate)}`;
  const color = approved ? '#2E7D32' : '#C62828';
  const bg = approved ? '#E8F5E9' : '#FEE2E2';

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:22px 16px;">
    <div style="background:linear-gradient(135deg,#1B3A5C,#2A5280);color:#fff;padding:20px;border-radius:12px 12px 0 0;">
      <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;opacity:.85;">HVAC Engineering — Local 68</div>
      <div style="font-size:21px;font-weight:800;margin-top:5px;">Time Off ${approved ? 'Approved' : 'Denied'}</div>
    </div>
    <div style="background:#fff;padding:22px;border-radius:0 0 12px 12px;border:1px solid #D4DCE8;border-top:none;">
      <div style="background:${bg};border-radius:9px;padding:15px;text-align:center;">
        <div style="font-size:26px;">${approved ? '✅' : '❌'}</div>
        <div style="font-size:17px;font-weight:800;color:${color};margin-top:5px;">
          Your request was ${approved ? 'approved' : 'denied'}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;width:88px;">Dates</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#1E2A3A;">${range}</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;">Days</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#1E2A3A;">${r.days} day${r.days === 1 ? '' : 's'} — ${typeBreakdown(r)}</td></tr>
        <tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;">Shift</td>
            <td style="padding:7px 0;font-size:14px;font-weight:600;color:#1E2A3A;">${sh.label || r.shift} <span style="color:#5A6A7E;font-weight:500;">${sh.time || ''}</span></td></tr>
        ${approved && r.coveringTech ? `<tr><td style="padding:7px 0;font-size:12px;color:#8A96A8;text-transform:uppercase;">Covered by</td>
            <td style="padding:7px 0;font-size:14px;font-weight:700;color:#00897B;">🛡 ${escapeHtml(r.coveringTech)}</td></tr>` : ''}
      </table>
      ${approved && !r.coveringTech ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:11px;margin-top:14px;font-size:12px;color:#92400E;font-weight:600;">
        ⚠ A covering tech hasn't been assigned to this shift yet.</div>` : ''}
      <a href="https://local68.up.railway.app/time-off/"
         style="display:block;text-align:center;background:#1B3A5C;color:#fff;text-decoration:none;padding:13px;border-radius:9px;font-weight:700;font-size:14px;margin-top:20px;">
        View in Portal →
      </a>
      <div style="font-size:11px;color:#8A96A8;text-align:center;margin-top:12px;">Request ${r.id}</div>
    </div>
  </div></body></html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Look up an employee's email from the user list
async function emailForEmployee(displayName) {
  try {
    const d = await ghGet('data/pm_users.json');
    if (!d || !d.content) return null;
    const users = JSON.parse(d.content);
    const u = (Array.isArray(users) ? users : []).find(x => x.displayName === displayName);
    return u && u.email ? u.email : null;
  } catch { return null; }
}

// ── ADD AN ENGINEER ──
// Creates the login user AND their time-off allotment in one shot.
// The client hashes the temp password (same SHA-256 + salt the portal login uses),
// so a plaintext password never reaches the server.
app.post('/api/engineers', async (req, res) => {
  try {
    const {
      displayName, email, username, passwordHash, role, hireDate
    } = req.body;

    if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
    if (!passwordHash) return res.status(400).json({ error: 'Password is required' });
    if (hireDate && isNaN(new Date(hireDate + 'T00:00:00'))) {
      return res.status(400).json({ error: 'Invalid hire date' });
    }

    const uname = username.trim().toLowerCase();
    const name = displayName.trim();
    let conflict = null, created = null;

    await ghUpdateJson('data/pm_users.json', (users) => {
      const list = Array.isArray(users) ? users : [];
      if (list.some(u => (u.username || '').toLowerCase() === uname)) {
        conflict = 'That username is already taken';
        return null;
      }
      if (list.some(u => (u.displayName || '').toLowerCase() === name.toLowerCase())) {
        conflict = 'An engineer with that name already exists';
        return null;
      }
      created = {
        id: uname,
        username: uname,
        displayName: name,
        email: (email || '').trim(),
        role: role === 'admin' ? 'admin' : 'crew',
        passwordHash,
        createdAt: new Date().toISOString(),
        mustResetPw: true   // forced to set their own password on first login
      };
      return [...list, created];
    }, `Add engineer ${name}`, []);

    if (conflict) return res.status(409).json({ error: conflict });

    // Their time-off allotment + hire date
    await ghUpdateJson('data/time_off_allotments.json', (allotments) => {
      const entry = { hireDate: hireDate || null };
      POOL_KEYS.forEach(k => { entry[k] = Number(req.body[k]) || 0; });
      allotments[name] = entry;
      return allotments;
    }, `Set allotment for new engineer ${name}`, {});

    res.json({ success: true, engineer: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove an engineer (login + allotment). Their time-off history is kept.
app.delete('/api/engineers/:username', async (req, res) => {
  try {
    const uname = req.params.username.toLowerCase();
    let removed = null, notFound = false, isLastAdmin = false;

    await ghUpdateJson('data/pm_users.json', (users) => {
      const list = Array.isArray(users) ? users : [];
      const idx = list.findIndex(u => (u.username || '').toLowerCase() === uname);
      if (idx < 0) { notFound = true; return null; }
      // Never allow deleting the last admin — that would lock everyone out
      if (list[idx].role === 'admin' && list.filter(u => u.role === 'admin').length <= 1) {
        isLastAdmin = true;
        return null;
      }
      removed = list[idx];
      list.splice(idx, 1);
      return list;
    }, `Remove engineer ${uname}`, []);

    if (notFound) return res.status(404).json({ error: 'Engineer not found' });
    if (isLastAdmin) return res.status(400).json({ error: 'Cannot remove the last admin' });

    if (removed) {
      await ghUpdateJson('data/time_off_allotments.json', (allotments) => {
        delete allotments[removed.displayName];
        return allotments;
      }, `Remove allotment for ${removed.displayName}`, {});
    }
    res.json({ success: true, removed: removed && removed.displayName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List all requests + balances + recurring gaps + gap coverage assignments
app.get('/api/time-off', async (req, res) => {
  try {
    const [requests, allotments, gaps, gapAssignments, schedules] = await Promise.all([
      getTimeOff(), getAllotments(), getCoverageGaps(), getGapAssignments(), getSchedules()
    ]);
    // asOf lets you check balances at a given date; defaults to today
    const asOf = req.query.asOf || null;
    res.json({
      requests, allotments, gaps, gapAssignments, schedules,
      balances: computeBalances(requests, allotments, asOf),
      pools: TIMEOFF_POOLS, defaults: DEFAULT_ALLOTMENT, shifts: SHIFTS,
      types: TIMEOFF_TYPES, noPoolTypes: NO_POOL_TYPES,
      minStaff: MIN_STAFF
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Submit a request. Supports mixed types across the stretch via dayTypes:
//   { "2026-08-10": "Vacation", "2026-08-11": "Vacation", "2026-08-12": "Floating Holiday" }
app.post('/api/time-off', async (req, res) => {
  try {
    const r = req.body;
    if (!r.employee || !r.startDate || !r.endDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!r.shift || !SHIFTS[r.shift]) return res.status(400).json({ error: 'Invalid or missing shift' });

    const range = datesInRange(r.startDate, r.endDate);
    if (!range.length) return res.status(400).json({ error: 'Invalid date range' });

    // Build/validate dayTypes — every day in the range needs a valid type
    let dayTypes = {};
    if (r.dayTypes && Object.keys(r.dayTypes).length) {
      for (const d of range) {
        const t = r.dayTypes[d];
        if (!t || !isValidType(t)) return res.status(400).json({ error: `Missing or invalid type for ${d}` });
        dayTypes[d] = t;
      }
    } else {
      if (!r.type || !isValidType(r.type)) return res.status(400).json({ error: 'Invalid type' });
      range.forEach(d => { dayTypes[d] = r.type; });
    }
    // Summary type label: single type, or "Mixed"
    const distinct = [...new Set(Object.values(dayTypes))];
    const summaryType = distinct.length === 1 ? distinct[0] : 'Mixed';

    // Admin entering time off directly (e.g. logging from the calendar) lands
    // pre-approved — there's nobody left to approve it.
    const adminEntry = !!r.adminEntry;

    let saved = null;
    await ghUpdateJson('data/time_off.json', (requests) => {
      const year = new Date().getFullYear();
      const nums = requests.map(x => { const m = (x.id || '').match(/TO-\d+-(\d+)/); return m ? parseInt(m[1]) : 0; });
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      saved = {
        employee: r.employee,
        type: summaryType,
        dayTypes,
        shift: r.shift,
        startDate: r.startDate,
        endDate: r.endDate,
        notes: r.notes || '',
        id: `TO-${year}-${String(next).padStart(4, '0')}`,
        days: range.length,
        status: adminEntry ? 'Approved' : 'Pending',
        coveringTech: r.coveringTech || '',
        createdAt: new Date().toISOString()
      };
      if (adminEntry) {
        saved.enteredBy = r.enteredBy || 'Admin';
        saved.adminEntry = true;
      }
      return [saved, ...requests];
    }, `Time off ${adminEntry ? 'logged' : 'request'} — ${r.employee} (${r.shift} shift, ${range.length}d)`);

    // Notify admins on crew-submitted requests only — no point emailing an
    // admin about an entry they just made themselves
    if (RESEND_API_KEY && saved && !adminEntry) {
      try {
        const [allRequests, allotments] = await Promise.all([getTimeOff(), getAllotments()]);
        const balances = computeBalances(allRequests, allotments, null);
        const sh = SHIFTS[saved.shift] || {};
        await sendEmail({
          to: TIMEOFF_ADMIN_EMAILS,
          subject: `Time Off Request — ${saved.employee}, ${saved.days} day${saved.days === 1 ? '' : 's'} (${sh.label || saved.shift})`,
          html: timeOffEmailHtml(saved, balances)
        });
        console.log(`Time off email sent to admins for ${saved.id}`);
      } catch (e) {
        console.error('Time off notification email failed:', e.message);
      }
    }

    res.json({ success: true, request: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update a request (approve/deny, assign coverage)
app.put('/api/time-off/:id', async (req, res) => {
  try {
    let updated = null, notFound = false, prevStatus = null;
    await ghUpdateJson('data/time_off.json', (requests) => {
      const idx = requests.findIndex(x => x.id === req.params.id);
      if (idx < 0) { notFound = true; return null; }
      prevStatus = requests[idx].status;
      const patch = { ...req.body };
      delete patch.id; delete patch.createdAt; delete patch.employee;
      if (patch.startDate || patch.endDate) {
        patch.days = countDays(patch.startDate || requests[idx].startDate, patch.endDate || requests[idx].endDate);
      }
      requests[idx] = { ...requests[idx], ...patch, updatedAt: new Date().toISOString() };
      updated = requests[idx];
      return requests;
    }, `Update time off ${req.params.id}`);
    if (notFound) return res.status(404).json({ error: 'Request not found' });

    // Tell the engineer when the decision actually changes
    const statusChanged = updated && updated.status !== prevStatus &&
      (updated.status === 'Approved' || updated.status === 'Denied');
    if (RESEND_API_KEY && statusChanged) {
      try {
        const to = await emailForEmployee(updated.employee);
        if (to) {
          await sendEmail({
            to,
            subject: `Time Off ${updated.status} — ${fmtDateLong(updated.startDate)}`,
            html: decisionEmailHtml(updated)
          });
          console.log(`Decision email sent to ${updated.employee} for ${updated.id}`);
        } else {
          console.log(`No email on file for ${updated.employee} — skipped decision email`);
        }
      } catch (e) {
        console.error('Decision email failed:', e.message);
      }
    }

    res.json({ success: true, request: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a request
app.delete('/api/time-off/:id', async (req, res) => {
  try {
    let notFound = false;
    await ghUpdateJson('data/time_off.json', (requests) => {
      const idx = requests.findIndex(x => x.id === req.params.id);
      if (idx < 0) { notFound = true; return null; }
      requests.splice(idx, 1);
      return requests;
    }, `Delete time off ${req.params.id}`);
    if (notFound) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set a person's annual allotment + hire date (admin)
app.post('/api/time-off-allotments', async (req, res) => {
  try {
    const { employee, hireDate } = req.body;
    if (!employee) return res.status(400).json({ error: 'Missing employee' });
    if (hireDate && isNaN(new Date(hireDate + 'T00:00:00'))) {
      return res.status(400).json({ error: 'Invalid hire date' });
    }
    let result = null;
    await ghUpdateJson('data/time_off_allotments.json', (allotments) => {
      const entry = { hireDate: hireDate || null };
      POOL_KEYS.forEach(k => { entry[k] = Number(req.body[k]) || 0; });
      allotments[employee] = entry;
      result = allotments;
      return allotments;
    }, `Set allotment + hire date for ${employee}`, {});
    res.json({ success: true, allotments: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RECURRING COVERAGE GAPS ──
// A shift that's short every week regardless of time off (not enough guys on site).
// Repeats weekly with no end date until removed. Coverage is picked per date.

// Create a standing gap: { weekday: 0-6 (Sun=0), shift: '1st'|'2nd'|'3rd', note }
app.post('/api/coverage-gaps', async (req, res) => {
  try {
    const { weekday, shift, note } = req.body;
    const wd = Number(weekday);
    if (!(wd >= 0 && wd <= 6)) return res.status(400).json({ error: 'Invalid weekday' });
    if (!shift || !SHIFTS[shift]) return res.status(400).json({ error: 'Invalid shift' });
    let saved = null;
    await ghUpdateJson('data/coverage_gaps.json', (gaps) => {
      if (gaps.some(g => g.weekday === wd && g.shift === shift)) {
        saved = 'duplicate';
        return null;
      }
      const nums = gaps.map(g => { const m = (g.id || '').match(/RG-(\d+)/); return m ? parseInt(m[1]) : 0; });
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      saved = { id: `RG-${next}`, weekday: wd, shift, note: note || '', createdAt: new Date().toISOString() };
      return [...gaps, saved];
    }, `Add recurring coverage gap — ${shift} shift`);
    if (saved === 'duplicate') return res.status(409).json({ error: 'That weekday + shift is already tracked' });
    res.json({ success: true, gap: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove a standing gap (also clears its coverage assignments)
app.delete('/api/coverage-gaps/:id', async (req, res) => {
  try {
    let notFound = false;
    await ghUpdateJson('data/coverage_gaps.json', (gaps) => {
      const idx = gaps.findIndex(g => g.id === req.params.id);
      if (idx < 0) { notFound = true; return null; }
      gaps.splice(idx, 1);
      return gaps;
    }, `Remove recurring coverage gap ${req.params.id}`);
    if (notFound) return res.status(404).json({ error: 'Gap not found' });
    // Clean up any coverage assigned to this gap
    await ghUpdateJson('data/coverage_assignments.json', (assigns) => {
      Object.keys(assigns).forEach(k => { if (k.startsWith(req.params.id + '|')) delete assigns[k]; });
      return assigns;
    }, `Clear assignments for ${req.params.id}`, {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set an engineer's regular weekly schedule
// body: { employee, shifts: {"1":"1st","2":"1st",...}, coverageExempt, private }
app.post('/api/schedules', async (req, res) => {
  try {
    const { employee, shifts, coverageExempt, isPrivate } = req.body;
    if (!employee) return res.status(400).json({ error: 'Missing employee' });
    const clean = {};
    Object.entries(shifts || {}).forEach(([wd, sh]) => {
      const w = Number(wd);
      if (w >= 0 && w <= 6 && SHIFTS[sh]) clean[w] = sh;
    });
    let result = null;
    await ghUpdateJson('data/schedules.json', (all) => {
      all[employee] = {
        shifts: clean,
        coverageExempt: !!coverageExempt,
        private: !!isPrivate
      };
      result = all[employee];
      return all;
    }, `Set work schedule for ${employee}`, {});
    res.json({ success: true, schedule: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assign who covers a short shift on a given date.
// Key is "<YYYY-MM-DD>|<shift>", value is a list of covering techs.
app.post('/api/coverage-assign', async (req, res) => {
  try {
    const { date, shift, techs } = req.body;
    if (!date || !shift) return res.status(400).json({ error: 'Missing date or shift' });
    if (!SHIFTS[shift]) return res.status(400).json({ error: 'Invalid shift' });
    const key = `${date}|${shift}`;
    const list = (Array.isArray(techs) ? techs : [techs]).filter(Boolean);
    await ghUpdateJson('data/coverage_assignments.json', (assigns) => {
      if (list.length) assigns[key] = list; else delete assigns[key];
      return assigns;
    }, list.length ? `Coverage for ${key}: ${list.join(', ')}` : `Clear coverage for ${key}`, {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// ── SLACK INTEGRATION — auto-create work orders from Slack messages ──
// ═══════════════════════════════════════════
// Setup:
// 1. Create a Slack app at https://api.slack.com/apps
// 2. Add Bot Token Scopes: channels:history, channels:read, chat:write (optional)
// 3. Enable Event Subscriptions, Request URL: https://local68.up.railway.app/api/slack/events
// 4. Subscribe to bot event: message.channels
// 5. (Optional) Add Slash Command /wo with Request URL: https://local68.up.railway.app/api/slack/command
// 6. Install to workspace, invite bot to the channel(s) you want monitored
// 7. Set Railway env vars: SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN (optional), SLACK_ALLOWED_CHANNELS (optional)

function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) return false;
  const sig = req.header('X-Slack-Signature');
  const ts = req.header('X-Slack-Request-Timestamp');
  if (!sig || !ts || !req.rawBody) return false;
  // Reject if older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) return false;
  const basestring = `v0:${ts}:${req.rawBody.toString('utf8')}`;
  const computed = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(basestring).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig)); }
  catch { return false; }
}

// Parse a Slack message into a work order. Smart-detects location, type, priority.
function parseSlackMessage(text, user) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const lower = t.toLowerCase();

  // Location detection
  let location = 'Other';
  if (/\b904\b/.test(t) || /904\s*sylvan/i.test(t)) location = '904 Sylvan Ave';
  else if (/\b900\b/.test(t) || /900\s*sylvan/i.test(t)) location = '900 Sylvan Ave';

  // Type detection
  let type = 'Cold Call';
  if (/\bemergency\b/i.test(t)) type = 'Emergency';
  else if (/\brepair\b/i.test(t)) type = 'Repair';
  else if (/\bpm\b|preventive maintenance/i.test(t)) type = 'Preventive Maintenance';
  else if (/\binstall(ation)?\b/i.test(t)) type = 'Installation';
  else if (/\binspect(ion)?\b/i.test(t)) type = 'Inspection';

  // Priority detection
  let priority = 'Normal';
  if (/\b(urgent|asap|critical|emergency|down)\b/i.test(t)) priority = 'Urgent';
  else if (/\bhigh\b/i.test(t) || /priority/i.test(t)) priority = 'High';
  else if (/\blow\b|whenever|no rush/i.test(t)) priority = 'Low';

  // Title — strip leading directives like "WO:", "Work Order:", "@bot" mentions
  let title = t
    .replace(/^(wo|work order|create wo|new wo)[\s:.-]+/i, '')
    .replace(/<@[A-Z0-9]+>/g, '')   // strip user mentions
    .replace(/<#[A-Z0-9]+\|[^>]+>/g, '') // strip channel mentions
    .trim();
  if (!title) title = 'Work order from Slack';
  if (title.length > 100) title = title.slice(0, 97) + '…';

  return { title, location, type, priority, status: 'Open', details: t, createdBy: user || 'Slack' };
}

// Optional: post message back to Slack
async function postToSlack(channel, text, threadTs) {
  if (!SLACK_BOT_TOKEN || !channel) return null;
  try {
    const body = { channel, text };
    if (threadTs) body.thread_ts = threadTs;
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body)
    });
    return await resp.json();
  } catch (e) { console.error('postToSlack error:', e); return null; }
}

// Dedup cache (event IDs already processed) — keep last 500 in memory
const recentSlackEvents = [];
function alreadyProcessed(eventId) {
  if (!eventId) return false;
  if (recentSlackEvents.includes(eventId)) return true;
  recentSlackEvents.push(eventId);
  if (recentSlackEvents.length > 500) recentSlackEvents.shift();
  return false;
}

// ── Slack Events API webhook ──
app.post('/api/slack/events', async (req, res) => {
  const body = req.body || {};

  // Slack URL verification handshake — must respond fast with challenge value
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }

  // Verify signature
  if (!verifySlackSignature(req)) {
    console.warn('Slack signature verification failed');
    return res.status(401).send('Invalid signature');
  }

  // Dedup
  if (alreadyProcessed(body.event_id)) return res.status(200).send('ok');

  // Acknowledge immediately (Slack requires <3s response)
  res.status(200).send('ok');

  // Process asynchronously
  if (body.type !== 'event_callback' || !body.event) return;
  const event = body.event;

  // Only handle real user messages (not edits, bot messages, threaded replies optionally)
  if (event.type !== 'message') return;
  if (event.subtype && event.subtype !== 'file_share') return;
  if (event.bot_id) return;
  if (!event.text || !event.text.trim()) return;

  // Channel filter
  if (SLACK_ALLOWED_CHANNELS.length && !SLACK_ALLOWED_CHANNELS.includes(event.channel)) {
    console.log(`Slack message in unmonitored channel ${event.channel} — ignored`);
    return;
  }

  // Trigger keyword check (any keyword in message OR if bot is mentioned)
  const lower = event.text.toLowerCase();
  const isMentioned = lower.includes('<@') && body.authorizations && body.authorizations[0] && lower.includes('<@' + body.authorizations[0].user_id.toLowerCase());
  const hasKeyword = SLACK_TRIGGER_KEYWORDS.some(k => k && lower.includes(k));
  if (!hasKeyword && !isMentioned && SLACK_ALLOWED_CHANNELS.length === 0) {
    // No channel filter AND no trigger — too broad, skip
    return;
  }

  try {
    // Parse and create work order
    const wo = parseSlackMessage(event.text, event.user ? `Slack:${event.user}` : 'Slack');
    const orders = await getWorkOrders();
    const year = new Date().getFullYear();
    const existingNums = orders.map(o => {
      const m = (o.woNumber || '').match(/WO-\d+-(\d+)/);
      return m ? parseInt(m[1]) : 0;
    });
    const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1;
    wo.woNumber = `WO-${year}-${String(nextNum).padStart(4, '0')}`;
    wo.id = wo.woNumber;
    wo.createdAt = new Date().toISOString();
    wo.visits = [];
    wo.source = 'slack';
    wo.slackChannel = event.channel;
    wo.slackTs = event.ts;
    orders.unshift(wo);
    await ghPut('data/work_orders.json', JSON.stringify(orders, null, 2), `Slack → ${wo.woNumber}`);
    console.log(`Created ${wo.woNumber} from Slack message`);

    // Reply in Slack with confirmation (if bot token configured)
    await postToSlack(event.channel, `✅ Created *${wo.woNumber}* — _${wo.title}_\n• Location: ${wo.location}  • Type: ${wo.type}  • Priority: ${wo.priority}\n<https://local68.up.railway.app/work-orders/|View in Work Orders>`, event.ts);
  } catch (e) {
    console.error('Slack → WO error:', e);
    await postToSlack(event.channel, `⚠️ Couldn't create work order: ${e.message}`, event.ts);
  }
});

// ── Optional: Slash command `/wo <description>` ──
app.post('/api/slack/command', async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send('Invalid signature');
  }
  const text = req.body.text || '';
  if (!text.trim()) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/wo <description>` — e.g. `/wo AC not cooling in studio B at 900 Sylvan urgent`' });
  }
  try {
    const wo = parseSlackMessage(text, req.body.user_name ? `Slack:${req.body.user_name}` : 'Slack');
    const orders = await getWorkOrders();
    const year = new Date().getFullYear();
    const existingNums = orders.map(o => { const m = (o.woNumber||'').match(/WO-\d+-(\d+)/); return m ? parseInt(m[1]) : 0; });
    const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1;
    wo.woNumber = `WO-${year}-${String(nextNum).padStart(4, '0')}`;
    wo.id = wo.woNumber;
    wo.createdAt = new Date().toISOString();
    wo.visits = [];
    wo.source = 'slack-slash';
    orders.unshift(wo);
    await ghPut('data/work_orders.json', JSON.stringify(orders, null, 2), `Slack /wo → ${wo.woNumber}`);
    res.json({
      response_type: 'in_channel',
      text: `✅ Created *${wo.woNumber}* — _${wo.title}_\n• Location: ${wo.location}  • Type: ${wo.type}  • Priority: ${wo.priority}\n<https://local68.up.railway.app/work-orders/|View in Work Orders>`
    });
  } catch (e) {
    res.json({ response_type: 'ephemeral', text: `⚠️ Couldn't create work order: ${e.message}` });
  }
});

// Status endpoint — check if Slack integration is configured (for admin debugging)
app.get('/api/slack/status', (req, res) => {
  res.json({
    signing_secret_configured: !!SLACK_SIGNING_SECRET,
    bot_token_configured: !!SLACK_BOT_TOKEN,
    allowed_channels: SLACK_ALLOWED_CHANNELS,
    trigger_keywords: SLACK_TRIGGER_KEYWORDS
  });
});

// ═══════════════════════════════════════════
// ── CLOUDFLARE R2 PHOTO STORAGE ──
// ═══════════════════════════════════════════
// Uploads photos to R2 if configured, else echoes back the data URL (fallback).
// Client sends: { dataUrl, folder?, filename? }
// Server returns: { url, uploaded } — url is either R2 https URL or the original data URL

app.post('/api/upload-photo', async (req, res) => {
  const { dataUrl, folder, filename } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Missing dataUrl' });
  }

  // If R2 not configured, return the data URL unchanged (graceful fallback)
  if (!R2_CONFIGURED || !r2Client) {
    return res.json({ url: dataUrl, uploaded: false, reason: 'R2 not configured' });
  }

  try {
    // Parse data URL: data:image/jpeg;base64,<...>
    const match = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid data URL format' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');

    // Generate unique key
    const safeFolder = (folder || 'photos').replace(/[^a-zA-Z0-9/_-]/g, '');
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    const safeFilename = (filename || '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
    const key = `${safeFolder}/${ts}-${rand}${safeFilename ? '-' + safeFilename : ''}.${ext}`;

    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buf,
      ContentType: `image/${match[1]}`,
      CacheControl: 'public, max-age=31536000, immutable'
    }));

    const url = `${R2_PUBLIC_URL}/${key}`;
    res.json({ url, uploaded: true, key, sizeBytes: buf.length });
  } catch (e) {
    console.error('R2 upload error:', e);
    // Fall back to data URL so the user doesn't lose their photo
    res.json({ url: dataUrl, uploaded: false, reason: 'Upload failed: ' + e.message });
  }
});

// R2 status endpoint — for diagnostics
app.get('/api/r2-status', (req, res) => {
  res.json({
    configured: R2_CONFIGURED,
    account_id_set: !!R2_ACCOUNT_ID,
    access_key_set: !!R2_ACCESS_KEY_ID,
    secret_key_set: !!R2_SECRET_ACCESS_KEY,
    bucket_name: R2_BUCKET_NAME || null,
    public_url: R2_PUBLIC_URL || null
  });
});

// Photo proxy — fetches an image URL server-side and returns it as a base64 data URL.
// Needed because R2 public URLs don't send CORS headers, so the browser can't fetch
// them directly when building PDFs. Only allows fetching from the configured R2 bucket.
app.get('/api/fetch-photo', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });
    // Security: only proxy images from our own R2 public URL
    if (R2_PUBLIC_URL && !url.startsWith(R2_PUBLIC_URL)) {
      return res.status(403).json({ error: 'URL not allowed' });
    }
    const resp = await fetch(url);
    if (!resp.ok) return res.status(502).json({ error: 'Fetch failed: ' + resp.status });
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const arrayBuf = await resp.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString('base64');
    res.json({ dataUrl: `data:${contentType};base64,${base64}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve static files — no cache for HTML to always get latest
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('/') || !req.path.includes('.')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname)));

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`HVAC Portal running on port ${PORT}`));
