require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

// ========================================
// DATABASE SETUP
// ========================================
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
    
    // Insert sample data for testing
    db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO users (phone, meter_number, name, area) VALUES 
                ('26771234567', 'GBE-00412', 'Kefilwe Moyo', 'Gaborone'),
                ('26772345678', 'FTB-00234', 'Mpho Nkwe', 'Francistown')`);
            
            db.run(`INSERT INTO faults (user_phone, fault_type, description, latitude, longitude, status) VALUES 
                ('26771234567', 'Burst Pipe', 'Water gushing from main pipe', -24.6282, 25.9231, 'pending'),
                ('26772345678', 'No Water Flow', 'No water for 2 days', -21.1665, 27.5144, 'in_progress')`);
            
            console.log('✅ Sample data inserted');
        }
    });
});

// ========================================
// DASHBOARD API (Port 3001)
// ========================================
const dashboardApp = express();
dashboardApp.use(cors());
dashboardApp.use(express.json());
dashboardApp.use(express.static('public'));

// Stats endpoint
dashboardApp.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as total FROM users`, (err, usersRow) => {
        db.get(`SELECT COUNT(*) as pending FROM faults WHERE status = 'pending'`, (err, faultsRow) => {
            db.get(`SELECT COUNT(*) as today FROM messages_log WHERE date(created_at) = date('now')`, (err, messagesRow) => {
                db.get(`SELECT COUNT(*) as month FROM users WHERE datetime(registered_at) >= datetime('now', '-30 days')`, (err, newUsersRow) => {
                    res.json({
                        totalUsers: usersRow?.total || 0,
                        pendingFaults: faultsRow?.pending || 0,
                        todayMessages: messagesRow?.today || 0,
                        newUsersMonth: newUsersRow?.month || 0
                    });
                });
            });
        });
    });
});

// Users endpoint
dashboardApp.get('/api/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY registered_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

// Faults endpoint
dashboardApp.get('/api/faults', (req, res) => {
    db.all(`SELECT * FROM faults ORDER BY reported_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

// Update fault status
dashboardApp.post('/api/faults/:id/status', (req, res) => {
    const { status, technician } = req.body;
    db.run(`UPDATE faults SET status = ?, technician = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        [status, technician, req.params.id], (err) => {
            res.json({ success: !err });
        });
});

// Broadcast endpoint
dashboardApp.post('/api/broadcast', (req, res) => {
    const { message, targetArea, scheduledFor } = req.body;
    
    let query = `SELECT phone FROM users WHERE is_blocked = 0`;
    if (targetArea && targetArea !== 'all') {
        query += ` AND area = '${targetArea}'`;
    }
    
    db.all(query, (err, users) => {
        const recipientCount = users ? users.length : 0;
        
        db.run(`INSERT INTO broadcasts (message, target_area, scheduled_for, status, recipient_count) 
                VALUES (?, ?, ?, 'pending', ?)`,
            [message, targetArea || 'all', scheduledFor || new Date().toISOString(), recipientCount],
            (err) => {
                res.json({ success: !err, recipients: recipientCount });
            });
    });
});

// Get broadcasts
dashboardApp.get('/api/broadcasts', (req, res) => {
    db.all(`SELECT * FROM broadcasts ORDER BY scheduled_for DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

// Meter readings
dashboardApp.get('/api/readings', (req, res) => {
    db.all(`SELECT * FROM meter_readings ORDER BY submitted_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

// Approve reading
dashboardApp.post('/api/readings/:id/approve', (req, res) => {
    db.run(`UPDATE meter_readings SET approved = 1 WHERE id = ?`, [req.params.id], (err) => {
        res.json({ success: !err });
    });
});

// Analytics
dashboardApp.get('/api/analytics', (req, res) => {
    db.all(`SELECT date(created_at) as day, COUNT(*) as count 
            FROM messages_log WHERE created_at >= datetime('now', '-7 days')
            GROUP BY date(created_at)`, (err, messagesData) => {
        db.all(`SELECT fault_type, COUNT(*) as count FROM faults GROUP BY fault_type`, (err, faultsData) => {
            res.json({
                messagesByDay: messagesData || [],
                faultTypes: faultsData || []
            });
        });
    });
});

// Ingest endpoint - receives data from WhatsApp bot
dashboardApp.post('/api/ingest', (req, res) => {
    const { phone, message, direction, meterNumber, faultData, readingData } = req.body;
    
    console.log(`📥 Ingest: ${phone} - ${direction} - ${message?.substring(0, 50)}`);
    
    // Store message
    if (message) {
        db.run(`INSERT INTO messages_log (user_phone, direction, message) VALUES (?, ?, ?)`,
            [phone, direction, message.substring(0, 500)]);
    }
    
    // Update or create user
    db.run(`INSERT INTO users (phone, meter_number, last_active) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(phone) DO UPDATE SET 
            last_active = CURRENT_TIMESTAMP,
            meter_number = COALESCE(?, meter_number)`,
        [phone, meterNumber, meterNumber]);
    
    // Store fault if provided
    if (faultData) {
        db.run(`INSERT INTO faults (user_phone, fault_type, description, latitude, longitude, status) 
                VALUES (?, ?, ?, ?, ?, 'pending')`,
            [phone, faultData.type, faultData.description, faultData.lat || null, faultData.lng || null]);
        console.log(`📋 Fault stored: ${faultData.type}`);
    }
    
    // Store reading if provided
    if (readingData) {
        db.run(`INSERT INTO meter_readings (user_phone, meter_number, reading, approved) 
                VALUES (?, ?, ?, 0)`,
            [phone, readingData.meter, readingData.value]);
    }
    
    res.json({ success: true });
});

// Serve dashboard pages
dashboardApp.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

dashboardApp.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// WHATSAPP BOT (Port 3000)
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

// Send WhatsApp message
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

// Send data to dashboard
async function sendToDashboard(phone, message, direction, meterNumber = null, faultData = null, readingData = null) {
    try {
        await axios.post(`http://localhost:3001/api/ingest`, {
            phone, message, direction, meterNumber, faultData, readingData
        }, { timeout: 2000 });
        console.log(`📊 Data sent to dashboard`);
    } catch(error) {
        console.log(`⚠️ Dashboard not available: ${error.message}`);
    }
}

// Main message handler
async function handleMessage(from, message, msgType, mediaInfo = null) {
    console.log(`📱 ${from}: ${msgType}`);
    
    // Initialize session
    if (!sessions[from]) {
        sessions[from] = { step: 'menu', meter: null };
        await sendToDashboard(from, 'User started conversation', 'incoming');
    }
    
    const session = sessions[from];
    let text = '';
    
    if (msgType === 'text') {
        text = message?.body?.toLowerCase().trim() || '';
    }
    
    // Store message in dashboard
    if (text) {
        await sendToDashboard(from, text, 'incoming', session.meter);
    }
    
    // Menu command
if (text === 'hi' || text === 'menu' || text === 'start') {
    await sendMessage(from, `💧 *WATER UTILITIES CORPORATION - BOTSWANA* 💧

*"We keep it flowing, for you."*

🇧🇼 Official WUC WhatsApp Service

*What would you like to do?*

1️⃣ *Check Balance* - View your water bill
2️⃣ *Pay Bill* - Make a payment
3️⃣ *Submit Meter Reading* - Send your reading
4️⃣ *Report Fault* - Burst pipe, leak, etc.
5️⃣ *Payment History* - View past payments

*📞 Emergency?* Call 0800 600 222

Type your meter number (e.g., GBE-00412) to link your account.

*Serving Botswana with Excellence since 1970*`);
    return;
}
    
    // Check Balance
    if (text === '1' || text === 'balance' || text === 'check balance') {
        if (session.meter) {
            const acc = accounts[session.meter];
            await sendMessage(from, `💰 *CURRENT BALANCE* 💰
            
📋 Meter: ${session.meter}
👤 Name: ${acc.name}
📍 Area: ${acc.area}
─────────────────
💵 Balance: P${acc.balance.toFixed(2)}
📅 Due Date: End of month
─────────────────

Type "PAY" to make a payment or "MENU" for options.`);
        } else {
            await sendMessage(from, `🔑 *METER REQUIRED*
            
Please enter your meter number.
Example: GBE-00412`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // Pay Bill
    if (text === '2' || text === 'pay' || text === 'pay bill') {
        if (session.meter) {
            const acc = accounts[session.meter];
            if (acc.balance > 0) {
                await sendMessage(from, `💰 *PAYMENT* 💰
                
Amount Due: P${acc.balance.toFixed(2)}

Payment Options:
• Orange Money: Dial *151#
• Bank Transfer: Account 0123456789
• In Person: Any Botswana Water office

Send "PAID" after completing payment.`);
                session.step = 'awaiting_payment';
            } else {
                await sendMessage(from, `✅ No outstanding balance. Thank you!`);
            }
        } else {
            await sendMessage(from, `🔑 Please enter your meter number first.`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // Meter Reading
    if (text === '3' || text === 'reading' || text === 'meter reading') {
        if (session.meter) {
            await sendMessage(from, `📸 *SUBMIT METER READING*
            
Please send your current meter reading:
1️⃣ Type the number (e.g., 12345)
2️⃣ Or send a PHOTO of your meter

Current meter: ${session.meter}`);
            session.step = 'awaiting_reading';
        } else {
            await sendMessage(from, `🔑 Please enter your meter number first.`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // Report Fault
    if (text === '4' || text === 'fault' || text === 'report fault') {
        await sendMessage(from, `🚨 *REPORT FAULT* 🚨

Please describe the problem:

• Burst pipe
• No water flow
• Low pressure
• Leakage
• Dirty water
• Meter issue

Type your description:`);
        session.step = 'awaiting_fault';
        return;
    }
    
    // Payment History
    if (text === '5' || text === 'history' || text === 'payment history') {
        await sendMessage(from, `📜 *PAYMENT HISTORY* 📜

Recent payments:
• April 2026: P247.50 ✅
• March 2026: P189.00 ✅
• February 2026: P210.50 ✅

Full history available at our office.`);
        return;
    }
    
    // Handle meter number entry
    if (session.step === 'awaiting_meter') {
        const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
        if (meterMatch) {
            const meter = meterMatch[0];
            const account = accounts[meter];
            if (account) {
                session.meter = meter;
                session.step = 'menu';
                await sendToDashboard(from, `Linked meter: ${meter}`, 'system', meter);
                await sendMessage(from, `✅ *ACCOUNT LINKED* ✅
                
📋 Meter: ${meter}
👤 Name: ${account.name}
💰 Balance: P${account.balance.toFixed(2)}
📍 Area: ${account.area}

Type "MENU" for options.`);
            } else {
                await sendMessage(from, `❌ Meter "${meter}" not found.
Try: GBE-00412, GBE-00891, or FTB-00234`);
            }
        } else {
            await sendMessage(from, `Please enter a valid meter number.
Example: GBE-00412`);
        }
        return;
    }
    
    // Handle meter reading submission
    if (session.step === 'awaiting_reading') {
        const reading = parseFloat(text);
        if (!isNaN(reading) && reading > 0) {
            await sendToDashboard(from, `Reading: ${reading}`, 'incoming', session.meter, null, {
                meter: session.meter,
                value: reading
            });
            await sendMessage(from, `✅ *READING SUBMITTED* ✅
            
Reading: ${reading} m³
Reference: ${Date.now().toString().slice(-8)}

Thank you! We'll update your account within 24 hours.`);
            session.step = 'menu';
        } else {
            await sendMessage(from, `Please send a NUMBER (e.g., 12345) or send a PHOTO of your meter.`);
        }
        return;
    }
    
    // Handle fault reporting
    if (session.step === 'awaiting_fault') {
        await sendToDashboard(from, `Fault: ${text}`, 'incoming', session.meter, {
            type: 'Reported Issue',
            description: text,
            lat: mediaInfo?.latitude,
            lng: mediaInfo?.longitude
        });
        await sendMessage(from, `🚨 *FAULT REPORTED* 🚨
        
✅ Reference: FLT-${Date.now().toString().slice(-8)}
📋 Issue: ${text.substring(0, 100)}

A technician will be dispatched within 24 hours.
Thank you for reporting! 🇧🇼`);
        session.step = 'menu';
        return;
    }
    
    // Handle payment confirmation
    if (session.step === 'awaiting_payment') {
        if (text === 'paid') {
            await sendToDashboard(from, `Payment made`, 'incoming', session.meter);
            await sendMessage(from, `✅ *PAYMENT CONFIRMED* ✅
            
Reference: PAY-${Date.now().toString().slice(-8)}
Thank you for your payment!`);
            session.step = 'menu';
        } else {
            await sendMessage(from, `Send "PAID" when payment is complete.`);
        }
        return;
    }
    
    // Direct meter number entry
    const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
    if (meterMatch) {
        const meter = meterMatch[0];
        const account = accounts[meter];
        if (account) {
            session.meter = meter;
            await sendToDashboard(from, `Linked meter: ${meter}`, 'system', meter);
            await sendMessage(from, `✅ *METER LINKED* ✅
            
Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance.toFixed(2)}

Type "MENU" for options.`);
        }
        return;
    }
    
    // Default response
    if (text) {
        await sendMessage(from, `❌ I didn't understand "${text}".

Type "MENU" to see available options.`);
    } else {
        await sendMessage(from, `Type "MENU" to get started! 🇧🇼`);
    }
}

// Webhook verification
botApp.get('/webhook', (req, res) => {
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (token === process.env.VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Webhook receive messages
botApp.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object === 'whatsapp_business_account') {
            const msg = body.entry[0].changes[0].value.messages?.[0];
            if (msg && msg.type === 'text') {
                await handleMessage(msg.from, msg.text, 'text');
            }
            if (msg && msg.type === 'location') {
                await handleMessage(msg.from, null, 'location', { latitude: msg.location.latitude, longitude: msg.location.longitude });
            }
            if (msg && msg.type === 'image') {
                await handleMessage(msg.from, null, 'image');
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.sendStatus(200);
    }
});

botApp.get('/', (req, res) => {
    res.json({ status: 'running', service: 'Botswana Water Bot' });
});

// ========================================
// START BOTH SERVERS
// ========================================
const DASHBOARD_PORT = 3001;
const BOT_PORT = 3000;

dashboardApp.listen(DASHBOARD_PORT, () => {
    console.log(`📊 Dashboard: http://localhost:${DASHBOARD_PORT}/dashboard`);
    console.log(`🔗 API: http://localhost:${DASHBOARD_PORT}/api`);
});

botApp.listen(BOT_PORT, () => {
    console.log(`🤖 WhatsApp Bot: http://localhost:${BOT_PORT}`);
    console.log(`📱 Webhook: http://localhost:${BOT_PORT}/webhook`);
});

console.log(`\n✅ ALL SERVICES STARTED SUCCESSFULLY!`);
console.log(`📊 Dashboard URL: https://water-botswana-production.up.railway.app/dashboard`);
console.log(`🤖 Bot Webhook: https://water-botswana-production.up.railway.app/webhook`);
