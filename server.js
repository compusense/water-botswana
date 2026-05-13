const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========================================
// DATABASE SETUP
// ========================================
const db = new sqlite3.Database('./waterbot.db');

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        meter_number TEXT,
        name TEXT,
        area TEXT,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME,
        is_blocked BOOLEAN DEFAULT 0
    )`);

    // Fault reports table
    db.run(`CREATE TABLE IF NOT EXISTS faults (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        fault_type TEXT,
        description TEXT,
        latitude REAL,
        longitude REAL,
        photo_url TEXT,
        status TEXT DEFAULT 'pending',
        reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        technician TEXT
    )`);

    // Broadcasts table
    db.run(`CREATE TABLE IF NOT EXISTS broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT,
        target_area TEXT,
        scheduled_for DATETIME,
        sent_at DATETIME,
        status TEXT DEFAULT 'pending',
        recipient_count INTEGER
    )`);

    // Meter readings table
    db.run(`CREATE TABLE IF NOT EXISTS meter_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        meter_number TEXT,
        reading REAL,
        photo_url TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved BOOLEAN DEFAULT 0
    )`);

    // Messages log
    db.run(`CREATE TABLE IF NOT EXISTS messages_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        direction TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========================================
// API ENDPOINTS
// ========================================

// Dashboard stats
app.get('/api/stats', (req, res) => {
    const stats = {};
    
    db.get(`SELECT COUNT(*) as total FROM users`, (err, row) => {
        stats.totalUsers = row.total;
        
        db.get(`SELECT COUNT(*) as pending FROM faults WHERE status = 'pending'`, (err, row) => {
            stats.pendingFaults = row.pending;
            
            db.get(`SELECT COUNT(*) as today FROM messages_log WHERE date(created_at) = date('now')`, (err, row) => {
                stats.todayMessages = row.today;
                
                db.get(`SELECT COUNT(*) as month FROM users WHERE datetime(registered_at) >= datetime('now', '-30 days')`, (err, row) => {
                    stats.newUsersMonth = row.month;
                    res.json(stats);
                });
            });
        });
    });
});

// Get all users
app.get('/api/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY registered_at DESC`, (err, rows) => {
        res.json(rows);
    });
});

// Get faults with location
app.get('/api/faults', (req, res) => {
    db.all(`SELECT * FROM faults ORDER BY reported_at DESC`, (err, rows) => {
        res.json(rows);
    });
});

// Update fault status
app.post('/api/faults/:id/status', (req, res) => {
    const { status, technician } = req.body;
    db.run(`UPDATE faults SET status = ?, technician = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        [status, technician, req.params.id], 
        (err) => {
            if (err) res.json({ error: err.message });
            else res.json({ success: true });
        });
});

// Send broadcast
app.post('/api/broadcast', (req, res) => {
    const { message, targetArea, scheduledFor } = req.body;
    
    let query = `SELECT phone FROM users WHERE is_blocked = 0`;
    if (targetArea && targetArea !== 'all') {
        query += ` AND area = '${targetArea}'`;
    }
    
    db.all(query, (err, users) => {
        if (err) {
            res.json({ error: err.message });
            return;
        }
        
        db.run(`INSERT INTO broadcasts (message, target_area, scheduled_for, status, recipient_count) 
                VALUES (?, ?, ?, 'pending', ?)`,
            [message, targetArea || 'all', scheduledFor || new Date().toISOString(), users.length],
            (err) => {
                if (err) res.json({ error: err.message });
                else res.json({ success: true, recipients: users.length });
            });
    });
});

// Get broadcasts history
app.get('/api/broadcasts', (req, res) => {
    db.all(`SELECT * FROM broadcasts ORDER BY scheduled_for DESC`, (err, rows) => {
        res.json(rows);
    });
});

// Get meter readings
app.get('/api/readings', (req, res) => {
    db.all(`SELECT * FROM meter_readings ORDER BY submitted_at DESC`, (err, rows) => {
        res.json(rows);
    });
});

// Approve meter reading
app.post('/api/readings/:id/approve', (req, res) => {
    db.run(`UPDATE meter_readings SET approved = 1 WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.json({ error: err.message });
        else res.json({ success: true });
    });
});

// Get analytics data
app.get('/api/analytics', (req, res) => {
    const analytics = {};
    
    // Messages by day (last 7 days)
    db.all(`SELECT date(created_at) as day, COUNT(*) as count 
            FROM messages_log 
            WHERE created_at >= datetime('now', '-7 days')
            GROUP BY date(created_at)`, (err, rows) => {
        analytics.messagesByDay = rows;
        
        // Fault types distribution
        db.all(`SELECT fault_type, COUNT(*) as count FROM faults GROUP BY fault_type`, (err, rows) => {
            analytics.faultTypes = rows;
            res.json(analytics);
        });
    });
});

// Mock: Store incoming WhatsApp data (call this from your bot webhook)
app.post('/api/ingest', (req, res) => {
    const { phone, message, direction, meterNumber, faultData, readingData } = req.body;
    
    // Store message
    db.run(`INSERT INTO messages_log (user_phone, direction, message) VALUES (?, ?, ?)`,
        [phone, direction, message]);
    
    // Update or create user
    db.run(`INSERT INTO users (phone, meter_number, last_active) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(phone) DO UPDATE SET 
            last_active = CURRENT_TIMESTAMP,
            meter_number = COALESCE(?, meter_number)`,
        [phone, meterNumber, meterNumber]);
    
    // Store fault if provided
    if (faultData) {
        db.run(`INSERT INTO faults (user_phone, fault_type, description, latitude, longitude) 
                VALUES (?, ?, ?, ?, ?)`,
            [phone, faultData.type, faultData.description, faultData.lat, faultData.lng]);
    }
    
    // Store reading if provided
    if (readingData) {
        db.run(`INSERT INTO meter_readings (user_phone, meter_number, reading) 
                VALUES (?, ?, ?)`,
            [phone, readingData.meter, readingData.value]);
    }
    
    res.json({ success: true });
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`📊 Dashboard running on http://localhost:${PORT}`);
    console.log(`🔗 Visit: http://localhost:${PORT}/dashboard`);
});
