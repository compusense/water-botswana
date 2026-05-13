const express = require('express');
const app = express();

app.use(express.json());

// Simple test endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'Botswana Water Utility Bot',
        time: new Date().toISOString()
    });
});

app.get('/webhook', (req, res) => {
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Accept any token for testing, but check env var in production
    if (token === process.env.VERIFY_TOKEN || token === 'test123') {
        res.status(200).send(challenge);
    } else {
        res.status(403).send('Verification failed');
    }
});

app.post('/webhook', (req, res) => {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/`);
    console.log(`✅ Webhook URL: http://localhost:${PORT}/webhook`);
});
