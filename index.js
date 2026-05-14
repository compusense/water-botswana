const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
require('dotenv').config();

console.log('🚀 Starting WUC Botswana Bot v3.0...');
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
        alert_subscribed BOOLEAN DEFAULT 0,
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
    
    db.run(`CREATE TABLE IF NOT EXISTS new_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_phone TEXT,
        status TEXT DEFAULT 'pending',
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Water supply status by area
const waterStatus = {
    'Gaborone': { status: '🟢 Normal', maintenance: 'None scheduled', color: 'green' },
    'Gaborone West': { status: '🟡 Maintenance', maintenance: 'May 15, 9am-3pm', color: 'yellow' },
    'Gaborone North': { status: '🟢 Normal', maintenance: 'None scheduled', color: 'green' },
    'Francistown': { status: '🟡 Maintenance', maintenance: 'May 16, 8am-12pm', color: 'yellow' },
    'Francistown Industrial': { status: '🟡 Maintenance', maintenance: 'May 16, 8am-12pm', color: 'yellow' },
    'Lobatse': { status: '🟢 Normal', maintenance: 'None scheduled', color: 'green' },
    'Lobatse CBD': { status: '🟡 Maintenance', maintenance: 'May 18, 10am-2pm', color: 'yellow' },
    'Selebi-Phikwe': { status: '🔴 Interruption', maintenance: 'Burst pipe - fixing', color: 'red' },
    'Molepolole': { status: '🟢 Normal', maintenance: 'None scheduled', color: 'green' },
    'Mahalapye': { status: '🟢 Normal', maintenance: 'None scheduled', color: 'green' },
    'Serowe': { status: '🟡 Low pressure', maintenance: 'Pump station issue', color: 'yellow' }
};

// Office locations
const offices = {
    'Gaborone': '🏢 WUC Headquarters, Gaborone International Commerce Park\n🕐 Mon-Fri 8am-5pm\n📞 0800 600 222',
    'Francistown': '🏢 Francistown Regional Office, Blue Jacket Street\n🕐 Mon-Fri 8am-5pm\n📞 241 1234',
    'Lobatse': '🏢 Lobatse Service Centre, Main Mall\n🕐 Mon-Fri 8am-4:30pm\n📞 533 4567',
    'Selebi-Phikwe': '🏢 Selebi-Phikwe Office, Industrial Area\n🕐 Mon-Fri 8am-5pm\n📞 261 2345',
    'Molepolole': '🏢 Molepolole Satellite Office, Kgosi Square\n🕐 Mon & Wed 9am-3pm\n📞 592 3456'
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
// MAIN MENU (UPDATED WITH NEW FEATURES)
// ========================================
async function sendMenu(to) {
    await sendWhatsApp(to, `💧 *WATER UTILITIES CORPORATION - BOTSWANA* 💧

*"We keep it flowing, for you."*

🇧🇼 *Main Menu*

1️⃣ 💰 Check Balance
2️⃣ 💳 Pay Bill
3️⃣ 📸 Submit Meter Reading
4️⃣ 🚨 Report Fault
5️⃣ 📜 Payment History
6️⃣ 🚰 Water Supply Status
7️⃣ 🔌 New Connection
8️⃣ 💹 Tariff Calculator
9️⃣ 📍 Find WUC Office
🔟 💡 Water Saving Tips

*Quick Commands:*
• *STATUS* - Water supply in your area
• *TARIFF* - Current water rates
• *OFFICE* - Nearest WUC branch
• *QUALITY* - Water quality report
• *ALERTS* - Subscribe to notifications

*New Connection?* Type *CONNECT*
*Emergency?* Call 0800 600 222

*Serving Botswana with Excellence 🇧🇼*`);
}

// ========================================
// HELP MENU
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
🚰 *STATUS* - Water supply status
🔌 *CONNECT* - New connection info
💹 *TARIFF* - Water rates calculator
📍 *OFFICE* - Find WUC office
💡 *TIPS* - Water saving tips
🔔 *ALERTS* - Subscribe to notifications

*Meter Number Format:*
[Area Code]-[5 digits]
Example: GBE-00412

*Contact Us:*
📞 0800 600 222
📧 support@wuc.bw
🌐 www.wuc.bw

Type *MENU* to return to main menu.`);
}

// ========================================
// FEATURE 1: WATER SUPPLY STATUS
// ========================================
async function waterSupplyStatus(to, area) {
    const userArea = area || 'Gaborone';
    const status = waterStatus[userArea] || waterStatus['Gaborone'];
    
    let alertStatus = '';
    db.get(`SELECT alert_subscribed FROM users WHERE phone = ?`, [to], (err, row) => {
        if (row && row.alert_subscribed) {
            alertStatus = '\n\n🔔 *You are subscribed to alerts*\nType *ALERTS OFF* to unsubscribe';
        } else {
            alertStatus = '\n\n🔔 Type *ALERTS* to get notified about interruptions in your area';
        }
        
        sendWhatsApp(to, `🚰 *WATER SUPPLY STATUS* 🚰

📍 *${userArea}:* ${status.status}

${status.maintenance !== 'None scheduled' ? `🛠️ *Maintenance:* ${status.maintenance}` : '✅ *No planned maintenance*'}

*Other Areas:*
• Gaborone West: 🟡 Maintenance (May 15)
• Selebi-Phikwe: 🔴 Interruption (Burst pipe)
• Serowe: 🟡 Low pressure

*Emergency Interruptions:*
🔧 Selebi-Phikwe - Crew dispatched
🕐 Estimated restoration: 6pm

*Report supply issues:* Type FAULT or call 0800 600 222
${alertStatus}`);
    });
}

async function subscribeAlerts(to, action) {
    if (action === 'on') {
        db.run(`UPDATE users SET alert_subscribed = 1 WHERE phone = ?`, [to]);
        await sendWhatsApp(to, `🔔 *ALERTS SUBSCRIBED* 🔔

You will now receive notifications about:
• Water supply interruptions
• Planned maintenance
• Emergency shutdowns
• Service restoration updates

Type *ALERTS OFF* to unsubscribe.`);
    } else if (action === 'off') {
        db.run(`UPDATE users SET alert_subscribed = 0 WHERE phone = ?`, [to]);
        await sendWhatsApp(to, `🔕 *ALERTS UNSUBSCRIBED* 🔕

You will no longer receive interruption notifications.

Type *ALERTS ON* to resubscribe.`);
    }
}

// ========================================
// FEATURE 2: NEW CONNECTION
// ========================================
async function newConnection(to, action) {
    if (action === 'apply') {
        db.run(`INSERT INTO new_connections (user_phone, status) VALUES (?, 'pending')`, [to]);
        await sendWhatsApp(to, `🔌 *NEW CONNECTION APPLICATION* 🔌

*Application Started!*
Reference: WUC-${Date.now().toString().slice(-8)}

*Requirements:*
📋 Completed application form
🆚 Copy of Omang (National ID)
🏠 Proof of property ownership/lease
📍 Plot/ERF number
📐 Site plan (for new developments)

💰 *Fees:*
• Connection fee: P850
• Deposit: P500 (residential)
• Deposit: P2000 (commercial)
• Meter cost: P350

*Next Steps:*
1️⃣ Visit any WUC office with documents
2️⃣ Pay connection fee
3️⃣ Schedule inspection (3-5 days)
4️⃣ Installation (7-10 days)

*Apply Online:* www.wuc.bw/connections
*Status Check:* Type *CONNECTION STATUS*

📞 Need help? Call New Connections: 0800 600 111`);
    } else {
        await sendWhatsApp(to, `🔌 *NEW WATER CONNECTION* 🔌

*Service Types:*
🏠 Residential - P850 + P500 deposit
🏢 Commercial - P850 + P2000 deposit
🏭 Industrial - P1500 + P5000 deposit
🚜 Agricultural - P1200 + P1000 deposit

*Processing time:* 10-15 working days

*How to apply:*
1️⃣ Type *APPLY* to start application
2️⃣ Visit any WUC office
3️⃣ Apply online: www.wuc.bw/connections

*Required Documents:*
✓ Completed application form
✓ Copy of Omang
✓ Proof of ownership/lease
✓ Site plan (if applicable)

📞 Call 0800 600 111 for assistance`);
    }
}

// ========================================
// FEATURE 3: TARIFF CALCULATOR
// ========================================
async function tariffCalculator(to, usage) {
    const usageNum = parseFloat(usage);
    
    if (isNaN(usageNum) || !usage) {
        await sendWhatsApp(to, `💰 *WATER TARIFF CALCULATOR* 💰

*Domestic Tariffs (per month):*
0-10 m³: P5.50/m³
11-20 m³: P8.20/m³
21-40 m³: P12.00/m³
41+ m³: P18.50/m³

*Calculate your bill:*
Type *CALCULATE* followed by your usage
Example: CALCULATE 25

*Sample calculation for 25m³:*
First 10m³: 10 × P5.50 = P55.00
Next 10m³: 10 × P8.20 = P82.00
Last 5m³: 5 × P12.00 = P60.00
Total: P197.00 + VAT

*Commercial:* P15.00/m³ (all usage)
*Industrial:* P12.50/m³ (bulk rates available)

*Pensioners:* First 5m³ free
*Lifeline:* First 3m³ free for low-income

💡 Type *COMPARE* to see different usage scenarios`);
        return;
    }
    
    let cost = 0;
    let breakdown = '';
    
    if (usageNum <= 10) {
        cost = usageNum * 5.50;
        breakdown = `${usageNum}m³ @ P5.50 = P${cost.toFixed(2)}`;
    } else if (usageNum <= 20) {
        cost = (10 * 5.50) + ((usageNum - 10) * 8.20);
        breakdown = `First 10m³ @ P5.50 = P55.00\nNext ${usageNum - 10}m³ @ P8.20 = P${((usageNum - 10) * 8.20).toFixed(2)}`;
    } else if (usageNum <= 40) {
        cost = (10 * 5.50) + (10 * 8.20) + ((usageNum - 20) * 12.00);
        breakdown = `First 10m³ @ P5.50 = P55.00\nNext 10m³ @ P8.20 = P82.00\nRemaining ${usageNum - 20}m³ @ P12.00 = P${((usageNum - 20) * 12).toFixed(2)}`;
    } else {
        cost = (10 * 5.50) + (10 * 8.20) + (20 * 12.00) + ((usageNum - 40) * 18.50);
        breakdown = `First 10m³ @ P5.50 = P55.00\nNext 10m³ @ P8.20 = P82.00\nNext 20m³ @ P12.00 = P240.00\nRemaining ${usageNum - 40}m³ @ P18.50 = P${((usageNum - 40) * 18.50).toFixed(2)}`;
    }
    
    const vat = cost * 0.12;
    const total = cost + vat;
    
    await sendWhatsApp(to, `💰 *TARIFF CALCULATION* 💰

Usage: ${usageNum} m³

*Breakdown:*
${breakdown}

─────────────────
*Subtotal:* P${cost.toFixed(2)}
*VAT (12%):* P${vat.toFixed(2)}
*TOTAL DUE:* P${total.toFixed(2)}

*Compare:*
• 15m³: P${((10*5.50)+(5*8.20)).toFixed(2)} + VAT
• 30m³: P${((10*5.50)+(10*8.20)+(10*12)).toFixed(2)} + VAT
• 50m³: P${((10*5.50)+(10*8.20)+(20*12)+(10*18.50)).toFixed(2)} + VAT

💡 Type *PAY* to make a payment
📊 Type *CALCULATE* + number for another calculation`);
}

// ========================================
// FEATURE 4: FIND WUC OFFICE
// ========================================
async function findOffice(to, location) {
    if (location && offices[location]) {
        const office = offices[location];
        await sendWhatsApp(to, `📍 *WUC OFFICE LOCATOR* 📍

${office}

*Services available:*
✓ Bill payments
✓ New connections
✓ Fault reporting
✓ Account inquiries
✓ Meter readings
✓ Application submissions

*Send your location* to find the nearest office:
Tap 📎 → Location → Send Current Location

🗺️ *Full list:* www.wuc.bw/offices

📞 Customer Care: 0800 600 222 (24/7)`);
    } else {
        await sendWhatsApp(to, `📍 *WUC OFFICE LOCATOR* 📍

*Major Offices:*

🏢 *Gaborone (Headquarters)*
Gaborone International Commerce Park
🕐 Mon-Fri 8am-5pm

🏢 *Francistown*
Blue Jacket Street
🕐 Mon-Fri 8am-5pm

🏢 *Lobatse*
Main Mall
🕐 Mon-Fri 8am-4:30pm

🏢 *Selebi-Phikwe*
Industrial Area
🕐 Mon-Fri 8am-5pm

🏢 *Molepolole*
Kgosi Square
🕐 Mon & Wed 9am-3pm

*To get specific office details:*
Type *OFFICE* followed by city name
Example: OFFICE Francistown

*Send your location* for nearest office:
Tap 📎 → Location → Send Current Location

🗺️ www.wuc.bw/offices`);
    }
}

// ========================================
// FEATURE 5: WATER SAVING TIPS
// ========================================
async function waterSavingTips(to, category) {
    if (category === 'home') {
        await sendWhatsApp(to, `💡 *WATER SAVING TIPS - HOME* 💡

*Bathroom:*
✓ Take 5-minute showers (saves 20L/day)
✓ Turn off tap while brushing (saves 6L/min)
✓ Fix leaking toilets (saves 200L/day)
✓ Install water-efficient showerheads

*Kitchen:*
✓ Use dishwasher only when full
✓ Keep drinking water in fridge (no running tap)
✓ Wash vegetables in a bowl
✓ Compost food waste instead of using disposal

*Laundry:*
✓ Run full loads only
✓ Use water-efficient washing machine
✓ Reuse grey water for garden

*Potential savings:* 50L/day = ~P90/month

💡 Type *TIPS GARDEN* for outdoor tips
💡 Type *TIPS LEAKS* for leak detection
💡 Type *AUDIT* to schedule free water audit`);
    } else if (category === 'garden') {
        await sendWhatsApp(to, `💡 *WATER SAVING TIPS - GARDEN* 💡

*Watering:*
✓ Water early morning or late evening
✓ Use a watering can instead of hose
✓ Install drip irrigation
✓ Add mulch to reduce evaporation

*Plant Choice:*
✓ Use indigenous/drought-tolerant plants
✓ Group plants by water needs
✓ Reduce lawn area
✓ Use shade cloth for vegetables

*Rainwater Harvesting:*
✓ Install rain barrels
✓ Redirect downspouts to garden
✓ Use permeable paving

*Pool:*
✓ Use pool cover to reduce evaporation
✓ Check for leaks regularly

*Potential savings:* 100L/day = ~P180/month

💡 Type *TIPS HOME* for indoor tips
💡 Type *TIPS LEAKS* for leak detection
💡 Type *AUDIT* for free assessment`);
    } else if (category === 'leaks') {
        await sendWhatsApp(to, `💡 *LEAK DETECTION & FIXES* 💡

*How to detect leaks:*
✓ Check meter before/after 2 hours no use
✓ Listen for running water sounds
✓ Check for wet spots on walls/floor
✓ Use food coloring in toilet tank

*Common leak costs:*
• Dripping tap: P50-100/month
• Running toilet: P200-400/month
• Hidden pipe leak: P500+/month

*Quick fixes:*
✓ Replace tap washers (P5-10)
✓ Tighten connections
✓ Call plumber for major leaks

*Report leaks to WUC:*
Type *FAULT* or call 0800 600 222

*Free water audit:* Type *AUDIT* to schedule

💡 Fixing leaks saves water AND money!`);
    } else {
        await sendWhatsApp(to, `💡 *WATER SAVING TIPS* 💡
🇧🇼 *For Botswana's water security*

*Quick Wins:*
✓ Fix leaking taps (saves 15L/day)
✓ Take shorter showers (5 min max)
✓ Turn off tap while brushing (saves 6L/min)
✓ Use a bucket instead of hose for car washing

*Monthly Savings Potential:*
🏠 Home: Save 50L/day = ~P90/month
🌿 Garden: Save 100L/day = ~P180/month
🔧 Fix leaks: Save 200L/day = ~P360/month

*Free Resources:*
• Water-saving kit (request at office)
• DIY leak detection guide
• Indigenous plant list

*Get detailed tips:*
• Type *TIPS HOME* - Indoor savings
• Type *TIPS GARDEN* - Outdoor savings
• Type *TIPS LEAKS* - Leak detection
• Type *AUDIT* - Free water audit

*Every drop counts! 🇧🇼*

Report leaks: Type *FAULT* or call 0800 600 222`);
    }
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

Meter number "${meterNumber}" does not exist.

📋 *Valid test meters:*
• GBE-00412 (Gaborone)
• GBE-00891 (Gaborone)
• FTB-00234 (Francistown)
• LBE-00123 (Lobatse)

Type *MENU* to try again or call 0800 600 222.`);
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

Type *MENU* for other options.`);
    } else {
        await sendWhatsApp(to, `🔑 *METER REQUIRED* 🔑

Please enter your meter number first.
Example: GBE-00412`);
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

4️⃣ *MyZaka*
   Download app or visit myzaka.com

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

*A receipt has been sent to your registered email.*

Thank you for your payment!
🇧🇼 Water Utilities Corporation

Type *MENU* for other options.`);
    
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
    
    db.run(`INSERT INTO meter_readings (user_phone, meter_number, reading) VALUES (?, ?, ?)`,
        [to, meter, numReading]);
    
    await sendWhatsApp(to, `✅ *METER READING SUBMITTED* ✅

Meter: ${meter}
Reading: ${numReading} m³
Date: ${new Date().toLocaleDateString()}
Reference: MET-${Date.now().toString().slice(-8)}

*What happens next?*
• Our team will verify within 24 hours
• Your bill will be updated
• You'll receive confirmation

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

Please describe the problem:
• When did it start?
• How severe is it?
• Any other details

Type *CANCEL* to abort.`);
}

async function processFaultDescription(to, description) {
    const faultType = sessions[to]?.fault_type;
    
    db.run(`INSERT INTO faults (user_phone, fault_type, description, status) 
            VALUES (?, ?, ?, 'pending')`,
        [to, faultType, description]);
    
    await sendWhatsApp(to, `✅ *FAULT REPORTED SUCCESSFULLY* ✅

📋 Fault: ${faultType}
📝 Description: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}
🆔 Reference: WUC-${Date.now().toString().slice(-8)}
📅 Date: ${new Date().toLocaleDateString()}

*What happens next?*
• Our team has been notified
• Technician dispatched within 24 hours
• You'll receive updates here

📍 For faster service, please share your location.

Thank you for helping us improve!

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

*Average Monthly Usage:* 18 m³
*Average Monthly Bill:* P177.00

💡 *Need a detailed statement?*
Visit any WUC office or call 0800 600 222

Type *MENU* for other options.`);
}

// ========================================
// MAIN MESSAGE HANDLER
// ========================================
async function handleIncoming(from, text) {
    console.log(`📱 ${from}: "${text}"`);
    
    db.run(`INSERT INTO messages_log (user_phone, message, direction) VALUES (?, ?, 'incoming')`, [from, text]);
    db.run(`INSERT INTO users (phone, last_active) VALUES (?, CURRENT_TIMESTAMP) 
            ON CONFLICT(phone) DO UPDATE SET last_active=CURRENT_TIMESTAMP`, [from]);
    
    const lower = text.toLowerCase().trim();
    const session = sessions[from] || { step: 'menu' };
    sessions[from] = session;
    
    // Get user's area from database
    let userArea = 'Gaborone';
    db.get(`SELECT area FROM users WHERE phone = ?`, [from], (err, row) => {
        if (row && row.area) userArea = row.area;
    });
    
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
    
    // Alert subscriptions
    if (lower === 'alerts' || lower === 'alerts on') {
        await subscribeAlerts(from, 'on');
        return;
    }
    if (lower === 'alerts off') {
        await subscribeAlerts(from, 'off');
        return;
    }
    
    // Water supply status
    if (lower === 'status' || lower === 'water status' || lower === 'supply status') {
        await waterSupplyStatus(from, userArea);
        return;
    }
    
    // New connection
    if (lower === 'connect' || lower === 'new connection') {
        await newConnection(from, 'info');
        return;
    }
    if (lower === 'apply') {
        await newConnection(from, 'apply');
        return;
    }
    
    // Tariff calculator
    if (lower === 'tariff' || lower === 'rates') {
        await tariffCalculator(from, null);
        return;
    }
    if (lower.startsWith('calculate')) {
        const usage = text.split(' ')[1];
        await tariffCalculator(from, usage);
        return;
    }
    
    // Find office
    if (lower === 'office' || lower === 'find office' || lower === 'location') {
        await findOffice(from, null);
        return;
    }
    if (lower.startsWith('office ')) {
        const location = text.split(' ').slice(1).join(' ');
        await findOffice(from, location);
        return;
    }
    
    // Water saving tips
    if (lower === 'tips' || lower === 'water tips') {
        await waterSavingTips(from, null);
        return;
    }
    if (lower === 'tips home') {
        await waterSavingTips(from, 'home');
        return;
    }
    if (lower === 'tips garden') {
        await waterSavingTips(from, 'garden');
        return;
    }
    if (lower === 'tips leaks') {
        await waterSavingTips(from, 'leaks');
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
                db.run(`UPDATE users SET meter_number = ?, area = ? WHERE phone = ?`, [meter, account.area, from]);
                await sendWhatsApp(from, `✅ *ACCOUNT LINKED* ✅

Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance}
Area: ${account.area}

Type *MENU* for options
Type *STATUS* for water supply in ${account.area}`);
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
            db.run(`UPDATE users SET meter_number = ?, area = ? WHERE phone = ?`, [meter, account.area, from]);
            await sendWhatsApp(from, `✅ *METER LINKED* ✅

Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance}
Area: ${account.area}

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

Please enter your meter number.
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

Please enter your meter number.
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
    
    if (lower === '6' || lower === 'water status' || lower === 'supply') {
        await waterSupplyStatus(from, userArea);
        return;
    }
    
    if (lower === '7' || lower === 'connect' || lower === 'new connection') {
        await newConnection(from, 'info');
        return;
    }
    
    if (lower === '8' || lower === 'tariff' || lower === 'calculate') {
        await tariffCalculator(from, null);
        return;
    }
    
    if (lower === '9' || lower === 'office' || lower === 'find office') {
        await findOffice(from, null);
        return;
    }
    
    if (lower === '10' || lower === 'tips' || lower === 'water tips') {
        await waterSavingTips(from, null);
        return;
    }
    
    // Default response
    await sendWhatsApp(from, `❌ *COMMAND NOT RECOGNIZED* ❌

I didn't understand "${text}".

📋 Type *MENU* to see all options
🆘 Type *HELP* for assistance
📞 Call our hotline: 0800 600 222

*Quick commands:*
• STATUS - Water supply in your area
• TARIFF - Water rates
• OFFICE - Find WUC branch
• TIPS - Water saving advice
• CONNECT - New connection info`);
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
                db.get(`SELECT COUNT(*) as connections FROM new_connections WHERE status='pending'`, (err, connections) => {
                    res.json({ 
                        totalUsers: users?.users || 0, 
                        pendingFaults: faults?.faults || 0,
                        pendingReadings: readings?.readings || 0,
                        pendingConnections: connections?.connections || 0
                    });
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
    console.log(`\n💡 New Features Added:`);
    console.log(`   6️⃣ Water Supply Status`);
    console.log(`   7️⃣ New Connection`);
    console.log(`   8️⃣ Tariff Calculator`);
    console.log(`   9️⃣ Find WUC Office`);
    console.log(`   🔟 Water Saving Tips`);
});
