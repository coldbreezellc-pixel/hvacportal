const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_OWNER = "coldbreezellc-pixel";
const GH_REPO = "hvacportal";
const GH_BRANCH = "main";

// ── Gmail SMTP setup ──
const GMAIL_USER = process.env.GMAIL_USER || "coldbreezellc@gmail.com";
const GMAIL_APP_PW = process.env.GMAIL_APP_PW;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PW }
});

app.use(express.json({ limit: '10mb' }));

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

// ── PM WORK ORDER BACKUP ──
app.post('/api/backup-pm', async (req, res) => {
  try {
    const { technician, facility, equipment, frequency, pdfData } = req.body;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dateStr = (now.getMonth()+1) + '-' + now.getDate() + '-' + now.getFullYear();
    const techName = (technician || 'unknown').replace(/[^a-zA-Z0-9,. ]/g, '').replace(/\s+/g, '_');

    // Save PM report metadata
    const metadata = JSON.stringify({
      technician, facility, equipment, frequency,
      date: now.toISOString(),
      dateFormatted: dateStr
    }, null, 2);

    const backupName = `PM_${techName}_${ts}`;
    await ghPut(`backups/pm/${dateStr}/${backupName}.json`, metadata, `PM Work Order — ${technician} — ${facility} — ${dateStr}`);

    res.json({ success: true, backup: backupName });
  } catch (e) {
    console.error('PM Backup error:', e);
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
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.7;">HVAC Portal — Versant Media</p>
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

    await transporter.sendMail({
      from: `"HVAC Portal" <${GMAIL_USER}>`,
      to: recipients.join(', '),
      subject: `🔐 Password Reset — ${displayName} (${username})`,
      html
    });

    console.log(`Reset email sent for ${username} to ${recipients.join(', ')}`);
    res.json({ success: true, sentTo: recipients });
  } catch (e) {
    console.error('Email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// General email sending (for PM reports, inventory reports)
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, body, html } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' });

    await transporter.sendMail({
      from: `"HVAC Portal" <${GMAIL_USER}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text: body || '',
      html: html || ''
    });

    res.json({ success: true });
  } catch (e) {
    console.error('Email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Serve static files from repo root
app.use(express.static(path.join(__dirname)));

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`HVAC Portal running on port ${PORT}`));
