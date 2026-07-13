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
async function ghPut(filePath, content, message) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;
  let sha = null;
  try {
    const check = await fetch(url + "?ref=" + GH_BRANCH, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (check.ok) { const d = await check.json(); sha = d.sha; }
  } catch {}
  const body = { message, content: Buffer.from(content).toString('base64'), branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const resp = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`GitHub PUT failed: ${resp.status}`);
  return await resp.json();
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
const TIMEOFF_POOLS = {
  'Sick': 'sickPersonal',
  'Personal': 'sickPersonal',
  'Vacation': 'vacation',
  'Floating Holiday': 'floating'
};
const DEFAULT_ALLOTMENT = { sickPersonal: 12, vacation: 10, floating: 3 };

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

// Count weekdays-inclusive full days between two dates
function countDays(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

// Compute balances for everyone: allotment - approved days used (current year)
function computeBalances(requests, allotments, year) {
  const used = {};
  requests.forEach(r => {
    if (r.status !== 'Approved') return;
    if (new Date(r.startDate).getFullYear() !== year) return;
    const pool = TIMEOFF_POOLS[r.type];
    if (!pool) return;
    if (!used[r.employee]) used[r.employee] = { sickPersonal: 0, vacation: 0, floating: 0 };
    used[r.employee][pool] += (r.days || 0);
  });
  const pending = {};
  requests.forEach(r => {
    if (r.status !== 'Pending') return;
    if (new Date(r.startDate).getFullYear() !== year) return;
    const pool = TIMEOFF_POOLS[r.type];
    if (!pool) return;
    if (!pending[r.employee]) pending[r.employee] = { sickPersonal: 0, vacation: 0, floating: 0 };
    pending[r.employee][pool] += (r.days || 0);
  });
  const out = {};
  const names = new Set([...Object.keys(allotments), ...Object.keys(used), ...Object.keys(pending)]);
  names.forEach(name => {
    const allot = { ...DEFAULT_ALLOTMENT, ...(allotments[name] || {}) };
    const u = used[name] || { sickPersonal: 0, vacation: 0, floating: 0 };
    const p = pending[name] || { sickPersonal: 0, vacation: 0, floating: 0 };
    out[name] = {
      allotment: allot,
      used: u,
      pending: p,
      remaining: {
        sickPersonal: allot.sickPersonal - u.sickPersonal,
        vacation: allot.vacation - u.vacation,
        floating: allot.floating - u.floating
      }
    };
  });
  return out;
}

// List all requests + balances
app.get('/api/time-off', async (req, res) => {
  try {
    const requests = await getTimeOff();
    const allotments = await getAllotments();
    const year = parseInt(req.query.year) || new Date().getFullYear();
    res.json({ requests, allotments, balances: computeBalances(requests, allotments, year), pools: TIMEOFF_POOLS, defaults: DEFAULT_ALLOTMENT });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Submit a request
app.post('/api/time-off', async (req, res) => {
  try {
    const requests = await getTimeOff();
    const r = req.body;
    if (!r.employee || !r.type || !r.startDate || !r.endDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!TIMEOFF_POOLS[r.type]) return res.status(400).json({ error: 'Invalid type' });
    const year = new Date().getFullYear();
    const nums = requests.map(x => { const m = (x.id || '').match(/TO-\d+-(\d+)/); return m ? parseInt(m[1]) : 0; });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    r.id = `TO-${year}-${String(next).padStart(4, '0')}`;
    r.days = countDays(r.startDate, r.endDate);
    r.status = 'Pending';
    r.coveringTech = r.coveringTech || '';
    r.createdAt = new Date().toISOString();
    requests.unshift(r);
    await ghPut('data/time_off.json', JSON.stringify(requests, null, 2), `Time off request ${r.id} — ${r.employee}`);
    res.json({ success: true, request: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update a request (approve/deny, assign coverage)
app.put('/api/time-off/:id', async (req, res) => {
  try {
    const requests = await getTimeOff();
    const idx = requests.findIndex(x => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Request not found' });
    const patch = { ...req.body };
    delete patch.id; delete patch.createdAt; delete patch.employee;
    if (patch.startDate || patch.endDate) {
      patch.days = countDays(patch.startDate || requests[idx].startDate, patch.endDate || requests[idx].endDate);
    }
    requests[idx] = { ...requests[idx], ...patch, updatedAt: new Date().toISOString() };
    await ghPut('data/time_off.json', JSON.stringify(requests, null, 2), `Update time off ${requests[idx].id} → ${requests[idx].status}`);
    res.json({ success: true, request: requests[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a request
app.delete('/api/time-off/:id', async (req, res) => {
  try {
    const requests = await getTimeOff();
    const idx = requests.findIndex(x => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Request not found' });
    const removed = requests.splice(idx, 1)[0];
    await ghPut('data/time_off.json', JSON.stringify(requests, null, 2), `Delete time off ${removed.id}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set a person's annual allotment (admin)
app.post('/api/time-off-allotments', async (req, res) => {
  try {
    const allotments = await getAllotments();
    const { employee, sickPersonal, vacation, floating } = req.body;
    if (!employee) return res.status(400).json({ error: 'Missing employee' });
    allotments[employee] = {
      sickPersonal: Number(sickPersonal) || 0,
      vacation: Number(vacation) || 0,
      floating: Number(floating) || 0
    };
    await ghPut('data/time_off_allotments.json', JSON.stringify(allotments, null, 2), `Set allotment for ${employee}`);
    res.json({ success: true, allotments });
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
