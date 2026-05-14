const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
require('dotenv').config();

console.log('🚀 Starting WUC Botswana Bot...');
console.log('Environment check:');
console.log('  VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? '✅ Set' : '❌ Missing');
console.log('  WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? '✅ Set' : '❌ Missing');
console.log('  PHONE_NUMBER_ID:', process.env.PHONE_NUMBER_ID ? '✅ Set' : '❌ Missing');

// ========================================
// DATABASE
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
        last_active DATETIME
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS faults (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        fault_type TEXT,
        description TEXT,
        latitude REAL,
        longitude REAL,
        status TEXT DEFAULT 'pending',
        reported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS messages_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========================================
// DASHBOARD API
// ========================================
const dashboard = express();
dashboard.use(cors());
dashboard.use(express.json());
dashboard.use(express.static('public'));

dashboard.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as users FROM users`, (err, users) => {
        db.get(`SELECT COUNT(*) as faults FROM faults WHERE status='pending'`, (err, faults) => {
            res.json({ totalUsers: users?.users || 0, pendingFaults: faults?.faults || 0 });
        });
    });
});

dashboard.get('/api/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY registered_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

dashboard.get('/api/faults', (req, res) => {
    db.all(`SELECT * FROM faults ORDER BY reported_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

dashboard.post('/api/faults/:id/status', (req, res) => {
    db.run(`UPDATE faults SET status='resolved' WHERE id=?`, [req.params.id], () => {
        res.json({ success: true });
    });
});

dashboard.post('/api/broadcast', (req, res) => {
    res.json({ success: true, recipients: 0 });
});

dashboard.get('/api/broadcasts', (req, res) => {
    res.json([]);
});

dashboard.get('/api/readings', (req, res) => {
    res.json([]);
});

dashboard.post('/api/readings/:id/approve', (req, res) => {
    res.json({ success: true });
});

dashboard.get('/api/analytics', (req, res) => {
    res.json({ messagesByDay: [], faultTypes: [] });
});

dashboard.post('/api/logout', (req, res) => {
    res.json({ success: true });
});

dashboard.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

dashboard.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// WHATSAPP BOT
// ========================================
const bot = express();
bot.use(express.json());

const sessions = {};
const accounts = {
    'GBE-00412': { name: 'Kefilwe Moyo', balance: 247.50, area: 'Gaborone' },
    'GBE-00891': { name: 'Thabo Sithole', balance: 0, area: 'Gaborone' },
    'FTB-00234': { name: 'Mpho Nkwe', balance: 512.00, area: 'Francistown' }
};

async function sendWhatsApp(to, text) {
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
        console.error('❌ Send failed:', error.response?.data?.error?.message || error.message);
        return false;
    }
}

async function handleIncoming(from, text) {
    console.log(`📱 ${from}: "${text}"`);
    
    // Store message
    db.run(`INSERT INTO messages_log (user_phone, message) VALUES (?, ?)`, [from, text]);
    
    // Update user
    db.run(`INSERT INTO users (phone, last_active) VALUES (?, CURRENT_TIMESTAMP) 
            ON CONFLICT(phone) DO UPDATE SET last_active=CURRENT_TIMESTAMP`, [from]);
    
    const lower = text.toLowerCase().trim();
    
    // Menu
    if (lower === 'hi' || lower === 'menu' || lower === 'start') {
        await sendWhatsApp(from, `💧 *WATER UTILITIES CORPORATION - BOTSWANA* 💧

*"We keep it flowing, for you."*

🇧🇼 Welcome to WUC WhatsApp Service!

*Menu:*

1️⃣ *Check Balance* - View your bill
2️⃣ *Pay Bill* - Make payment
3️⃣ *Meter Reading* - Submit reading
4️⃣ *Report Fault* - Burst pipe, leak
5️⃣ *History* - Payment history

*Reply with number or command.*

Type your meter number (e.g., GBE-00412) to link your account.

📞 Emergency: 0800 600 222`);
        return;
    }
    
    // Check Balance
    if (lower === '1' || lower === 'balance' || lower === 'check balance') {
        await sendWhatsApp(from, `💰 *CURRENT BALANCE*

Please enter your meter number.
Example: GBE-00412`);
        return;
    }
    
    // Meter number handling
    const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
    if (meterMatch) {
        const meter = meterMatch[0];
        const account = accounts[meter];
        if (account) {
            await sendWhatsApp(from, `✅ *ACCOUNT FOUND*

Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance}
Area: ${account.area}

Type MENU for options`);
        } else {
            await sendWhatsApp(from, `❌ Meter ${meter} not found.
Try: GBE-00412, GBE-00891, FTB-00234`);
        }
        return;
    }
    
    // Default response
    await sendWhatsApp(from, `Type "MENU" to see available options.

Need help? Call 0800 600 222`);
}

// Webhook endpoints
bot.get('/webhook', (req, res) => {
    console.log('Webhook verification');
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (token === process.env.VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Verification failed');
        res.sendStatus(403);
    }
});

bot.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object === 'whatsapp_business_account') {
            const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
            if (msg && msg.type === 'text') {
                await handleIncoming(msg.from, msg.text.body);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.sendStatus(200);
    }
});

bot.get('/', (req, res) => {
    res.json({ status: 'running', service: 'WUC Botswana Bot' });
});

// ========================================
// START SERVERS
// ========================================
const PORT_BOT = 3000;
const PORT_DASH = 3001;

bot.listen(PORT_BOT, () => {
    console.log(`🤖 WhatsApp Bot running on port ${PORT_BOT}`);
    console.log(`📱 Webhook URL: https://your-railway-url.up.railway.app/webhook`);
});

dashboard.listen(PORT_DASH, () => {
    console.log(`📊 Dashboard running on port ${PORT_DASH}`);
    console.log(`🔗 Dashboard URL: https://your-railway-url.up.railway.app/dashboard`);
});

console.log('\n✅ All services started!');
