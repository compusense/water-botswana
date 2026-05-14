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
// WHATSAPP BOT FUNCTIONS
// ========================================
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
    
    db.run(`INSERT INTO messages_log (user_phone, message) VALUES (?, ?)`, [from, text]);
    db.run(`INSERT INTO users (phone, last_active) VALUES (?, CURRENT_TIMESTAMP) 
            ON CONFLICT(phone) DO UPDATE SET last_active=CURRENT_TIMESTAMP`, [from]);
    
    const lower = text.toLowerCase().trim();
    
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
    
    if (lower === '1' || lower === 'balance' || lower === 'check balance') {
        await sendWhatsApp(from, `💰 *CURRENT BALANCE*

Please enter your meter number.
Example: GBE-00412`);
        return;
    }
    
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
    
    await sendWhatsApp(from, `Type "MENU" to see available options.

Need help? Call 0800 600 222`);
}

// ========================================
// EXPRESS APP - Combined
// ========================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========================================
// WHATSAPP WEBHOOK ROUTES (MUST BE FIRST)
// ========================================
app.get('/webhook', (req, res) => {
    console.log('🔗 Webhook GET received');
    console.log('Query params:', req.query);
    
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully!');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Verification failed. Expected:', process.env.VERIFY_TOKEN, 'Got:', token);
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    console.log('📨 Webhook POST received');
    try {
        const body = req.body;
        console.log('Body:', JSON.stringify(body, null, 2));
        
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry[0];
            const changes = entry.changes[0];
            const value = changes.value;
            
            if (value.messages && value.messages[0]) {
                const msg = value.messages[0];
                const from = msg.from;
                const type = msg.type;
                
                if (type === 'text') {
                    await handleIncoming(from, msg.text.body);
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.sendStatus(200);
    }
});

// ========================================
// DASHBOARD API ROUTES
// ========================================
app.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as users FROM users`, (err, users) => {
        db.get(`SELECT COUNT(*) as faults FROM faults WHERE status='pending'`, (err, faults) => {
            res.json({ totalUsers: users?.users || 0, pendingFaults: faults?.faults || 0 });
        });
    });
});

app.get('/api/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY registered_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/faults', (req, res) => {
    db.all(`SELECT * FROM faults ORDER BY reported_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/faults/:id/status', (req, res) => {
    db.run(`UPDATE faults SET status='resolved' WHERE id=?`, [req.params.id], () => {
        res.json({ success: true });
    });
});

app.post('/api/broadcast', (req, res) => {
    res.json({ success: true, recipients: 0 });
});

app.get('/api/broadcasts', (req, res) => {
    res.json([]);
});

app.get('/api/readings', (req, res) => {
    res.json([]);
});

app.post('/api/readings/:id/approve', (req, res) => {
    res.json({ success: true });
});

app.get('/api/analytics', (req, res) => {
    res.json({ messagesByDay: [], faultTypes: [] });
});

app.post('/api/logout', (req, res) => {
    res.json({ success: true });
});

// ========================================
// PAGE ROUTES
// ========================================
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`📱 Webhook URL: https://water-botswana-production.up.railway.app/webhook`);
    console.log(`📊 Dashboard: https://water-botswana-production.up.railway.app/dashboard`);
    console.log(`🔗 Login: https://water-botswana-production.up.railway.app/`);
    console.log(`\n💡 Test webhook in browser: https://water-botswana-production.up.railway.app/webhook?hub.mode=subscribe&hub.verify_token=${process.env.VERIFY_TOKEN}&hub.challenge=123456`);
});
