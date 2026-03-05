import { execSync } from 'child_process';

async function testApi() {
    const baseUrl = 'https://takatak-backend.onrender.com/api/v1';

    console.log('1. Requesting OTP...');
    let res = await fetch(`${baseUrl}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+1234567890', isTesting: true })
    });
    let data = await res.json();
    console.log('OTP Req:', data);

    // In testing mode, OTP is usually returned or is '123456'
    const otp = data.data?.otp || '123456';

    console.log('2. Verifying OTP...');
    res = await fetch(`${baseUrl}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+1234567890', otp, isTesting: true })
    });
    data = await res.json();
    console.log('OTP Verify:', data.statusCode || 'Success');

    const token = data.data?.accessToken;
    if (!token) {
        console.log('No token! Exiting.');
        return;
    }

    console.log('3. Fetching /chat...');
    const start = Date.now();
    res = await fetch(`${baseUrl}/chat`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`Chat Response Status: ${res.status} in ${Date.now() - start}ms`);
    const chatData = await res.text();
    console.log(`Content length: ${chatData.length}`);
}

testApi();
