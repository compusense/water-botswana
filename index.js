require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

// ========================================
// DASHBOARD SERVER (Port 3001)
// ========================================
const dashboardApp = express();
dashboardApp.use(cors());
dashboardApp.use(express.json());
dashboardApp.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./waterbot.db');

db.serialize(() => {
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

    db.run(`CREATE TABLE IF NOT EXISTS broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT,
        target_area TEXT,
        scheduled_for DATETIME,
        sent_at DATETIME,
        status TEXT DEFAULT 'pending',
        recipient_count INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS meter_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        meter_number TEXT,
        reading REAL,
        photo_url TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved BOOLEAN DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        direction TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Dashboard API endpoints
dashboardApp.get('/api/stats', (req, res) => {
    const stats = {};
    db.get(`SELECT COUNT(*) as total FROM users`, (err, row) => {
        stats.totalUsers = row ? row.total : 0;
        db.get(`SELECT COUNT(*) as pending FROM faults WHERE status = 'pending'`, (err, row) => {
            stats.pendingFaults = row ? row.pending : 0;
            db.get(`SELECT COUNT(*) as today FROM messages_log WHERE date(created_at) = date('now')`, (err, row) => {
                stats.todayMessages = row ? row.today : 0;
                db.get(`SELECT COUNT(*) as month FROM users WHERE datetime(registered_at) >= datetime('now', '-30 days')`, (err, row) => {
                    stats.newUsersMonth = row ? row.month : 0;
                    res.json(stats);
                });
            });
        });
    });
});

dashboardApp.get('/api/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY registered_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

dashboardApp.get('/api/faults', (req, res) => {
    db.all(`SELECT * FROM faults ORDER BY reported_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

dashboardApp.post('/api/faults/:id/status', (req, res) => {
    const { status, technician } = req.body;
    db.run(`UPDATE faults SET status = ?, technician = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        [status, technician, req.params.id], (err) => {
            res.json({ success: !err });
        });
});

dashboardApp.post('/api/broadcast', (req, res) => {
    const { message, targetArea, scheduledFor } = req.body;
    let query = `SELECT phone FROM users WHERE is_blocked = 0`;
    if (targetArea && targetArea !== 'all') query += ` AND area = '${targetArea}'`;
    
    db.all(query, (err, users) => {
        db.run(`INSERT INTO broadcasts (message, target_area, scheduled_for, status, recipient_count) 
                VALUES (?, ?, ?, 'pending', ?)`,
            [message, targetArea || 'all', scheduledFor || new Date().toISOString(), users ? users.length : 0],
            (err) => {
                res.json({ success: !err, recipients: users ? users.length : 0 });
            });
    });
});

dashboardApp.get('/api/broadcasts', (req, res) => {
    db.all(`SELECT * FROM broadcasts ORDER BY scheduled_for DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

dashboardApp.get('/api/readings', (req, res) => {
    db.all(`SELECT * FROM meter_readings ORDER BY submitted_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

dashboardApp.post('/api/readings/:id/approve', (req, res) => {
    db.run(`UPDATE meter_readings SET approved = 1 WHERE id = ?`, [req.params.id], (err) => {
        res.json({ success: !err });
    });
});

dashboardApp.get('/api/analytics', (req, res) => {
    db.all(`SELECT date(created_at) as day, COUNT(*) as count 
            FROM messages_log WHERE created_at >= datetime('now', '-7 days')
            GROUP BY date(created_at)`, (err, rows) => {
        const messagesByDay = rows || [];
        db.all(`SELECT fault_type, COUNT(*) as count FROM faults GROUP BY fault_type`, (err, rows) => {
            res.json({ messagesByDay, faultTypes: rows || [] });
        });
    });
});

dashboardApp.post('/api/ingest', (req, res) => {
    const { phone, message, direction, meterNumber, faultData, readingData } = req.body;
    
    if (message) {
        db.run(`INSERT INTO messages_log (user_phone, direction, message) VALUES (?, ?, ?)`,
            [phone, direction, message]);
    }
    
    db.run(`INSERT INTO users (phone, meter_number, last_active) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(phone) DO UPDATE SET last_active = CURRENT_TIMESTAMP,
            meter_number = COALESCE(?, meter_number)`,
        [phone, meterNumber, meterNumber]);
    
    if (faultData) {
        db.run(`INSERT INTO faults (user_phone, fault_type, description, latitude, longitude) 
                VALUES (?, ?, ?, ?, ?)`,
            [phone, faultData.type, faultData.description, faultData.lat, faultData.lng]);
    }
    
    if (readingData) {
        db.run(`INSERT INTO meter_readings (user_phone, meter_number, reading) 
                VALUES (?, ?, ?)`,
            [phone, readingData.meter, readingData.value]);
    }
    
    res.json({ success: true });
});

dashboardApp.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

dashboardApp.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start dashboard on port 3001
const DASHBOARD_PORT = 3001;
dashboardApp.listen(DASHBOARD_PORT, () => {
    console.log(`📊 Dashboard running on port ${DASHBOARD_PORT}`);
});

// ========================================
// WHATSAPP BOT SERVER (Port 3000)
// ========================================
const botApp = express();
botApp.use(express.json());

const sessions = {};
const accounts = {
    'GBE-00412': { name: 'Kefilwe Moyo', balance: 247.50, address: 'Gaborone West', area: 'Gaborone' },
    'GBE-00891': { name: 'Thabo Sithole', balance: 0, address: 'Gaborone North', area: 'Gaborone' },
    'FTB-00234': { name: 'Mpho Nkwe', balance: 512.00, address: 'Francistown', area: 'Francistown' },
    'LBE-00123': { name: 'Botswana Water Corp', balance: 189.50, address: 'Lobatse', area: 'Lobatse' }
};

async function sendMessage(to, text) {
    try {
        const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
        await axios.post(url, {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: text }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Send error:', error.response?.data || error.message);
        return false;
    }
}

async function sendToDashboard(phone, message, direction, meterNumber = null, faultData = null) {
    try {
        await axios.post(`http://localhost:${DASHBOARD_PORT}/api/ingest`, {
            phone, message, direction, meterNumber, faultData
        });
    } catch(error) {
        console.log('Dashboard ingest failed');
    }
}

async function handleMessage(from, message, msgType, mediaInfo = null) {
    if (!sessions[from]) sessions[from] = { step: 'menu', meter: null };
    const session = sessions[from];
    
    let text = '';
    if (msgType === 'text') text = message?.body?.toLowerCase().trim() || '';
    
    await sendToDashboard(from, text, 'incoming', session.meter);
    
    if (text === 'hi' || text === 'menu') {
        await sendMessage(from, `💧 WATER UTILITY BOTSWANA\n\n1️⃣ Balance\n2️⃣ Pay Bill\n3️⃣ Meter Reading\n4️⃣ Report Fault\n\nReply with number or command.`);
        return;
    }
    
    if (text === '1' || text === 'balance') {
        if (session.meter) {
            const acc = accounts[session.meter];
            await sendMessage(from, `💰 Balance: P${acc.balance}\nDue: End of month`);
        } else {
            await sendMessage(from, `Enter meter number (e.g., GBE-00412):`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    if (session.step === 'awaiting_meter') {
        const meter = text.toUpperCase();
        const account = accounts[meter];
        if (account) {
            session.meter = meter;
            session.step = 'menu';
            await sendMessage(from, `✅ Account found!\nMeter: ${meter}\nName: ${account.name}\nBalance: P${account.balance}`);
        } else {
            await sendMessage(from, `❌ Meter "${meter}" not found.\nTry: GBE-00412`);
        }
        return;
    }
    
    if (text === '4' || text === 'fault') {
        await sendMessage(from, `Describe the problem:`);
        session.step = 'awaiting_fault';
        return;
    }
    
    if (session.step === 'awaiting_fault') {
        await sendToDashboard(from, text, 'incoming', session.meter, {
            type: 'Reported Issue',
            description: text,
            lat: mediaInfo?.latitude,
            lng: mediaInfo?.longitude
        });
        await sendMessage(from, `✅ Fault reported! Reference: ${Date.now().toString().slice(-8)}\nTechnician will be dispatched.`);
        session.step = 'menu';
        return;
    }
    
    await sendMessage(from, `Type "menu" for options`);
}

botApp.get('/webhook', (req, res) => {
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (token === process.env.VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

botApp.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object === 'whatsapp_business_account') {
            const msg = body.entry[0].changes[0].value.messages?.[0];
            if (msg && msg.type === 'text') {
                await handleMessage(msg.from, msg.text, 'text');
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error(error);
        res.sendStatus(200);
    }
});

botApp.get('/', (req, res) => {
    res.json({ status: 'running', service: 'Botswana Water Bot' });
});

const BOT_PORT = 3000;
botApp.listen(BOT_PORT, () => {
    console.log(`🤖 WhatsApp Bot running on port ${BOT_PORT}`);
});

console.log(`✅ Both services started successfully!`);
