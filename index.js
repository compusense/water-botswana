require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ========================================
// DATA
// ========================================
const sessions = {};
const accounts = {
    'GBE-00412': { name: 'Kefilwe Moyo', balance: 247.50, address: 'Gaborone West' },
    'GBE-00891': { name: 'Thabo Sithole', balance: 0, address: 'Gaborone North' },
    'FTB-00234': { name: 'Mpho Nkwe', balance: 512.00, address: 'Francistown' }
};

// ========================================
// WHATSAPP FUNCTIONS
// ========================================
async function sendWhatsAppMessage(to, message) {
    try {
        const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
        
        await axios.post(url, {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: message }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`✓ Message sent to ${to}`);
        return true;
    } catch (error) {
        console.error('✗ Failed to send message:', error.response?.data || error.message);
        return false;
    }
}

// ========================================
// BOT LOGIC
// ========================================
async function processMessage(userPhone, userMessage) {
    console.log(`📱 ${userPhone}: "${userMessage}"`);
    
    // Initialize session
    if (!sessions[userPhone]) {
        sessions[userPhone] = { step: 'idle', meter: null };
    }
    
    const session = sessions[userPhone];
    const msg = userMessage.toLowerCase().trim();
    
    // HELP / MENU command
    if (msg === 'hi' || msg === 'menu' || msg === 'help' || msg === 'start') {
        const menu = `💧 *WATER UTILITY BOTSWANA* 💧

Choose an option:

1️⃣ *Check Balance*
2️⃣ *Pay Bill*
3️⃣ *Meter Reading*
4️⃣ *Report Fault*

Simply reply with the number or command.

Example: "balance" or "1"

Need help? Reply "menu" anytime.`;
        
        await sendWhatsAppMessage(userPhone, menu);
        return;
    }
    
    // Step 1: Asking for meter number
    if (session.step === 'awaiting_meter') {
        const meterNumber = userMessage.toUpperCase();
        const account = accounts[meterNumber];
        
        if (account) {
            session.meter = meterNumber;
            session.step = 'idle';
            await sendWhatsAppMessage(userPhone, 
                `✅ *ACCOUNT FOUND*

Meter: ${meterNumber}
Name: ${account.name}
Balance: P${account.balance}
Address: ${account.address}

Type "menu" for options or "balance" to see your balance again.`);
        } else {
            await sendWhatsAppMessage(userPhone,
                `❌ *METER NOT FOUND*

"Meter ${meterNumber}" does not exist.

Try one of these test meters:
• GBE-00412
• GBE-00891
• FTB-00234

Type "menu" to cancel.`);
        }
        return;
    }
    
    // Step 2: Asking for meter reading
    if (session.step === 'awaiting_reading') {
        const reading = parseFloat(userMessage);
        
        if (!isNaN(reading) && reading > 0) {
            await sendWhatsAppMessage(userPhone,
                `✅ *READING SUBMITTED*

Meter: ${session.meter || 'Not linked'}
Reading: ${reading} m³
Date: ${new Date().toLocaleDateString()}
Reference: REF-${Date.now().toString().slice(-8)}

Thank you for your submission!`);
            
            session.step = 'idle';
        } else {
            await sendWhatsAppMessage(userPhone,
                `Please send a NUMBER (e.g., 12345) or send a PHOTO of your meter.

Type "cancel" to go back.`);
        }
        return;
    }
    
    // Step 3: Asking for payment amount
    if (session.step === 'awaiting_payment') {
        const amount = parseFloat(userMessage);
        
        if (!isNaN(amount) && amount > 0) {
            await sendWhatsAppMessage(userPhone,
                `💳 *PAYMENT INSTRUCTIONS*

Amount: P${amount.toFixed(2)}

Payment Options:
1️⃣ Orange Money: Dial *151#
2️⃣ Bank Transfer: Account 0123456789

Send "paid" after completing payment.
Send "cancel" to abort.`);
            
            session.step = 'awaiting_confirmation';
            session.pendingAmount = amount;
        } else {
            await sendWhatsAppMessage(userPhone,
                `Please enter a valid amount (e.g., 247.50)

Type "cancel" to cancel.`);
        }
        return;
    }
    
    // Step 4: Waiting for payment confirmation
    if (session.step === 'awaiting_confirmation') {
        if (msg === 'paid') {
            await sendWhatsAppMessage(userPhone,
                `✅ *PAYMENT CONFIRMED*

Amount: P${session.pendingAmount?.toFixed(2) || '0'}
Reference: PAY-${Date.now().toString().slice(-8)}
Date: ${new Date().toLocaleDateString()}

Thank you for your payment!
A receipt has been sent to your email.`);
            
            session.step = 'idle';
            session.pendingAmount = null;
        } else if (msg === 'cancel') {
            await sendWhatsAppMessage(userPhone, `❌ Payment cancelled. Type "menu" for options.`);
            session.step = 'idle';
        } else {
            await sendWhatsAppMessage(userPhone, `Type "paid" when done or "cancel" to abort.`);
        }
        return;
    }
    
    // Step 5: Waiting for fault description
    if (session.step === 'awaiting_fault') {
        await sendWhatsAppMessage(userPhone,
            `🚨 *FAULT REPORTED*

Description: ${userMessage}
Reference: FLT-${Date.now().toString().slice(-8)}
Status: Dispatched

A technician will contact you within 24 hours.
Please share your location when possible.`);
        
        session.step = 'idle';
        return;
    }
    
    // ========================================
    // MAIN MENU COMMANDS
    // ========================================
    
    // COMMAND 1: CHECK BALANCE
    if (msg === '1' || msg === 'balance' || msg === 'check balance') {
        if (session.meter) {
            const account = accounts[session.meter];
            await sendWhatsAppMessage(userPhone,
                `💰 *CURRENT BALANCE*

Meter: ${session.meter}
Name: ${account.name}
Balance: P${account.balance}
Due Date: End of month

Type "pay" to make a payment.`);
        } else {
            await sendWhatsAppMessage(userPhone,
                `🔑 *METER REQUIRED*

Please enter your meter number.
Example: GBE-00412`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // COMMAND 2: PAY BILL
    if (msg === '2' || msg === 'pay' || msg === 'pay bill') {
        if (session.meter) {
            const account = accounts[session.meter];
            
            if (account.balance > 0) {
                await sendWhatsAppMessage(userPhone,
                    `💰 *PAYMENT*

Meter: ${session.meter}
Amount Due: P${account.balance}

How much would you like to pay?`);
                session.step = 'awaiting_payment';
            } else {
                await sendWhatsAppMessage(userPhone,
                    `✅ *NO BALANCE*

Your account is fully paid up.
Thank you for being a responsible customer!`);
            }
        } else {
            await sendWhatsAppMessage(userPhone,
                `🔑 *METER REQUIRED*

Please enter your meter number first.
Example: GBE-00412`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // COMMAND 3: METER READING
    if (msg === '3' || msg === 'reading' || msg === 'meter reading') {
        if (session.meter) {
            await sendWhatsAppMessage(userPhone,
                `📸 *SUBMIT METER READING*

Option 1: Type your reading as a number
Example: 12345

Option 2: Send a photo of your meter

Current meter: ${session.meter}`);
            session.step = 'awaiting_reading';
        } else {
            await sendWhatsAppMessage(userPhone,
                `🔑 *METER REQUIRED*

Please enter your meter number first.
Example: GBE-00412`);
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // COMMAND 4: REPORT FAULT
    if (msg === '4' || msg === 'fault' || msg === 'report fault') {
        await sendWhatsAppMessage(userPhone,
            `🚨 *REPORT FAULT*

Please describe the problem:

• Burst pipe
• No water flow
• Low pressure
• Leakage
• Dirty water

Type your description:`);
        session.step = 'awaiting_fault';
        return;
    }
    
    // CANCEL COMMAND
    if (msg === 'cancel') {
        session.step = 'idle';
        await sendWhatsAppMessage(userPhone, `❌ Cancelled. Type "menu" for options.`);
        return;
    }
    
    // DIRECT METER NUMBER ENTRY
    const meterMatch = userMessage.toUpperCase().match(/[A-Z]{3}-\d{5}/);
    if (meterMatch) {
        const meterNumber = meterMatch[0];
        const account = accounts[meterNumber];
        
        if (account) {
            session.meter = meterNumber;
            await sendWhatsAppMessage(userPhone,
                `✅ *ACCOUNT LINKED*

Meter: ${meterNumber}
Name: ${account.name}
Balance: P${account.balance}

Type "menu" for options.`);
        } else {
            await sendWhatsAppMessage(userPhone,
                `❌ Meter "${meterNumber}" not found.
Try: GBE-00412, GBE-00891, or FTB-00234`);
        }
        return;
    }
    
    // DEFAULT: UNKNOWN COMMAND
    await sendWhatsAppMessage(userPhone,
        `I didn't understand "${userMessage}".

Type "menu" to see available options.`);
}

// ========================================
// WEBHOOK HANDLERS
// ========================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('✓ Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        console.log('✗ Webhook verification failed');
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry[0];
            const changes = entry.changes[0];
            const value = changes.value;
            
            if (value.messages && value.messages[0]) {
                const message = value.messages[0];
                const from = message.from;
                const type = message.type;
                
                if (type === 'text') {
                    await processMessage(from, message.text.body);
                } 
                else if (type === 'location') {
                    await processMessage(from, `Location: ${message.location.latitude}, ${message.location.longitude}`);
                }
                else if (type === 'image') {
                    await processMessage(from, '[Photo of meter reading]');
                }
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.sendStatus(200);
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'active',
        service: 'Botswana Water Utility WhatsApp Bot',
        version: '2.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`✓ WhatsApp bot ready`);
});
