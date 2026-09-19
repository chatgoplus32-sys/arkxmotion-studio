const Database = require('/home/arkxmotion/nexabot-proxy/node_modules/better-sqlite3');
const db = new Database('/opt/arkxmotion-studio/data/arkxmotion.db', { readonly: true });

console.log('=== USERS ===');
const users = db.prepare('SELECT id, name, email, approved FROM users LIMIT 10').all();
console.log(JSON.stringify(users, null, 2));

console.log('\n=== NEXABOT_TOPUP ===');
try {
  const topups = db.prepare('SELECT id, user_id, kind, package_slug, status, days, expires_at FROM nexabot_topup').all();
  console.log(JSON.stringify(topups, null, 2));
} catch(e) {
  console.log('Table not found: ' + e.message);
}

db.close();
