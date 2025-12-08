
const http = require('http');

console.log('Testing API response...');

const req = http.request({
    hostname: 'localhost',
    port: 3001,
    path: '/api/metadata/autocomplete?q=VTI',
    method: 'GET'
}, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Body:', data);
    });
});

req.on('error', e => {
    console.error('Error connecting to API:', e.message);
});

req.end();
