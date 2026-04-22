const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_OWNER = "coldbreezellc-pixel";
const GH_REPO = "hvacportal";
const GH_BRANCH = "main";

// ── Resend Email API (HTTPS, no SMTP port issues) ──
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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

app.use(express.json({ limit: '25mb' }));

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
