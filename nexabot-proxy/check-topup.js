const Database = require('/home/arkxmotion/nexabot-proxy/node_modules/better-sqlite3');

// Arkx Studio DB
const arkxDb = new Database('/opt/arkxmotion-studio/data/arkxmotion.db', { readonly: true });
console.log('=== NEXABOT_TOPUP (with amount) ===');
const topups = arkxDb.prepare('SELECT id, user_id, kind, amount, package_slug, status, days, expires_at FROM nexabot_topup').all();
console.log(JSON.stringify(topups, null, 2));
arkxDb.close();

// Nexabot Proxy DB
const proxyDb = new Database('/home/arkxmotion/nexabot-proxy/members.db', { readonly: true });
console.log('\n=== NEXABOT PROXY MEMBERS ===');
const members = proxyDb.prepare('SELECT id, name, plan, saldo, status, api_key FROM members').all();
console.log(JSON.stringify(members, null, 2));
proxyDb.close();
