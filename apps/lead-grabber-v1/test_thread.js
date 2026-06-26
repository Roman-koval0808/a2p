
const WEBHOOK_URL = 'http://localhost:3005/api/telnyx/webhook';

async function sendWebhook(text, phoneNumber) {
    console.log(`\n--- Sending SMS: "${text}" ---`);
    const payload = {
        data: {
            event_type: 'message.received',
            payload: {
                from: { phone_number: phoneNumber },
                to: [{ phone_number: '+17059985691' }], // assuming this is the company number
                text: text,
                direction: 'inbound',
                type: 'SMS'
            }
        }
    };

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log('Webhook response:', result);
    } catch (err) {
        console.error('Webhook error:', err);
    }
}

async function run() {
    const testPhone = '+1909' + Math.floor(Math.random() * 10000000); // Random phone to simulate a new customer
    console.log(`Testing with phone number: ${testPhone}`);

    // Message 1: Billing context
    await sendWebhook("What is my current account balance?", testPhone);
    console.log("Waiting 10 seconds for AI and DB processing...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Message 2: Same billing context (should merge)
    await sendWebhook("Can you also tell me when the next invoice is due?", testPhone);
    console.log("Waiting 10 seconds for AI and DB processing...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Message 3: Completely different context (should create new thread)
    await sendWebhook("I'd like to book an appointment for tomorrow at 2 PM", testPhone);
    console.log("Waiting 10 seconds for AI and DB processing...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log("Test complete. Check the server logs to see the Comm IDs and similarity merging.");
}

run();
