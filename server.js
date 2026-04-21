const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const GH_TOKEN = process.env.GH_TOKEN;
const GH_OWNER = "coldbreezellc-pixel";
const GH_REPO = "hvacportal";
const GH_BRANCH = "main";

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

// Serve static files from repo root
app.use(express.static(path.join(__dirname)));

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`HVAC Portal running on port ${PORT}`));
