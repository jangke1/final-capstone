import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import mqtt from 'mqtt';
import db from './db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_KEY = process.env.JWT_SECRET || 'your_super_secret_key';
const PORT = process.env.PORT || 3000;

const VIEWS_DIR = path.join(__dirname, 'public', 'views');
const view = (...segments) => path.join(VIEWS_DIR, ...segments);

const app = express();
const MQTT_SETTINGS_ROOT = 'wasteSegregation';
const primaryUnit = db.prepare('SELECT unit_id FROM units ORDER BY id ASC LIMIT 1').get();
const PRIMARY_UNIT_ID = process.env.EMQX_UNIT_ID || primaryUnit?.unit_id || 'UNIT-001';
const MQTT_TOPIC = process.env.EMQX_TOPIC || `${MQTT_SETTINGS_ROOT}/${PRIMARY_UNIT_ID}/bins`;
const binReadingClients = new Set();
let latestBinReadings = null;
let mqttConnected = false;
const activeBinAlerts = new Set();

const mqttClient = mqtt.connect(
  process.env.EMQX_BROKER_URL || 'mqtts://nb119f60.ala.asia-southeast1.emqxsl.com:8883',
  {
    clientId: `waste-dashboard-${Math.random().toString(16).slice(2, 10)}`,
    username: process.env.EMQX_USERNAME,
    password: process.env.EMQX_PASSWORD,
    reconnectPeriod: 5000,
  }
);

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
  return String(value);
}

function logSystemEvent({
  type = 'Info',
  user = 'System',
  description = '',
  status = 'Success',
} = {}) {
  db.prepare(
    'INSERT INTO logs (event_type, user_name, description, status) VALUES (?, ?, ?, ?)'
  ).run(type, user, description, status);
}

function isValidUnitId(unitId) {
  return typeof unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(unitId);
}

function isValidPhoneNumber(phoneNumber) {
  return typeof phoneNumber === 'string' && /^\+[1-9]\d{7,14}$/.test(phoneNumber);
}

function publishRetainedSetting(topic, payload, label) {
  if (!mqttConnected || !mqttClient.connected) {
    return false;
  }

  mqttClient.publish(topic, payload, { qos: 0, retain: true }, (error) => {
    if (error) {
      console.error(`[MQTT] ${label} setting publish failed:`, error.message);
    }
  });
  return true;
}

function publishSmsPreference(enabled) {
  return publishRetainedSetting(
    `${MQTT_SETTINGS_ROOT}/settings/sms`,
    enabled ? '1' : '0',
    'SMS preference'
  );
}

function publishAlertThreshold(threshold) {
  return publishRetainedSetting(
    `${MQTT_SETTINGS_ROOT}/settings/alertThreshold`,
    String(threshold),
    'Alert threshold'
  );
}

function unitPhoneTopic(unitId) {
  return `${MQTT_SETTINGS_ROOT}/${unitId}/settings/phone`;
}

function publishUnitPhoneNumber(unitId, phoneNumber) {
  return publishRetainedSetting(unitPhoneTopic(unitId), phoneNumber, 'Assigned user phone');
}

function getAssignedUserPhone(unitId) {
  const row = db.prepare(
    `SELECT users.phone_number
     FROM units
     LEFT JOIN users ON users.id = units.assigned_user_id
     WHERE units.unit_id = ?`
  ).get(unitId);
  return row?.phone_number || '';
}

function publishAllAlertSettings() {
  const smsEnabled = getSetting('sms_notifications', '0') === '1' || getSetting('sms_notifications', '0') === 'true';
  publishSmsPreference(smsEnabled);
  publishAlertThreshold(getSetting('alert_threshold', '85'));

  const units = db.prepare('SELECT unit_id FROM units').all();
  for (const unit of units) {
    publishUnitPhoneNumber(unit.unit_id, getAssignedUserPhone(unit.unit_id));
  }
}

function isValidAssignedUserId(assignedUserId) {
  return assignedUserId === '' || assignedUserId === null ||
    (Number.isInteger(Number(assignedUserId)) && Number(assignedUserId) > 0);
}

function getAssignedUser(assignedUserId) {
  if (assignedUserId === null) {
    return null;
  }

  const user = db.prepare('SELECT id, phone_number FROM users WHERE id = ?').get(assignedUserId);
  if (!user) {
    return null;
  }
  if (!isValidPhoneNumber(user.phone_number)) {
    return undefined;
  }
  return user;
}

function getAlertThreshold() {
  const threshold = Number(getSetting('alert_threshold', '85'));
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 100 ? threshold : 85;
}

function broadcastBrokerStatus() {
  const event = `event: broker-status\ndata: ${JSON.stringify({ connected: mqttConnected })}\n\n`;
  for (const response of binReadingClients) {
    response.write(event);
  }
}

function normalizeBinReadings(payload) {
  const binKeys = ['paper', 'plastic', 'metal', 'others'];
  if (payload?.device !== PRIMARY_UNIT_ID || !payload.bins || typeof payload.bins !== 'object') {
    return null;
  }

  const bins = {};
  for (const key of binKeys) {
    const reading = payload.bins[key];
    if (!reading || typeof reading.valid !== 'boolean') {
      return null;
    }
    if (reading.valid && (
      !Number.isFinite(reading.distanceCm) ||
      !Number.isFinite(reading.fullnessPercent) ||
      reading.fullnessPercent < 0 ||
      reading.fullnessPercent > 100
    )) {
      return null;
    }
    bins[key] = reading.valid
      ? { valid: true, distanceCm: reading.distanceCm, fullnessPercent: reading.fullnessPercent }
      : { valid: false, distanceCm: null, fullnessPercent: null };
  }

  return {
    device: payload.device,
    updatedAt: Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now(),
    bins,
  };
}

function recordBinThresholdAlerts(readings) {
  const threshold = getAlertThreshold();
  const unit = db.prepare('SELECT name, location FROM units WHERE unit_id = ?').get(readings.device);

  for (const [material, reading] of Object.entries(readings.bins)) {
    const alertKey = `${readings.device}:${material}`;
    if (!reading.valid || reading.fullnessPercent < threshold) {
      activeBinAlerts.delete(alertKey);
      db.prepare(
        'UPDATE notifications SET is_resolved = 1 WHERE unit_id = ? AND material = ? AND is_resolved = 0'
      ).run(readings.device, material);
      continue;
    }

    if (activeBinAlerts.has(alertKey)) {
      continue;
    }

    activeBinAlerts.add(alertKey);
    const existing = db.prepare(
      'SELECT id FROM notifications WHERE unit_id = ? AND material = ? AND is_resolved = 0 LIMIT 1'
    ).get(readings.device, material);
    if (existing) {
      continue;
    }

    db.prepare(
      'INSERT INTO notifications (unit_id, title, location, material, fullness_percent) VALUES (?, ?, ?, ?, ?)'
    ).run(
      readings.device,
      unit?.name || readings.device,
      unit?.location || 'Unknown location',
      material,
      reading.fullnessPercent
    );
  }
}

mqttClient.on('connect', () => {
  mqttConnected = false;
  broadcastBrokerStatus();
  mqttClient.subscribe(MQTT_TOPIC, { qos: 0 }, (error) => {
    if (error) {
      mqttConnected = false;
      broadcastBrokerStatus();
      console.error('[MQTT] Subscribe failed:', error.message);
    } else {
      mqttConnected = true;
      broadcastBrokerStatus();
      console.log(`[MQTT] Subscribed to ${MQTT_TOPIC}`);
      publishAllAlertSettings();
    }
  });
});

mqttClient.on('message', (topic, message) => {
  if (topic !== MQTT_TOPIC) {
    return;
  }

  try {
    const readings = normalizeBinReadings(JSON.parse(message.toString()));
    if (!readings) {
      console.warn('[MQTT] Ignored invalid bin readings payload');
      return;
    }

    latestBinReadings = readings;
    recordBinThresholdAlerts(readings);
    console.log(`[MQTT] Received valid bin readings from ${readings.device} on ${topic}`);
    const event = `event: bin-readings\ndata: ${JSON.stringify(readings)}\n\n`;
    for (const response of binReadingClients) {
      response.write(event);
    }
  } catch (error) {
    console.error('[MQTT] Could not parse bin readings:', error.message);
  }
});

mqttClient.on('close', () => {
  mqttConnected = false;
  broadcastBrokerStatus();
});

mqttClient.on('error', (error) => {
  console.error('[MQTT] Broker connection error:', error.message);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

function authenticateToken(req, res, next) {
  const token = req.cookies.authToken;

  if (!token) {
    return res.redirect('/login');
  }

  try {
    req.user = jwt.verify(token, SECRET_KEY);
    next();
  } catch (error) {
    res.clearCookie('authToken');
    return res.redirect('/login');
  }
}

function requireRole(isAllowed) {
  return (req, res, next) => {
    if (req.user && !isAllowed(req.user.role)) {
      return res.status(404).sendFile(view('404.html'));
    }
    next();
  };
}

const requireAdminRole = requireRole((role) => role === 'admin');
const requireStaffRole = requireRole((role) => role !== 'admin');

function requireCurrentPassword(req, res, next) {
  const { currentPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'Your password is required to confirm this change' });
  }

  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Your password is incorrect' });
  }

  next();
}

const dashboardRedirectFor = (role) => (role === 'admin' ? '/admin/dashboard' : '/staff/dashboard');

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  const token = req.cookies.authToken;

  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      return res.redirect(dashboardRedirectFor(decoded.role));
    } catch {
      res.clearCookie('authToken');
    }
  }

  res.sendFile(view('login.html'));
});

app.get('/404', (req, res) => {
  res.sendFile(view('404.html'));
});

app.get('/logout', (req, res) => {
  try {
    const token = req.cookies.authToken;
    if (token) {
      const user = jwt.verify(token, SECRET_KEY);
      logSystemEvent({
        type: 'User Logout',
        user: user.email || 'System',
        description: `${user.email || 'User'} signed out`,
      });
    }
  } catch (error) {
    console.warn('[LOGOUT] Could not record sign-out:', error.message);
  }
  res.clearCookie('authToken');
  res.redirect('/login');
});

app.get('/api/bin-readings/events', authenticateToken, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: broker-status\ndata: ${JSON.stringify({ connected: mqttConnected })}\n\n`);
  if (latestBinReadings) {
    res.write(`event: bin-readings\ndata: ${JSON.stringify(latestBinReadings)}\n\n`);
  }

  binReadingClients.add(res);
  req.on('close', () => binReadingClients.delete(res));
});

app.get('/admin/dashboard', authenticateToken, requireAdminRole, (req, res) => {
  res.sendFile(view('admin', 'dashboard.html'));
});

app.get('/admin/panel', authenticateToken, requireAdminRole, (req, res) => {
  res.sendFile(view('admin', 'panel.html'));
});

app.get('/staff/dashboard', authenticateToken, requireStaffRole, (req, res) => {
  res.sendFile(view('staff', 'dashboard.html'));
});

app.get('/api/users', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, username, email, phone_number, role, created_at, last_login FROM users').all();
    const users = rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      phoneNumber: row.phone_number,
      role: row.role,
      created: row.created_at,
      lastLogin: row.last_login,
    }));
    res.json(users);
  } catch (error) {
    console.error('[API/USERS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/units', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT units.id, units.unit_id, units.name, units.location, units.status, units.install_date,
              units.assigned_user_id, users.username AS assigned_user_name, users.email AS assigned_user_email
       FROM units
       LEFT JOIN users ON users.id = units.assigned_user_id
       ORDER BY units.id ASC`
    ).all();
    res.json(rows.map((row) => ({
      id: row.id,
      unitId: row.unit_id,
      name: row.name,
      location: row.location,
      status: row.status,
      installDate: row.install_date,
      assignedUserId: row.assigned_user_id,
      assignedUserName: row.assigned_user_name,
      assignedUserEmail: row.assigned_user_email,
    })));
  } catch (error) {
    console.error('[API/UNITS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/units', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const { unitId, name, location, assignedUserId = '', status = 'Active' } = req.body;

  if (!isValidUnitId(unitId) || !name || !location) {
    return res.status(400).json({ error: 'A valid unit ID, name, and location are required' });
  }
  if (!isValidAssignedUserId(assignedUserId)) {
    return res.status(400).json({ error: 'Select a valid assigned user' });
  }

  try {
    const existing = db.prepare('SELECT id FROM units WHERE unit_id = ?').get(unitId);
    if (existing) {
      return res.status(409).json({ error: 'A unit with that ID already exists' });
    }

    const assignedUser = assignedUserId === '' ? null : Number(assignedUserId);
    const assignedUserRecord = assignedUser === null ? null : getAssignedUser(assignedUser);
    if (assignedUser !== null && assignedUserRecord === undefined) {
      return res.status(400).json({ error: 'The assigned user must have a valid phone number' });
    }
    if (assignedUser !== null && !assignedUserRecord) {
      return res.status(400).json({ error: 'Assigned user not found' });
    }
    db.prepare(
      'INSERT INTO units (unit_id, name, location, status, assigned_user_id, install_date) VALUES (?, ?, ?, ?, ?, CURRENT_DATE)'
    ).run(unitId, name, location, status, assignedUser);
    publishUnitPhoneNumber(unitId, getAssignedUserPhone(unitId));

    logSystemEvent({
      type: 'Unit Added',
      user: req.user?.email || 'System',
      description: `Added unit ${unitId} (${name})`,
      status: 'Success',
    });

    res.status(201).json({ message: 'Unit created successfully' });
  } catch (error) {
    console.error('[API/UNITS] Error creating unit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/units/:id', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const { id } = req.params;
  const { unitId, name, location, status, assignedUserId = '' } = req.body;

  if (!isValidUnitId(unitId) || !name || !location || !status) {
    return res.status(400).json({ error: 'A valid unit ID, name, location, and status are required' });
  }
  if (!isValidAssignedUserId(assignedUserId)) {
    return res.status(400).json({ error: 'Select a valid assigned user' });
  }

  try {
    const currentUnit = db.prepare('SELECT id, unit_id FROM units WHERE id = ?').get(Number(id));
    if (!currentUnit) {
      return res.status(404).json({ error: 'Unit not found' });
    }
    const existing = db.prepare('SELECT id FROM units WHERE unit_id = ? AND id != ?').get(unitId, Number(id));
    if (existing) {
      return res.status(409).json({ error: 'A unit with that ID already exists' });
    }

    const assignedUser = assignedUserId === '' ? null : Number(assignedUserId);
    const assignedUserRecord = assignedUser === null ? null : getAssignedUser(assignedUser);
    if (assignedUser !== null && assignedUserRecord === undefined) {
      return res.status(400).json({ error: 'The assigned user must have a valid phone number' });
    }
    if (assignedUser !== null && !assignedUserRecord) {
      return res.status(400).json({ error: 'Assigned user not found' });
    }
    db.prepare('UPDATE units SET unit_id = ?, name = ?, location = ?, status = ?, assigned_user_id = ? WHERE id = ?')
      .run(unitId, name, location, status, assignedUser, Number(id));

    if (currentUnit.unit_id !== unitId) {
      publishUnitPhoneNumber(currentUnit.unit_id, '');
    }
    publishUnitPhoneNumber(unitId, getAssignedUserPhone(unitId));

    logSystemEvent({
      type: 'Unit Updated',
      user: req.user?.email || 'System',
      description: `Updated unit ${unitId}`,
      status: 'Success',
    });

    res.json({ message: 'Unit updated successfully' });
  } catch (error) {
    console.error('[API/UNITS] Error updating unit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/units/:id', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const { id } = req.params;

  try {
    const unit = db.prepare('SELECT unit_id FROM units WHERE id = ?').get(Number(id));
    const result = db.prepare('DELETE FROM units WHERE id = ?').run(Number(id));

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Unit not found' });
    }
    if (unit) {
      publishUnitPhoneNumber(unit.unit_id, '');
    }

    logSystemEvent({
      type: 'Unit Deleted',
      user: req.user?.email || 'System',
      description: `Removed unit ${unit?.unit_id || id}`,
      status: 'Success',
    });

    res.json({ message: 'Unit deleted successfully' });
  } catch (error) {
    console.error('[API/UNITS] Error deleting unit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/logs', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, timestamp, event_type, user_name, description, status FROM logs ORDER BY id DESC LIMIT 50').all();
    res.json(rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      type: row.event_type,
      user: row.user_name,
      description: row.description,
      status: row.status,
    })));
  } catch (error) {
    console.error('[API/LOGS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logs', authenticateToken, (req, res) => {
  const { type, description } = req.body;
  const allowedEvents = new Set(['Report Generated', 'Report Printed']);
  if (!allowedEvents.has(type) || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Invalid log event' });
  }

  try {
    logSystemEvent({ type, user: req.user.email, description: description.trim().slice(0, 240) });
    res.status(201).json({ message: 'Log recorded' });
  } catch (error) {
    console.error('[API/LOGS] Error creating log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/settings', (req, res) => {
  const smsEnabled = getSetting('sms_notifications', '0') === '1' || getSetting('sms_notifications', '0') === 'true';
  const alertThreshold = Number(getSetting('alert_threshold', '85'));
  res.json({ smsEnabled, alertThreshold });
});

app.put('/api/settings/alert-threshold', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const alertThreshold = Number(req.body?.alertThreshold);
  if (!Number.isInteger(alertThreshold) || alertThreshold < 0 || alertThreshold > 100) {
    return res.status(400).json({ error: 'Alert threshold must be a whole number from 0 to 100' });
  }

  setSetting('alert_threshold', alertThreshold);
  publishAlertThreshold(alertThreshold);
  logSystemEvent({
    type: 'Settings Updated',
    user: req.user?.email || 'System',
    description: `Alert threshold set to ${alertThreshold}%`,
    status: 'Success',
  });
  res.json({ alertThreshold });
});

app.put('/api/settings/sms', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const { enabled } = req.body;
  const nextState = Boolean(enabled);
  setSetting('sms_notifications', nextState ? '1' : '0');
  publishSmsPreference(nextState);
  logSystemEvent({
    type: 'Settings Updated',
    user: req.user?.email || 'System',
    description: `SMS notifications ${nextState ? 'enabled' : 'disabled'}`,
    status: 'Success',
  });
  res.json({ enabled: nextState });
});

app.get('/api/notifications', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, unit_id, title, location, material, fullness_percent, created_at FROM notifications WHERE is_resolved = 0 ORDER BY id DESC'
    ).all();
    res.json(rows.map((row) => ({
      id: row.id,
      title: row.title,
      unit: row.unit_id,
      location: row.location,
      material: row.material,
      label: row.fullness_percent >= 90 ? 'FULL' : 'ALERT',
      time: row.created_at,
      fullness: row.fullness_percent,
    })));
  } catch (error) {
    console.error('[API/NOTIFICATIONS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/notifications', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const { unit, title, location, material, fullness } = req.body;

  if (!unit || !title || !location || !material || !Number.isFinite(Number(fullness))) {
    return res.status(400).json({ error: 'Incomplete notification payload' });
  }

  try {
    db.prepare(
      'INSERT INTO notifications (unit_id, title, location, material, fullness_percent) VALUES (?, ?, ?, ?, ?)'
    ).run(unit, title, location, material, Number(fullness));
    logSystemEvent({
      type: 'Notification Created',
      user: req.user.email,
      description: `Created ${material} alert for ${unit}`,
    });
    res.status(201).json({ message: 'Notification added' });
  } catch (error) {
    console.error('[API/NOTIFICATIONS] Error creating notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/notifications/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const notification = db.prepare('SELECT unit_id, material FROM notifications WHERE id = ? AND is_resolved = 0').get(Number(id));
  const result = db.prepare('UPDATE notifications SET is_resolved = 1 WHERE id = ? AND is_resolved = 0').run(Number(id));

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  logSystemEvent({
    type: 'Notification Cleared',
    user: req.user.email,
    description: `Cleared ${notification.material} alert for ${notification.unit_id}`,
  });
  res.json({ message: 'Notification cleared' });
});

app.get('/api/reports', authenticateToken, (req, res) => {
  try {
    const rows = db.prepare('SELECT waste_type, quantity, recorded_at FROM waste_reports ORDER BY recorded_at DESC LIMIT 7').all();

    const merged = {};
    for (const row of rows) {
      const label = row.waste_type;
      const dateKey = new Date(row.recorded_at).toISOString().slice(0, 10);
      merged[dateKey] ??= { date: dateKey, plastic_bottles: 0, plastics: 0, papers: 0 };
      if (label === 'Plastic Bottles') merged[dateKey].plastic_bottles += Number(row.quantity) || 0;
      if (label === 'Plastics') merged[dateKey].plastics += Number(row.quantity) || 0;
      if (label === 'Papers') merged[dateKey].papers += Number(row.quantity) || 0;
    }

    const timeline = Object.values(merged).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
    if (timeline.length === 0) {
      const sample = [
        { date: '2026-07-10', plastic_bottles: 88, plastics: 92, papers: 74 },
        { date: '2026-07-11', plastic_bottles: 91, plastics: 87, papers: 81 },
        { date: '2026-07-12', plastic_bottles: 96, plastics: 84, papers: 78 },
        { date: '2026-07-13', plastic_bottles: 94, plastics: 90, papers: 83 },
        { date: '2026-07-14', plastic_bottles: 101, plastics: 88, papers: 90 },
        { date: '2026-07-15', plastic_bottles: 99, plastics: 85, papers: 86 },
        { date: '2026-07-16', plastic_bottles: 108, plastics: 93, papers: 89 },
      ];
      return res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          plasticBottles: 487,
          plastics: 423,
          papers: 465,
          compartmentsEmptied: 42,
        },
        timeline: sample,
      });
    }

    const totalPlasticBottles = timeline.reduce((sum, item) => sum + (Number(item.plastic_bottles) || 0), 0);
    const totalPlastics = timeline.reduce((sum, item) => sum + (Number(item.plastics) || 0), 0);
    const totalPapers = timeline.reduce((sum, item) => sum + (Number(item.papers) || 0), 0);

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        plasticBottles: totalPlasticBottles,
        plastics: totalPlastics,
        papers: totalPapers,
        compartmentsEmptied: timeline.length * 6,
      },
      timeline,
    });
  } catch (error) {
    console.error('[API/REPORTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/users/:id', authenticateToken, requireAdminRole, requireCurrentPassword, (req, res) => {
  const { id } = req.params;

  try {
    if (Number(id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const deletedUser = db.prepare('SELECT username, email FROM users WHERE id = ?').get(id);
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const assignedUnits = db.prepare('SELECT unit_id FROM units WHERE assigned_user_id = ?').all(id);
    db.prepare('UPDATE units SET assigned_user_id = NULL WHERE assigned_user_id = ?').run(id);
    for (const unit of assignedUnits) {
      publishUnitPhoneNumber(unit.unit_id, '');
    }

    logSystemEvent({
      type: 'User Deleted',
      user: req.user.email,
      description: `Deleted account ${deletedUser?.username || deletedUser?.email || id}`,
    });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('[API/USERS] Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/users/:id', authenticateToken, requireAdminRole, requireCurrentPassword, async (req, res) => {
  const { id } = req.params;
  const { username, email, password, phoneNumber = '', role } = req.body;

  try {
    if (!username || !email || !role) {
      return res.status(400).json({ error: 'Username, email, and role are required' });
    }

    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: 'Enter a valid phone number in international format, such as +639123456789' });
    }

    const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id);
    if (emailTaken) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      db.prepare('UPDATE users SET username = ?, email = ?, phone_number = ?, password = ?, role = ? WHERE id = ?')
        .run(username, email, phoneNumber, hashedPassword, role, id);
    } else {
      db.prepare('UPDATE users SET username = ?, email = ?, phone_number = ?, role = ? WHERE id = ?')
        .run(username, email, phoneNumber, role, id);
    }
    const assignedUnits = db.prepare('SELECT unit_id FROM units WHERE assigned_user_id = ?').all(id);
    for (const unit of assignedUnits) {
      publishUnitPhoneNumber(unit.unit_id, phoneNumber);
    }

    logSystemEvent({
      type: 'User Updated',
      user: req.user.email,
      description: `Updated account ${username} (${email})`,
    });
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('[API/USERS] Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/users', authenticateToken, requireAdminRole, requireCurrentPassword, async (req, res) => {
  const { username, email, password, phoneNumber = '', role } = req.body;

  try {
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (role && role !== 'staff') {
      return res.status(400).json({ error: 'New accounts must have the staff role' });
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: 'Enter a valid phone number in international format, such as +639123456789' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.prepare(
      `INSERT INTO users (username, email, password, phone_number, role, created_at, last_login)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)`
    ).run(username, email, hashedPassword, phoneNumber, 'staff');

    logSystemEvent({
      type: 'User Created',
      user: req.user.email,
      description: `Created staff account ${username} (${email})`,
    });
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('[API/USERS] Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/status', (req, res) => {
  const token = req.cookies.authToken;
  if (!token) {
    return res.json({ loggedIn: false });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const user = db.prepare('SELECT username, email, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      res.clearCookie('authToken');
      return res.json({ loggedIn: false });
    }

    res.json({
      loggedIn: true,
      redirect: dashboardRedirectFor(user.role),
      role: user.role,
      id: decoded.id,
      email: user.email,
      username: user.username,
    });
  } catch {
    res.clearCookie('authToken');
    res.json({ loggedIn: false });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password, remember } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    logSystemEvent({
      type: 'User Login',
      user: user.email,
      description: `${user.username || user.email} logged in`,
      status: 'Success',
    });

    const expiresIn = remember ? '7d' : '2h';
    const maxAge = remember ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      SECRET_KEY,
      { expiresIn }
    );

    res.cookie('authToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
    });

    const redirectUrl = dashboardRedirectFor(user.role);

    res.json({ message: 'Login successful', redirect: redirectUrl });
  } catch (error) {
    console.error('[LOGIN] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use(express.static(VIEWS_DIR, { extensions: ['html'] }));

app.use((req, res) => {
  res.status(404).sendFile(view('404.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running smoothly on port ${PORT}`);
});
