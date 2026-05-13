require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ========================================
// SESSIONS & DATABASE
// ========================================
const sessions = {};
const accounts = {
    'GBE-00412': { name: 'Kefilwe Moyo', balance: 247.50, address: 'Gaborone West', area: 'Gaborone' },
    'GBE-00891': { name: 'Thabo Sithole', balance: 0, address: 'Gaborone North', area: 'Gaborone' },
    'FTB-00234': { name: 'Mpho Nkwe', balance: 512.00, address: 'Francistown', area: 'Francistown' },
    'LBE-00123': { name: 'Botswana Water Corp', balance: 189.50, address: 'Lobatse', area: 'Lobatse' },
    'GBE-00999': { name: 'Demo Customer', balance: 75.25, address: 'Gaborone CBD', area: 'Gaborone' }
};

// Fault types with emojis
const faultTypes = {
    '1': { emoji: '💥', name: 'Burst Pipe', description: 'Water gushing/leaking heavily' },
    '2': { emoji: '🚱', name: 'No Water Flow', description: 'No water coming from taps' },
    '3': { emoji: '📉', name: 'Low Pressure', description: 'Weak water flow' },
    '4': { emoji: '💧', name: 'Leakage', description: 'Small leak or drip' },
    '5': { emoji: '🏾', name: 'Dirty Water', description: 'Brown/discolored water' },
    '6': { emoji: '🔊', name: 'Meter Issue', description: 'Meter not working' },
    '7': { emoji: '🆘', name: 'Other', description: 'Other problem' }
};

// ========================================
// SEND MESSAGE FUNCTIONS
// ========================================
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

// Add this function to your bot's index.js
async function sendToDashboard(phone, message, direction, meterNumber = null, faultData = null, readingData = null) {
    try {
        // Use your Railway dashboard URL
        const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3001';
        await axios.post(`${dashboardUrl}/api/ingest`, {
            phone, message, direction, meterNumber, faultData, readingData
        });
        console.log(`📊 Data sent to dashboard`);
    } catch(error) {
        console.log(`⚠️ Dashboard not available: ${error.message}`);
    }
}

// Send interactive list menu
async function sendListMenu(to, title, body, sections, buttonText = '📋 Select Option') {
    try {
        const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
        
        const menu = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'list',
                header: { type: 'text', text: title },
                body: { text: body },
                footer: { text: '🇧🇼 Botswana Water Utility' },
                action: {
                    button: buttonText,
                    sections: sections
                }
            }
        };
        
        await axios.post(url, menu, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ List menu sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Menu error:', error.response?.data || error.message);
        return false;
    }
}

// Send button reply menu
async function sendButtonMenu(to, bodyText, buttons) {
    try {
        const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
        
        const menu = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: bodyText },
                action: {
                    buttons: buttons.map((btn, idx) => ({
                        type: 'reply',
                        reply: { id: `btn_${idx}`, title: btn.title }
                    }))
                }
            }
        };
        
        await axios.post(url, menu, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Button menu sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Button error:', error.response?.data || error.message);
        return false;
    }
}

// Send request for location
async function requestLocation(to) {
    try {
        const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
        
        const request = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'location_request_message',
                body: { text: '📍 Please share your location so we can dispatch a technician to the right place.' },
                action: { name: 'send_location' }
            }
        };
        
        await axios.post(url, request, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Location request sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Location error:', error.response?.data || error.message);
        return false;
    }
}

// ========================================
// MAIN MENU
// ========================================
async function showMainMenu(to) {
    const sections = [
        {
            title: '💧 Water Services',
            rows: [
                { id: 'balance', title: '💰 Check Balance', description: 'View your current water bill' },
                { id: 'pay', title: '💳 Pay Bill', description: 'Make a payment' },
                { id: 'reading', title: '📸 Submit Reading', description: 'Send meter reading with photo' }
            ]
        },
        {
            title: '🚨 Emergency & Support',
            rows: [
                { id: 'fault', title: '🔧 Report Fault', description: 'Burst pipe, leak, no water' },
                { id: 'history', title: '📜 Payment History', description: 'View past transactions' },
                { id: 'contact', title: '📞 Contact Us', description: 'Customer support info' }
            ]
        },
        {
            title: 'ℹ️ Account',
            rows: [
                { id: 'link', title: '🔗 Link Meter', description: 'Connect your meter number' },
                { id: 'status', title: '📊 Service Status', description: 'Check water supply status' }
            ]
        }
    ];
    
    await sendListMenu(to, '💧 WATER UTILITY BOTSWANA', 'Welcome! What would you like to do today?', sections, '📋 MAIN MENU');
}

// ========================================
// FAULT SUBMENU
// ========================================
async function showFaultMenu(to) {
    const sections = [{
        title: '🚨 Select Fault Type',
        rows: [
            { id: 'fault_1', title: '💥 Burst Pipe', description: 'Water gushing/leaking heavily' },
            { id: 'fault_2', title: '🚱 No Water Flow', description: 'No water coming from taps' },
            { id: 'fault_3', title: '📉 Low Pressure', description: 'Weak water flow' },
            { id: 'fault_4', title: '💧 Leakage', description: 'Small leak or drip' },
            { id: 'fault_5', title: '🏾 Dirty Water', description: 'Brown/discolored water' },
            { id: 'fault_6', title: '🔊 Meter Issue', description: 'Meter not working' },
            { id: 'fault_7', title: '🆘 Other', description: 'Other problem' }
        ]
    }];
    
    await sendListMenu(to, '🔧 REPORT A FAULT', 'Please select the type of fault you are experiencing:', sections, '🚨 SELECT FAULT');
}

// ========================================
// PAYMENT SUBMENU
// ========================================
async function showPaymentMenu(to, balance) {
    await sendButtonMenu(to, `💰 Amount Due: P${balance}\n\nHow would you like to pay?`, [
        { title: 'Orange Money' },
        { title: 'Bank Transfer' },
        { title: 'In Person' },
        { title: 'Cancel' }
    ]);
}

// ========================================
// MAIN HANDLER
// ========================================
async function handleMessage(from, message, msgType, mediaInfo = null) {
    console.log(`📱 ${from} [${msgType}]: ${msgType === 'text' ? message?.body : msgType}`);
    
    // Initialize session
    if (!sessions[from]) {
        sessions[from] = { step: 'menu', meter: null, faultType: null, context: {} };
    }
    
    const session = sessions[from];
    
    // ========================================
    // HANDLE MEDIA ATTACHMENTS
    // ========================================
    
    // Handle location sharing
    if (msgType === 'location') {
        const lat = mediaInfo.latitude;
        const lng = mediaInfo.longitude;
        
        await sendMessage(from, 
            `📍 *LOCATION RECEIVED* 📍\n\n` +
            `Coordinates: ${lat}, ${lng}\n` +
            `🗺️ Map: https://maps.google.com/?q=${lat},${lng}\n\n` +
            `✅ *FAULT REPORT COMPLETE*\n\n` +
            `📋 Fault Type: ${session.faultType?.name || 'Not specified'}\n` +
            `🆔 Reference: BWT-${Date.now().toString().slice(-8)}\n` +
            `👷 Status: Dispatched\n\n` +
            `A technician will be at your location within 24 hours.\n\n` +
            `Thank you for helping us improve service in Botswana! 🇧🇼`
        );
        
        session.step = 'menu';
        await showMainMenu(from);
        return;
    }
    
    // Handle image (meter reading)
    if (msgType === 'image') {
        await sendMessage(from,
            `📸 *METER READING RECEIVED* 📸\n\n` +
            `✅ Reference: MET-${Date.now().toString().slice(-8)}\n` +
            `📅 Date: ${new Date().toLocaleDateString()}\n\n` +
            `Thank you for submitting your meter reading!\n` +
            `We'll update your account within 24 hours.\n\n` +
            `💡 Tip: For faster processing, also type your reading number.`
        );
        
        session.step = 'menu';
        await showMainMenu(from);
        return;
    }
    
    // Handle voice note
    if (msgType === 'audio' || msgType === 'voice') {
        await sendMessage(from,
            `🎙️ *VOICE NOTE RECEIVED* 🎙️\n\n` +
            `✅ Reference: VN-${Date.now().toString().slice(-8)}\n\n` +
            `We've received your voice message regarding the fault.\n` +
            `Our team will review it and contact you shortly.\n\n` +
            `📞 For urgent issues, please call our hotline: 0800 600 222`
        );
        
        session.step = 'menu';
        await showMainMenu(from);
        return;
    }
    
    // Get text message
    let text = '';
    let interactiveId = '';
    
    if (msgType === 'text') {
        text = message?.body?.toLowerCase().trim() || '';
    } else if (msgType === 'interactive') {
        interactiveId = message?.list_reply?.id || message?.button_reply?.id || '';
        text = interactiveId.toLowerCase();
        console.log(`🎯 Interactive selection: "${interactiveId}"`);
    }
    
    // ========================================
    // STATE MACHINE
    // ========================================
    
    // State: Awaiting meter number for linking
    if (session.step === 'awaiting_meter') {
        const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
        if (meterMatch) {
            const meter = meterMatch[0];
            const account = accounts[meter];
            
            if (account) {
                session.meter = meter;
                session.step = 'menu';
                await sendMessage(from,
                    `✅ *ACCOUNT LINKED SUCCESSFULLY* ✅\n\n` +
                    `📋 Meter Number: ${meter}\n` +
                    `👤 Account Name: ${account.name}\n` +
                    `📍 Address: ${account.address}\n` +
                    `🏙️ Area: ${account.area}\n` +
                    `💰 Current Balance: P${account.balance.toFixed(2)}\n\n` +
                    `What would you like to do today?`
                );
                await showMainMenu(from);
            } else {
                await sendMessage(from,
                    `❌ *METER NOT FOUND* ❌\n\n` +
                    `"${meter}" does not exist in our system.\n\n` +
                    `📋 Valid test meters:\n` +
                    `• GBE-00412 (Gaborone)\n` +
                    `• FTB-00234 (Francistown)\n` +
                    `• LBE-00123 (Lobatse)\n\n` +
                    `Please try again or type "menu" to cancel.`
                );
            }
        } else if (text === 'menu') {
            session.step = 'menu';
            await showMainMenu(from);
        } else {
            await sendMessage(from,
                `🔑 *ENTER YOUR METER NUMBER* 🔑\n\n` +
                `Please enter your meter number in this format:\n` +
                `[Area Code]-[5 digits]\n\n` +
                `📝 Examples:\n` +
                `• GBE-00412 (Gaborone)\n` +
                `• FTB-00234 (Francistown)\n` +
                `• LBE-00123 (Lobatse)\n\n` +
                `Type "menu" to cancel.`
            );
        }
        return;
    }
    
    // State: Awaiting payment amount
    if (session.step === 'awaiting_payment_amount') {
        const amount = parseFloat(text);
        if (!isNaN(amount) && amount > 0) {
            await sendMessage(from,
                `💳 *PAYMENT INSTRUCTIONS* 💳\n\n` +
                `Amount: P${amount.toFixed(2)}\n\n` +
                `📱 *Orange Money:* Dial *151# and follow prompts\n` +
                `🏦 *Bank Transfer:* Account 0123456789 (Botswana Water Corp)\n` +
                `🏢 *In Person:* Any Botswana Water office\n\n` +
                `✅ Send "PAID" after completing payment.\n` +
                `❌ Send "CANCEL" to abort.`
            );
            session.step = 'awaiting_payment_confirmation';
            session.pendingAmount = amount;
        } else {
            await sendMessage(from,
                `💰 *ENTER PAYMENT AMOUNT* 💰\n\n` +
                `Please enter the amount you want to pay.\n` +
                `📝 Example: 247.50\n\n` +
                `Or type "cancel" to go back.`
            );
        }
        return;
    }
    
    // State: Awaiting payment confirmation
    if (session.step === 'awaiting_payment_confirmation') {
        if (text === 'paid') {
            await sendMessage(from,
                `✅ *PAYMENT CONFIRMED* ✅\n\n` +
                `💰 Amount: P${session.pendingAmount?.toFixed(2) || '0'}\n` +
                `🆔 Reference: PAY-${Date.now().toString().slice(-8)}\n` +
                `📅 Date: ${new Date().toLocaleDateString()}\n\n` +
                `Thank you for your payment!\n` +
                `A receipt has been sent to your registered email.\n\n` +
                `🇧🇼 Thank you for being a responsible customer!`
            );
            session.step = 'menu';
            session.pendingAmount = null;
            await showMainMenu(from);
        } else if (text === 'cancel') {
            await sendMessage(from, `❌ Payment cancelled. Returning to main menu.`);
            session.step = 'menu';
            await showMainMenu(from);
        } else {
            await sendMessage(from, `Type "PAID" when payment is complete or "CANCEL" to abort.`);
        }
        return;
    }
    
    // State: Awaiting meter reading
    if (session.step === 'awaiting_reading') {
        const reading = parseFloat(text);
        if (!isNaN(reading) && reading > 0) {
            await sendMessage(from,
                `✅ *METER READING SUBMITTED* ✅\n\n` +
                `📊 Reading: ${reading} m³\n` +
                `📅 Date: ${new Date().toLocaleDateString()}\n` +
                `🆔 Reference: RD-${Date.now().toString().slice(-8)}\n\n` +
                `Thank you for your submission!\n` +
                `💡 Tip: You can also send a PHOTO of your meter for verification.`
            );
            session.step = 'menu';
            await showMainMenu(from);
        } else {
            await sendMessage(from,
                `📸 *SUBMIT METER READING* 📸\n\n` +
                `Option 1️⃣: Type your current reading as a number\n` +
                `📝 Example: 12345\n\n` +
                `Option 2️⃣: Send a PHOTO of your meter\n` +
                `📱 Tap 📎 → Camera to take a photo\n\n` +
                `Type "menu" to cancel.`
            );
        }
        return;
    }
    
    // ========================================
    // MENU HANDLING
    // ========================================
    
    // Welcome / Main Menu
    if (text === 'menu' || text === 'hi' || text === 'hello' || text === 'start' || text === 'menu') {
        await showMainMenu(from);
        return;
    }
    
    // CHECK BALANCE
    if (text === 'balance' || interactiveId === 'balance') {
        if (session.meter) {
            const account = accounts[session.meter];
            await sendMessage(from,
                `💰 *CURRENT WATER BILL* 💰\n\n` +
                `📋 Meter: ${session.meter}\n` +
                `👤 Name: ${account.name}\n` +
                `📍 Address: ${account.address}\n` +
                `─────────────────\n` +
                `💵 Balance: P${account.balance.toFixed(2)}\n` +
                `📅 Due Date: End of month\n` +
                `⚠️ Late Fee: 5% after due date\n` +
                `─────────────────\n\n` +
                `Type "PAY" to make a payment or "MENU" for options.`
            );
        } else {
            await sendMessage(from,
                `🔑 *METER NUMBER REQUIRED* 🔑\n\n` +
                `Please enter your meter number to check your balance.\n` +
                `📝 Example: GBE-00412`
            );
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // PAY BILL
    if (text === 'pay' || text === 'pay bill' || interactiveId === 'pay') {
        if (session.meter) {
            const account = accounts[session.meter];
            if (account.balance > 0) {
                await sendMessage(from,
                    `💰 *PAYMENT PORTAL* 💰\n\n` +
                    `📋 Meter: ${session.meter}\n` +
                    `💵 Outstanding Balance: P${account.balance.toFixed(2)}\n\n` +
                    `How much would you like to pay?`
                );
                session.step = 'awaiting_payment_amount';
            } else {
                await sendMessage(from,
                    `✅ *NO OUTSTANDING BALANCE* ✅\n\n` +
                    `Your account is fully paid up.\n` +
                    `Thank you for being a responsible customer! 🇧🇼`
                );
            }
        } else {
            await sendMessage(from,
                `🔑 *METER NUMBER REQUIRED* 🔑\n\n` +
                `Please enter your meter number to make a payment.\n` +
                `📝 Example: GBE-00412`
            );
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // SUBMIT METER READING
    if (text === 'reading' || text === 'meter reading' || interactiveId === 'reading') {
        if (session.meter) {
            await sendMessage(from,
                `📸 *SUBMIT METER READING* 📸\n\n` +
                `📋 Meter: ${session.meter}\n\n` +
                `Please send your current meter reading:\n` +
                `1️⃣ Type the number (e.g., 12345)\n` +
                `2️⃣ Or send a PHOTO of your meter\n\n` +
                `📱 Tap 📎 → Camera to take a photo`
            );
            session.step = 'awaiting_reading';
        } else {
            await sendMessage(from,
                `🔑 *METER NUMBER REQUIRED* 🔑\n\n` +
                `Please enter your meter number first.\n` +
                `📝 Example: GBE-00412`
            );
            session.step = 'awaiting_meter';
        }
        return;
    }
    
    // REPORT FAULT - Show fault types menu
    if (text === 'fault' || text === 'report fault' || interactiveId === 'fault') {
        await showFaultMenu(from);
        return;
    }
    
    // Handle fault type selection
    if (interactiveId.startsWith('fault_')) {
        const faultNum = interactiveId.split('_')[1];
        const fault = faultTypes[faultNum];
        
        if (fault) {
            session.faultType = fault;
            
            await sendMessage(from,
                `🔧 *FAULT REPORTING* 🔧\n\n` +
                `Selected: ${fault.emoji} ${fault.name}\n` +
                `Description: ${fault.description}\n\n` +
                `📋 Step 1 of 3: Fault type recorded ✅\n\n` +
                `📍 Step 2: Please share your location\n` +
                `📱 Tap 📎 → Location → Send Current Location\n\n` +
                `🎙️ You can also send a VOICE NOTE describing the issue.\n` +
                `📸 Or send a PHOTO of the problem.`
            );
            
            session.step = 'awaiting_fault_location';
        }
        return;
    }
    
    // Handle fault description from text (if user types instead of selects)
    if (session.step === 'awaiting_fault_description') {
        session.faultType = { name: 'Custom Report', emoji: '📝' };
        await sendMessage(from,
            `🔧 *FAULT REPORTED* 🔧\n\n` +
            `Issue: ${text}\n\n` +
            `📍 Please share your location:\n` +
            `📱 Tap 📎 → Location → Send Current Location\n\n` +
            `🎙️ You can also send a VOICE NOTE or PHOTO.`
        );
        session.step = 'awaiting_fault_location';
        return;
    }
    
    // Payment History
    if (text === 'history' || text === 'payment history' || interactiveId === 'history') {
        await sendMessage(from,
            `📜 *PAYMENT HISTORY* 📜\n\n` +
            `Recent transactions:\n` +
            `─────────────────\n` +
            `🗓️ April 2026: P247.50 ✅\n` +
            `🗓️ March 2026: P189.00 ✅\n` +
            `🗓️ February 2026: P210.50 ✅\n` +
            `🗓️ January 2026: P195.00 ✅\n` +
            `─────────────────\n\n` +
            `💡 Full history available at our office or upon request.\n` +
            `📞 Customer Care: 0800 600 222`
        );
        return;
    }
    
    // Link Meter
    if (text === 'link' || text === 'link meter' || interactiveId === 'link') {
        await sendMessage(from,
            `🔗 *LINK YOUR METER NUMBER* 🔗\n\n` +
            `Please enter your meter number in this format:\n` +
            `[Area Code]-[5 digits]\n\n` +
            `📝 Examples:\n` +
            `• GBE-00412 (Gaborone)\n` +
            `• FTB-00234 (Francistown)\n` +
            `• LBE-00123 (Lobatse)\n\n` +
            `Type your meter number now:`
        );
        session.step = 'awaiting_meter';
        return;
    }
    
    // Service Status
    if (text === 'status' || text === 'service status' || interactiveId === 'status') {
        await sendMessage(from,
            `📊 *SERVICE STATUS* 📊\n\n` +
            `📍 Gaborone: 🟢 Normal\n` +
            `📍 Francistown: 🟢 Normal\n` +
            `📍 Lobatse: 🟡 Maintenance (8am-12pm)\n` +
            `📍 Selebi-Phikwe: 🟢 Normal\n` +
            `📍 Molepolole: 🟢 Normal\n\n` +
            `⚠️ Planned maintenance notices are sent 48 hours in advance.\n\n` +
            `📞 Report outages: 0800 600 222`
        );
        return;
    }
    
    // Contact Us
    if (text === 'contact' || text === 'contact us' || interactiveId === 'contact') {
        await sendMessage(from,
            `📞 *CONTACT US* 📞\n\n` +
            `🏢 Head Office: Gaborone International Commerce Park\n` +
            `📞 Customer Care: 0800 600 222\n` +
            `📧 Email: support@waterbotswana.co.bw\n` +
            `🌐 Website: www.waterbotswana.co.bw\n` +
            `⏰ Hours: Mon-Fri 8am-5pm\n` +
            `🚨 Emergency: 24/7 hotline available\n\n` +
            `🇧🇼 Serving Botswana since 1970`
        );
        return;
    }
    
    // Direct meter number entry (if user types a meter number without going through menu)
    const meterMatch = text.toUpperCase().match(/[A-Z]{3}-\d{5}/);
    if (meterMatch) {
        const meter = meterMatch[0];
        const account = accounts[meter];
        
        if (account) {
            session.meter = meter;
            await sendMessage(from,
                `✅ *METER LINKED* ✅\n\n` +
                `📋 Meter: ${meter}\n` +
                `👤 Name: ${account.name}\n` +
                `💰 Balance: P${account.balance.toFixed(2)}\n` +
                `📍 Address: ${account.address}\n\n` +
                `Type "MENU" to see all options.`
            );
        } else {
            await sendMessage(from,
                `❌ *METER NOT FOUND* ❌\n\n` +
                `"${meter}" does not exist.\n\n` +
                `📋 Valid test meters:\n` +
                `• GBE-00412\n` +
                `• FTB-00234\n` +
                `• LBE-00123`
            );
        }
        return;
    }
    
    // Default fallback
    if (text) {
        await sendMessage(from,
            `❓ I didn't understand "${text}".\n\n` +
            `Please type "MENU" to see available options.`);
    }
}

// ========================================
// WEBHOOK ENDPOINTS
// ========================================
app.get('/webhook', (req, res) => {
    console.log('🔗 Webhook verification request');
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (token === process.env.VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Webhook verification failed');
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
                const msg = value.messages[0];
                const from = msg.from;
                const type = msg.type;
                
                let messageContent = null;
                let mediaInfo = null;
                
                if (type === 'text') {
                    messageContent = msg.text;
                } else if (type === 'interactive') {
                    messageContent = msg.interactive;
                } else if (type === 'location') {
                    mediaInfo = { latitude: msg.location.latitude, longitude: msg.location.longitude };
                } else if (type === 'image') {
                    mediaInfo = { id: msg.image.id };
                } else if (type === 'audio' || type === 'voice') {
                    mediaInfo = { id: msg.audio?.id };
                }
                
                await handleMessage(from, messageContent, type, mediaInfo);
                // After storing fault in your bot, add:
await sendToDashboard(from, text, 'incoming', session.meter, {
    type: fault.name,
    description: text,
    lat: mediaInfo?.latitude,
    lng: mediaInfo?.longitude
});
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
        status: 'running',
        service: 'Botswana Water Utility WhatsApp Bot',
        version: '3.0.0',
        features: ['Menus', 'Submenus', 'Fault Reporting', 'Location Sharing', 'Photos', 'Voice Notes'],
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`💧 Botswana Water Utility Bot v3.0`);
    console.log(`✅ Features: Interactive Menus | Fault Reports | Location | Photos | Voice`);
});
