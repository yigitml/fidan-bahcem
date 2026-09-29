import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const origin = process.argv[2] || 'http://127.0.0.1:3000';
let session = '';
async function call(action, data, expected = 200, suppliedOrigin = origin) {
  const response = await fetch(`${origin}/api/store/${action}`, {
    method: data ? 'POST' : 'GET',
    headers: { ...(data ? { 'Content-Type':'application/json', Origin:suppliedOrigin } : {}), ...(session ? { Cookie:session } : {}) },
    ...(data ? {body:JSON.stringify(data)} : {}),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${action}: ${JSON.stringify(body)}`);
  const cookie = response.headers.get('set-cookie'); if(cookie) session = cookie.split(';')[0];
  return body;
}
for(const path of ['/','/fidanlar','/odeme','/hesabim','/gizlilik']) assert.equal((await fetch(origin+path)).status,200,path);
await call('health');
assert.equal((await fetch(`${origin}/api/store/register`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{invalid'})).status,400);
assert.equal((await fetch(`${origin}/api/store/register`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({oversized:'x'.repeat(17000)})})).status,413);
await call('profile',{name:'Blocked'},403,'https://attacker.example');
const address = `qa-${randomUUID()}@example.com`;
const password = `Test-${randomUUID()}!`;
const registered = await call('register',{name:'Production QA',email:address,password});
assert.ok(registered.recoveryCode);
assert.equal((await call('me')).user.email,address);
await call('login',{email:address,password:'wrong'},401);
const requestId = randomUUID();
const orderData = {requestId,items:[{id:'findik',quantity:2}],name:'QA Customer',email:address,phone:'05550000000',address:'Synthetic Test Street 1',city:'İstanbul',district:'Kadıköy',total:1,cardNumber:'4111111111111111',cvv:'123'};
const created = await call('order',orderData,201);
assert.equal(created.order.total,459);
assert.equal((await call('order',orderData)).order.id,created.order.id);
assert.equal((await call('orders')).orders.length,1);
await call('order',{...orderData,requestId:randomUUID(),items:[{id:'findik',quantity:-1}]},400);
const exported = await call('export');
assert.equal(exported.user.password,undefined);
assert.equal(exported.orders[0].payment,'demo-completed');
assert.equal(JSON.stringify(exported).includes('cardNumber'),false);
await call('admin-orders',undefined,401);
const customerSession = session;
const adminKey = process.env.ADMIN_TEST_KEY || (process.argv[3] ? readFileSync(process.argv[3],'utf8').match(/Administrator key: (.+)/)?.[1] : undefined);
if(adminKey) {
  await call('admin-login',{key:'incorrect-key'},401);
  await call('admin-login',{key:adminKey});
  assert.ok((await call('admin-orders')).orders.some(order=>order.id===created.order.id));
  await call('admin-status',{id:created.order.id,status:'Hazırlanıyor'});
  await call('admin-status',{id:created.order.id,status:'invalid'},400);
  await call('admin-logout',{});
  session=customerSession;
  assert.equal((await call('orders')).orders[0].status,'Hazırlanıyor');
}
await call('logout',{});
assert.equal((await call('me')).user,null);
await call('orders',undefined,401);
const other = await call('register',{name:'Isolation QA',email:`qa-${randomUUID()}@example.com`,password});
assert.ok(other.user);
assert.equal((await call('orders')).orders.length,0);
await call('delete',{password});
await call('login',{email:address,password});
assert.equal((await call('orders')).orders[0].id,created.order.id);
await call('profile',{name:'Updated QA'});
assert.equal((await call('me')).user.name,'Updated QA');
const newPassword=`Recovered-${randomUUID()}`;
await call('recover',{email:address,recoveryCode:'incorrect',password:newPassword},401);
const recovery=await call('recover',{email:address,recoveryCode:registered.recoveryCode,password:newPassword});
assert.ok(recovery.recoveryCode);
assert.equal((await call('me')).user,null);
await call('login',{email:address,password},401);
await call('login',{email:address,password:newPassword});
await call('delete',{password:'incorrect'},401);
await call('delete',{password:newPassword});
assert.equal((await call('me')).user,null);
await call('login',{email:address,password},401);
console.log('PASS: pages, health, CSRF, registration, sessions, login failure, durable orders, idempotency, price integrity, validation, privacy export, isolation, recovery and session revocation, profile, account deletion'+(adminKey?', admin authorization and order management':''));
