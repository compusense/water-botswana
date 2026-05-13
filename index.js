require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Sessions and test accounts
const sessions = {};
const accounts = {
    'GBE-00412': { name: 'Kefilwe Moyo', balance: 247.50, address: 'Gaborone West' },
    'GBE-00891': { name: 'Thabo Sithole', balance: 0, address: 'Gaborone North' },
    'FTB-00234': { name: 'Mpho Nkwe', balance: 512.00, address: 'Francistown' }
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
        console.log(`✓ Sent to ${to}`);
    } catch (error) {
        console.error('✗ Send error:', error.response?.data || error.message);
    }
}

// Process incoming messages
async function handleMessage(from, text) {
    console.log(`📱 ${from}: "${text}"`);
    
    if (!sessions[from]) {
        sessions[from] = { step: 'idle', meter: null };
    }
    
    const session = sessions[from];
    const msg = text.toLowerCase().trim();
    
    // Menu command
    if (msg === 'hi' || msg === 'menu' || msg === 'help') {
        await sendMessage(from, `💧 *WATER UTILITY BOTSWANA*
        
1️⃣ Balance
2️⃣ Pay Bill
3️⃣ Meter Reading  
4️⃣ Report Fault

Reply with number or command.`);
        return;
    }
    
    // Handle meter number entry
    if (session.step === 'awaiting_meter') {
        const meter = text.toUpperCase();
        const account = accounts[meter];
        
        if (account) {
            session.meter = meter;
            session.step = 'idle';
            await sendMessage(from, `✅ Account found!
Meter: ${meter}
Name: ${account.name}
Balance: P${account.balance}
Address: ${account.address}
Type "menu" for options.`);
        } else {
            await sendMessage(from, `❌ Meter "${meter}" not found.
Try: GBE-00412, GBE-00891, FTB-00234`);
        }
        return;
    }
    
    // Handle reading submission
    if (session.step === 'awaiting_reading') {
        const reading = parseFloat(text);
        if (!isNaN(reading)) {
            await sendMessage(from, `✅ Reading submitted: ${reading} m³
Reference: ${Date.now().toString().slice(-8)}
Thank you!`);
            session.step = 'idle';
        } else {
            await sendMessage(from, `Please send a number (e.g., 12345) or photo.`);
        }
        return;
    }
    
    // Handle payment amount
    if (session.step === 'awaiting_payment') {
        const amount = parseFloat(text);
        if (!isNaN(amount) && amount > 0) {
            await sendMessage(from, `💳 Payment of P${amount}
Pay via Orange Money: Dial *151#
Send "paid" when done.`);
            session.step = 'awaiting_confirmation';
            session.amount = amount;
        } else {
            await sendMessage(from, `Please enter a valid amount.`);
        }
        return;
    }
    
    // Handle payment confirmation
    if (session.step === 'awaiting_confirmation') {
        if (msg === 'paid') {
            await sendMessage(from, `✅ Payment confirmed!
Reference: ${Date.now().toString().slice(-8)}
Thank you!`);
            session.step = 'idle';
        } else {
            await sendMessage(from, `Send "paid" when payment is complete.`);
        }
        return;
    }
    
    // Handle fault report
    if (session.step === 'awaiting_fault') {
        await sendMessage(from, `🚨 Fault reported: "${text}"
Reference: ${Date.now().toString().slice(-8)}
Technician will be dispatched.`);
        session.step = 'idle';
        return;
    }
    
    // Main commands
    if (msg === '1' || msg === 'balance') {
        if (session.meter) {
            const acc = accounts[session.meter];
            await sendMessage(from, `💰 Balance: P${acc.balance}
Due: End of month`);
        } else {
            await sendMessage(from, `Enter your meter number (e.g., GBE-00412):`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    if (msg === '2' || msg === 'pay') {
        if (session.meter) {
            const acc = accounts[session.meter];
            if (acc.balance > 0) {
                await sendMessage(from, `Amount due: P${acc.balance}
How much to pay?`);
                session.step = 'awaiting_payment';
            } else {
                await sendMessage(from, `No balance due.`);
            }
        } else {
            await sendMessage(from, `Enter meter number first:`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    if (msg === '3' || msg === 'reading') {
        if (session.meter) {
            await sendMessage(from, `Send your meter reading (number) or photo:`);
            session.step = 'awaiting_reading';
        } else {
            await sendMessage(from, `Enter meter number first:`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    if (msg === '4' || msg === 'fault') {
        await sendMessage(from, `Describe the problem:`);
        session.step = 'awaiting_fault';
        return;
    }
    
    // Direct meter number entry
    const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
    if (meterMatch) {
        const meter = meterMatch[0];
        const account = accounts[meter];
        if (account) {
            session.meter = meter;
            await sendMessage(from, `✅ Linked to ${meter}
Name: ${account.name}
Balance: P${account.balance}
Type "menu" for options.`);
        }
        return;
    }
    
    // Default
    await sendMessage(from, `Type "menu" for options or enter meter number (e.g., GBE-00412)`);
}

// Webhook endpoints
app.get('/webhook', (req, res) => {
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (token === process.env.VERIFY_TOKEN) {
        console.log('✓ Webhook verified');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object === 'whatsapp_business_account') {
            const msg = body.entry[0].changes[0].value.messages?.[0];
            if (msg && msg.type === 'text') {
                await handleMessage(msg.from, msg.text.body);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error(error);
        res.sendStatus(200);
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'running', service: 'Botswana Water Bot' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});
