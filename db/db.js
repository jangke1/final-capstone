import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'my.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone_number TEXT NOT NULL DEFAULT '',
    role TEXT DEFAULT 'staff',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );

  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    phone_number TEXT NOT NULL DEFAULT '',
    assigned_user_id INTEGER,
    install_date TEXT DEFAULT CURRENT_DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    user_name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'Success'
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    material TEXT NOT NULL,
    fullness_percent REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_resolved INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS waste_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    waste_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    notes TEXT
  );
`);

const unitColumns = db.pragma('table_info(units)');
if (!unitColumns.some((column) => column.name === 'phone_number')) {
  db.exec("ALTER TABLE units ADD COLUMN phone_number TEXT NOT NULL DEFAULT ''");
}
if (!unitColumns.some((column) => column.name === 'assigned_user_id')) {
  db.exec('ALTER TABLE units ADD COLUMN assigned_user_id INTEGER');
}

const userColumns = db.pragma('table_info(users)');
if (!userColumns.some((column) => column.name === 'phone_number')) {
  db.exec("ALTER TABLE users ADD COLUMN phone_number TEXT NOT NULL DEFAULT ''");
}

const adminEmail = 'admin@example.com';
const checkAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);

if (!checkAdmin) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)');
  insertUser.run('Admin', adminEmail, hashedPassword, 'admin');
  console.log(`Default admin created -> Email: ${adminEmail} | Password: admin123 | Role: admin`);
}

db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('sms_notifications', '0')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('alert_threshold', '85')").run();

db.prepare(`
  INSERT OR IGNORE INTO units (unit_id, name, location, status, install_date)
  VALUES
    ('UNIT-001', 'Segregation Unit 1', 'Pancho Hall - Floor 1', 'Active', '2026-01-15'),
    ('UNIT-002', 'Segregation Unit 2', 'Pancho Hall - Floor 2', 'Active', '2026-01-15'),
    ('UNIT-003', 'Segregation Unit 3', 'Pancho Hall - Floor 3', 'Active', '2026-01-15'),
    ('UNIT-004', 'Segregation Unit 4', 'CBEA Building - Floor 1', 'Active', '2026-01-15'),
    ('UNIT-005', 'Segregation Unit 5', 'CBEA Building - Floor 2', 'Active', '2026-01-15'),
    ('UNIT-006', 'Segregation Unit 6', 'CBEA Building - Floor 3', 'Active', '2026-01-15')
`).run();

export default db;
