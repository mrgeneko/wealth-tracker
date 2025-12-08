
const http = require('http');
const fs = require('fs');
const path = require('path');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/metadata/autocomplete?q=VTI',
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('Response:', data);
        try {
            const parsed = JSON.parse(data);
            fs.writeFileSync(path.join(__dirname, '../logs/api_response.json'), JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.error('Failed to parse:', e);
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
