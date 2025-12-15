/*
 * Smoke test for dashboard watchlist proxy endpoints.
 * Reads credentials from .env via dotenv and avoids printing secrets.
 */

require('dotenv').config();

function pickEnv(...names) {
	for (const name of names) {
		const value = process.env[name];
		if (value && String(value).trim()) return String(value).trim();
	}
	return '';
}

function basicAuthHeader(user, pass) {
	const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
	return `Basic ${token}`;
}

async function httpJson(url, { method = 'GET', body } = {}, { authHeader, insecureTls } = {}) {
	const headers = {
		'Accept': 'application/json',
		...(body ? { 'Content-Type': 'application/json' } : {}),
		...(authHeader ? { 'Authorization': authHeader } : {})
	};

	if (insecureTls) {
		// Node's built-in fetch (undici) doesn't accept https.Agent. Use env override instead.
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	}

	let res;
	try {
		res = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined
		});
	} catch (e) {
		throw new Error(`fetch failed for ${url}: ${e && e.message ? e.message : String(e)}`);
	}

	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = { raw: text };
	}

	return { ok: res.ok, status: res.status, json: parsed };
}

async function main() {
	const baseUrl = pickEnv('DASHBOARD_BASE_URL') || 'https://localhost:3001';

	const user = pickEnv('DASHBOARD_BASIC_AUTH_USER', 'DASHBOARD_AUTH_USER', 'BASIC_AUTH_USER');
	const pass = pickEnv(
		'DASHBOARD_BASIC_AUTH_PASS',
		'DASHBOARD_BASIC_AUTH_PASSWORD',
		'DASHBOARD_AUTH_PASS',
		'DASHBOARD_AUTH_PASSWORD',
		'BASIC_AUTH_PASS',
		'BASIC_AUTH_PASSWORD'
	);

	if (!user || !pass) {
		throw new Error(
			'Missing dashboard Basic Auth credentials. Set BASIC_AUTH_USER/BASIC_AUTH_PASSWORD (or DASHBOARD_BASIC_AUTH_USER/PASS, DASHBOARD_AUTH_USER/PASS) in your environment/.env.'
		);
	}

	const authHeader = basicAuthHeader(user, pass);
	const reqOpts = { authHeader, insecureTls: true };

	const steps = [
		{ name: 'providers', url: `${baseUrl}/api/watchlist/providers` },
		{ name: 'tabs', url: `${baseUrl}/api/watchlist/investingcom/tabs` },
		{ name: 'switch primary', url: `${baseUrl}/api/watchlist/investingcom/switch`, method: 'POST', body: { watchlist: 'primary' } },
		{ name: 'tickers before', url: `${baseUrl}/api/watchlist/investingcom/tickers` },
		{ name: 'add IBM', url: `${baseUrl}/api/watchlist/investingcom/add`, method: 'POST', body: { ticker: 'IBM', watchlist: 'primary', assetType: 'stock' } },
		{ name: 'tickers after add', url: `${baseUrl}/api/watchlist/investingcom/tickers` },
		{ name: 'delete IBM', url: `${baseUrl}/api/watchlist/investingcom/delete`, method: 'POST', body: { ticker: 'IBM', watchlist: 'primary' } },
		{ name: 'tickers after delete', url: `${baseUrl}/api/watchlist/investingcom/tickers` }
	];

	for (const step of steps) {
		const res = await httpJson(step.url, { method: step.method || 'GET', body: step.body }, reqOpts);
		process.stdout.write(`\n--- ${step.name} (${res.status}) ---\n`);
		process.stdout.write(JSON.stringify(res.json, null, 2) + '\n');
		if (!res.ok) {
			throw new Error(`Step failed: ${step.name} (${res.status})`);
		}
	}
}

main().catch(err => {
	console.error(String(err && err.message ? err.message : err));
	process.exit(1);
});
