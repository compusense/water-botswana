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
    
    db.run(`CREATE TABLE IF NOT EXISTS meter_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        meter_number TEXT,
        reading REAL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved BOOLEAN DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS messages_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        message TEXT,
        direction TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========================================
// ACCOUNT DATABASE
// ========================================
const accounts = {
    'GBE-00412': { name: 'Kefilwe Moyo', balance: 247.50, area: 'Gaborone', address: 'Gaborone West, Plot 123' },
    'GBE-00891': { name: 'Thabo Sithole', balance: 0, area: 'Gaborone', address: 'Gaborone North, Phase 2' },
    'FTB-00234': { name: 'Mpho Nkwe', balance: 512.00, area: 'Francistown', address: 'Francistown, Monarch' },
    'LBE-00123': { name: 'Botswana Water Corp', balance: 189.50, area: 'Lobatse', address: 'Lobatse Industrial' },
    'GBE-00999': { name: 'Demo Customer', balance: 75.25, area: 'Gaborone', address: 'Gaborone CBD' }
};

// Session management
const sessions = {};

// ========================================
// SEND WHATSAPP MESSAGE
// ========================================
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

// ========================================
// SEND INTERACTIVE MENU
// ========================================
async function sendMenu(to) {
    await sendWhatsApp(to, `💧 *WATER UTILITIES CORPORATION - BOTSWANA* 💧

*"We keep it flowing, for you."*

🇧🇼 Welcome to WUC WhatsApp Service!

*What would you like to do?*

1️⃣ *Check Balance* - View your water bill
2️⃣ *Pay Bill* - Make a payment
3️⃣ *Submit Meter Reading* - Send your reading
4️⃣ *Report Fault* - Burst pipe, leak, etc.
5️⃣ *Payment History* - View past payments

*Reply with the number or command.*

📝 *Quick Actions:*
• Type your meter number (e.g., GBE-00412) to link account
• Type "MENU" anytime to see this menu
• Type "HELP" for support

📞 *Emergency Hotline:* 0800 600 222

*Serving Botswana with Excellence since 1970*`);
}

// ========================================
// SEND HELP MENU
// ========================================
async function sendHelp(to) {
    await sendWhatsApp(to, `🆘 *WUC HELP MENU* 🆘

*Commands you can use:*

📋 *MENU* - Show main menu
💰 *BALANCE* - Check your bill
💳 *PAY* - Make a payment
📸 *READING* - Submit meter reading
🚨 *FAULT* - Report a problem
📜 *HISTORY* - View payment history

*Meter Number Format:*
[Area Code]-[5 digits]
Example: GBE-00412

*Fault Types:*
• Burst pipe
• No water flow
• Low pressure
• Leakage
• Dirty water
• Meter issue

*Contact Us:*
📞 0800 600 222
📧 support@wuc.bw
🌐 www.wuc.bw

Type "MENU" to return to main menu.`);
}

// ========================================
// CHECK BALANCE
// ========================================
async function checkBalance(to, meterNumber) {
    const account = accounts[meterNumber];
    if (account) {
        await sendWhatsApp(to, `💰 *CURRENT WATER BILL* 💰

📋 Meter Number: ${meterNumber}
👤 Account Name: ${account.name}
📍 Address: ${account.address}
🏙️ Area: ${account.area}
─────────────────
💵 Outstanding Balance: P${account.balance.toFixed(2)}
📅 Due Date: End of month
⚠️ Late Fee: 5% after due date
─────────────────

💡 Type *PAY* to make a payment
📋 Type *MENU* for other options

*Thank you for being a valued customer!*`);
    } else {
        await sendWhatsApp(to, `❌ *METER NOT FOUND* ❌

Meter number "${meterNumber}" does not exist in our system.

📋 *Valid test meters:*
• GBE-00412 (Gaborone)
• GBE-00891 (Gaborone)
• FTB-00234 (Francistown)
• LBE-00123 (Lobatse)

Type *MENU* to try again or call 0800 600 222 for assistance.`);
    }
}

// ========================================
// PAYMENT FLOW
// ========================================
async function startPayment(to, meterNumber) {
    const account = accounts[meterNumber];
    if (account && account.balance > 0) {
        sessions[to] = { step: 'awaiting_payment_amount', meter: meterNumber };
        await sendWhatsApp(to, `💰 *PAYMENT PORTAL* 💰

Meter: ${meterNumber}
Name: ${account.name}
Outstanding Balance: P${account.balance.toFixed(2)}

Please enter the amount you want to pay:

Example: 247.50

Or type *CANCEL* to abort.`);
    } else if (account && account.balance === 0) {
        await sendWhatsApp(to, `✅ *NO OUTSTANDING BALANCE* ✅

Your account is fully paid up.
Thank you for being a responsible customer!

Type *MENU* for other options.`);
    } else {
        await sendWhatsApp(to, `🔑 *METER REQUIRED* 🔑

Please enter your meter number first.
Example: GBE-00412

Type *MENU* to cancel.`);
        sessions[to] = { step: 'awaiting_meter' };
    }
}

async function processPayment(to, amount) {
    const meter = sessions[to]?.meter;
    if (!meter) {
        await sendWhatsApp(to, `Please enter your meter number first.`);
        sessions[to] = { step: 'awaiting_meter' };
        return;
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        await sendWhatsApp(to, `❌ *INVALID AMOUNT* ❌

Please enter a valid amount.
Example: 247.50

Type *CANCEL* to abort.`);
        return;
    }
    
    sessions[to].amount = numAmount;
    sessions[to].step = 'awaiting_payment_confirmation';
    
    await sendWhatsApp(to, `💳 *PAYMENT INSTRUCTIONS* 💳

Amount: P${numAmount.toFixed(2)}

*Payment Options:*

1️⃣ *Orange Money*
   Dial *151# and follow prompts

2️⃣ *Bank Transfer*
   Account: 0123456789
   Bank: Botswana Savings Bank
   Reference: ${meter}

3️⃣ *In Person*
   Any WUC customer service office

⚠️ After completing payment, type *PAID*
❌ Type *CANCEL* to abort

*Reference: WUC-${Date.now().toString().slice(-8)}*`);
}

async function confirmPayment(to) {
    const amount = sessions[to]?.amount;
    const meter = sessions[to]?.meter;
    
    await sendWhatsApp(to, `✅ *PAYMENT CONFIRMED* ✅

Amount: P${amount?.toFixed(2) || '0'}
Meter: ${meter}
Reference: PAY-${Date.now().toString().slice(-8)}
Date: ${new Date().toLocaleDateString()}
Time: ${new Date().toLocaleTimeString()}

*A receipt has been sent to your registered email.*

Thank you for your payment!
🇧🇼 Water Utilities Corporation

Type *MENU* for other options.`);
    
    // Update balance (in real system, this would update database)
    if (meter && accounts[meter]) {
        accounts[meter].balance = Math.max(0, accounts[meter].balance - amount);
    }
    
    delete sessions[to];
}

// ========================================
// METER READING FLOW
// ========================================
async function startMeterReading(to, meterNumber) {
    if (!meterNumber) {
        await sendWhatsApp(to, `🔑 *METER REQUIRED* 🔑

Please enter your meter number first.
Example: GBE-00412`);
        sessions[to] = { step: 'awaiting_meter' };
        return;
    }
    
    sessions[to] = { step: 'awaiting_reading', meter: meterNumber };
    await sendWhatsApp(to, `📸 *SUBMIT METER READING* 📸

Meter: ${meterNumber}

Please send your current meter reading:

1️⃣ *Type the number*
   Example: 12345

2️⃣ *Send a PHOTO*
   Tap 📎 → Camera → Take photo of your meter

Type *CANCEL* to abort.`);
}

async function processMeterReading(to, reading) {
    const meter = sessions[to]?.meter;
    const numReading = parseFloat(reading);
    
    if (isNaN(numReading) || numReading <= 0) {
        await sendWhatsApp(to, `❌ *INVALID READING* ❌

Please enter a valid number.
Example: 12345

Or send a PHOTO of your meter.`);
        return;
    }
    
    // Store in database
    db.run(`INSERT INTO meter_readings (user_phone, meter_number, reading) VALUES (?, ?, ?)`,
        [to, meter, numReading]);
    
    await sendWhatsApp(to, `✅ *METER READING SUBMITTED* ✅

Meter: ${meter}
Reading: ${numReading} m³
Date: ${new Date().toLocaleDateString()}
Reference: MET-${Date.now().toString().slice(-8)}

*What happens next?*
• Our team will verify your reading within 24 hours
• Your bill will be updated accordingly
• You'll receive a confirmation message

Thank you for your submission!

Type *MENU* for other options.`);
    
    delete sessions[to];
}

// ========================================
// FAULT REPORTING FLOW
// ========================================
const faultTypes = {
    '1': '💥 Burst Pipe',
    '2': '🚱 No Water Flow',
    '3': '📉 Low Pressure',
    '4': '💧 Leakage',
    '5': '🏾 Dirty Water',
    '6': '🔊 Meter Issue',
    '7': '🆘 Other'
};

async function startFaultReport(to) {
    sessions[to] = { step: 'awaiting_fault_type' };
    await sendWhatsApp(to, `🚨 *REPORT A FAULT* 🚨

Please select the type of fault:

1️⃣ 💥 Burst Pipe
2️⃣ 🚱 No Water Flow
3️⃣ 📉 Low Pressure
4️⃣ 💧 Leakage
5️⃣ 🏾 Dirty Water
6️⃣ 🔊 Meter Issue
7️⃣ 🆘 Other

Reply with the number (1-7).

Type *CANCEL* to abort.`);
}

async function processFaultType(to, choice) {
    const faultName = faultTypes[choice];
    if (!faultName) {
        await sendWhatsApp(to, `❌ *INVALID SELECTION* ❌

Please select a number between 1 and 7.

Type *CANCEL* to abort.`);
        return;
    }
    
    sessions[to].fault_type = faultName;
    sessions[to].step = 'awaiting_fault_description';
    await sendWhatsApp(to, `🔧 *FAULT REPORTING* 🔧

Selected: ${faultName}

Please describe the problem in detail:
• When did it start?
• How severe is it?
• Any other relevant information

Type *CANCEL* to abort.`);
}

async function processFaultDescription(to, description) {
    const faultType = sessions[to]?.fault_type;
    
    // Store in database
    db.run(`INSERT INTO faults (user_phone, fault_type, description, status) 
            VALUES (?, ?, ?, 'pending')`,
        [to, faultType, description]);
    
    await sendWhatsApp(to, `✅ *FAULT REPORTED SUCCESSFULLY* ✅

📋 Fault Type: ${faultType}
📝 Description: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}
🆔 Reference: WUC-${Date.now().toString().slice(-8)}
📅 Date: ${new Date().toLocaleDateString()}
⏰ Time: ${new Date().toLocaleTimeString()}

*What happens next?*
• Our team has been notified
• A technician will be dispatched within 24 hours
• You'll receive updates via WhatsApp

📍 For faster service, please share your location when asked.

Thank you for helping us improve our service!

Type *MENU* for other options.`);
    
    delete sessions[to];
}

// ========================================
// PAYMENT HISTORY
// ========================================
async function showPaymentHistory(to, meterNumber) {
    if (!meterNumber) {
        await sendWhatsApp(to, `🔑 *METER REQUIRED* 🔑

Please enter your meter number first.
Example: GBE-00412`);
        sessions[to] = { step: 'awaiting_meter' };
        return;
    }
    
    await sendWhatsApp(to, `📜 *PAYMENT HISTORY* 📜

Meter: ${meterNumber}

*Recent Payments:*

🗓️ *April 2026*: P247.50 ✅
🗓️ *March 2026*: P189.00 ✅
🗓️ *February 2026*: P210.50 ✅
🗓️ *January 2026*: P195.00 ✅
🗓️ *December 2025*: P220.00 ✅

─────────────────
*Total Paid (6 months)*: P1,062.00

💡 *Need a detailed statement?*
Visit any WUC office or call 0800 600 222

Type *MENU* for other options.`);
}

// ========================================
// MAIN MESSAGE HANDLER
// ========================================
async function handleIncoming(from, text) {
    console.log(`📱 ${from}: "${text}"`);
    
    // Store message
    db.run(`INSERT INTO messages_log (user_phone, message, direction) VALUES (?, ?, 'incoming')`, [from, text]);
    
    // Update user
    db.run(`INSERT INTO users (phone, last_active) VALUES (?, CURRENT_TIMESTAMP) 
            ON CONFLICT(phone) DO UPDATE SET last_active=CURRENT_TIMESTAMP`, [from]);
    
    const lower = text.toLowerCase().trim();
    const session = sessions[from] || { step: 'menu' };
    sessions[from] = session;
    
    // Cancel command
    if (lower === 'cancel') {
        delete sessions[from];
        await sendWhatsApp(from, `❌ *ACTION CANCELLED* ❌

Returning to main menu.

Type *MENU* to see options.`);
        return;
    }
    
    // Help command
    if (lower === 'help') {
        await sendHelp(from);
        return;
    }
    
    // Menu command
    if (lower === 'menu' || lower === 'hi' || lower === 'hello' || lower === 'start') {
        delete sessions[from];
        await sendMenu(from);
        return;
    }
    
    // Handle active sessions
    if (session.step === 'awaiting_meter') {
        const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
        if (meterMatch) {
            const meter = meterMatch[0];
            const account = accounts[meter];
            if (account) {
                session.meter = meter;
                session.step = 'menu';
                db.run(`UPDATE users SET meter_number = ? WHERE phone = ?`, [meter, from]);
                await sendWhatsApp(from, `✅ *ACCOUNT LINKED SUCCESSFULLY* ✅

Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance}
Area: ${account.area}

Type *MENU* for options or *BALANCE* to check your bill.`);
            } else {
                await sendWhatsApp(from, `❌ Meter "${meter}" not found. Please try again.`);
            }
        } else {
            await sendWhatsApp(from, `Please enter a valid meter number (e.g., GBE-00412) or type *MENU* to cancel.`);
        }
        return;
    }
    
    if (session.step === 'awaiting_payment_amount') {
        if (lower === 'paid') {
            await confirmPayment(from);
        } else {
            await processPayment(from, text);
        }
        return;
    }
    
    if (session.step === 'awaiting_payment_confirmation') {
        if (lower === 'paid') {
            await confirmPayment(from);
        } else {
            await sendWhatsApp(from, `Type *PAID* after completing your payment, or *CANCEL* to abort.`);
        }
        return;
    }
    
    if (session.step === 'awaiting_reading') {
        await processMeterReading(from, text);
        return;
    }
    
    if (session.step === 'awaiting_fault_type') {
        await processFaultType(from, text);
        return;
    }
    
    if (session.step === 'awaiting_fault_description') {
        await processFaultDescription(from, text);
        return;
    }
    
    // Check for meter number in text
    const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
    if (meterMatch && session.step === 'menu') {
        const meter = meterMatch[0];
        const account = accounts[meter];
        if (account) {
            session.meter = meter;
            db.run(`UPDATE users SET meter_number = ? WHERE phone = ?`, [meter, from]);
            await sendWhatsApp(from, `✅ *METER LINKED* ✅

Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance}

Type *MENU* for options.`);
        } else {
            await sendWhatsApp(from, `❌ Meter "${meter}" not found.`);
        }
        return;
    }
    
    // Handle main menu commands
    const currentMeter = session.meter;
    
    if (lower === '1' || lower === 'balance' || lower === 'check balance') {
        if (currentMeter) {
            await checkBalance(from, currentMeter);
        } else {
            await sendWhatsApp(from, `🔑 *METER REQUIRED* 🔑

Please enter your meter number to check your balance.
Example: GBE-00412`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    if (lower === '2' || lower === 'pay' || lower === 'pay bill') {
        if (currentMeter) {
            await startPayment(from, currentMeter);
        } else {
            await sendWhatsApp(from, `🔑 *METER REQUIRED* 🔑

Please enter your meter number to make a payment.
Example: GBE-00412`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    if (lower === '3' || lower === 'reading' || lower === 'meter reading') {
        await startMeterReading(from, currentMeter);
        return;
    }
    
    if (lower === '4' || lower === 'fault' || lower === 'report fault') {
        await startFaultReport(from);
        return;
    }
    
    if (lower === '5' || lower === 'history' || lower === 'payment history') {
        await showPaymentHistory(from, currentMeter);
        return;
    }
    
    // Default response
    await sendWhatsApp(from, `❌ *COMMAND NOT RECOGNIZED* ❌

I didn't understand "${text}".

📋 Type *MENU* to see available options
🆘 Type *HELP* for assistance

📞 Or call our hotline: 0800 600 222`);
}

// ========================================
// EXPRESS APP
// ========================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Webhook routes
app.get('/webhook', (req, res) => {
    console.log('🔗 Webhook verification');
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
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

// Dashboard API routes
app.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as users FROM users`, (err, users) => {
        db.get(`SELECT COUNT(*) as faults FROM faults WHERE status='pending'`, (err, faults) => {
            db.get(`SELECT COUNT(*) as readings FROM meter_readings WHERE approved=0`, (err, readings) => {
                res.json({ 
                    totalUsers: users?.users || 0, 
                    pendingFaults: faults?.faults || 0,
                    pendingReadings: readings?.readings || 0
                });
            });
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
    db.all(`SELECT * FROM meter_readings ORDER BY submitted_at DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/readings/:id/approve', (req, res) => {
    db.run(`UPDATE meter_readings SET approved=1 WHERE id=?`, [req.params.id], () => {
        res.json({ success: true });
    });
});

app.get('/api/analytics', (req, res) => {
    db.all(`SELECT date(created_at) as day, COUNT(*) as count FROM messages_log GROUP BY date(created_at) LIMIT 7`, (err, messages) => {
        db.all(`SELECT fault_type, COUNT(*) as count FROM faults GROUP BY fault_type`, (err, faults) => {
            res.json({ messagesByDay: messages || [], faultTypes: faults || [] });
        });
    });
});

app.post('/api/logout', (req, res) => {
    res.json({ success: true });
});

// Page routes
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`📱 Webhook: https://water-botswana-production.up.railway.app/webhook`);
    console.log(`📊 Dashboard: https://water-botswana-production.up.railway.app/dashboard`);
});
