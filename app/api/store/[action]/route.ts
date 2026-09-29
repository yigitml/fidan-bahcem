import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/database';
import { digest, email, hashPassword, text, token, verifyPassword } from '@/lib/security';
import { products } from '@/lib/products';

export const dynamic = 'force-dynamic';
type User = { id: string; email: string; name: string; password: string; recovery: string; createdAt: string };
type Session = { userId: string };
type Order = { id: string; userId: string | null; createdAt: string; status: string; total: number; shipping: Record<string,string>; items: { id: string; name: string; quantity: number; price: number }[]; payment: string };
const cookie = 'fb_session';
const ttl = 7 * 24 * 60 * 60 * 1000;
const publicUser = (user: User) => ({ id: user.id, email: user.email, name: user.name });
async function current(request: NextRequest) {
  const db = await database();
  const secret = request.cookies.get(cookie)?.value;
  if (!secret) return null;
  const session = await db.get<Session>(['session', digest(secret)]);
  if (!session.value) return null;
  return (await db.get<User>(['user', session.value.userId])).value;
}
async function signedIn(user: User) {
  const secret = token();
  await (await database()).set(['session', digest(secret)], { userId: user.id }, { expireIn: ttl });
  const response = NextResponse.json({ user: publicUser(user) });
  response.cookies.set(cookie, secret, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: ttl / 1000 });
  return response;
}
async function operator(request: NextRequest) {
  const secret = request.cookies.get('fb_operator')?.value;
  return !!secret && !!(await (await database()).get(['operator-session', digest(secret)])).value;
}
function clear(response: NextResponse) { response.cookies.set(cookie, '', { maxAge: 0, path: '/' }); return response; }

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await context.params;
    const db = await database();
    if (action === 'health') { await db.get(['schema', 'version']); return NextResponse.json({ status: 'ok', database: 'connected', schema: 1 }); }
    if (action === 'admin-orders') {
      if (!(await operator(request))) return NextResponse.json({ error: 'Yönetici girişi gerekiyor.' }, {status:401});
      const orders: Order[] = [];
      for await (const entry of db.list<Order>({ prefix: ['order'] })) if(entry.value) orders.push(entry.value);
      return NextResponse.json({ orders: orders.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)) });
    }
    const user = await current(request);
    if (action === 'me') return NextResponse.json({ user: user ? publicUser(user) : null });
    if (!user) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
    const orders: Order[] = [];
    for await (const entry of db.list<Order>({ prefix: ['orders', user.id] })) if (entry.value) orders.push(entry.value);
    if (action === 'orders') return NextResponse.json({ orders: orders.sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
    if (action === 'export') return NextResponse.json({ user: publicUser(user), orders });
    return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  } catch { return NextResponse.json({ error: 'Hizmet geçici olarak kullanılamıyor.' }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== request.headers.get('host')) return NextResponse.json({ error: 'İstek reddedildi.' }, { status: 403 });
    if (Number(request.headers.get('content-length') || 0) > 16000) return NextResponse.json({ error: 'İstek çok büyük.' }, { status: 413 });
    const { action } = await context.params;
    const db = await database();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const key = ['rate', digest(ip), action, Math.floor(Date.now()/60000)];
    const entry = await db.get<number>(key);
    if ((entry.value || 0) >= 15) return NextResponse.json({ error: 'Bir dakika sonra tekrar deneyin.' }, { status: 429 });
    if (!(await db.atomic().check(entry).set(key, (entry.value || 0) + 1, { expireIn: 120000 }).commit()).ok) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 429 });
    const raw = await request.text();
    if (raw.length > 16000) return NextResponse.json({ error: 'İstek çok büyük.' }, { status: 413 });
    const data = JSON.parse(raw || '{}');
    if (action === 'admin-login') {
      const expected = process.env.ADMIN_KEY_HASH;
      if (!expected || digest(text(data.key,128)) !== expected) return NextResponse.json({error:'Yönetici anahtarı hatalı.'},{status:401});
      const secret = token(); await db.set(['operator-session',digest(secret)],true,{expireIn:3600000});
      const response = NextResponse.json({ok:true}); response.cookies.set('fb_operator',secret,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:3600});return response;
    }
    if (action === 'admin-logout') {
      const secret = request.cookies.get('fb_operator')?.value; if(secret) await db.delete(['operator-session',digest(secret)]);
      const response = NextResponse.json({ok:true}); response.cookies.set('fb_operator','',{maxAge:0,path:'/'});return response;
    }
    if (action === 'admin-status') {
      if (!(await operator(request))) return NextResponse.json({error:'Yönetici girişi gerekiyor.'},{status:401});
      const id = text(data.id,100); const status = text(data.status,30);
      if (!['Alındı','Hazırlanıyor','Kargoya verildi','Teslim edildi','İptal edildi'].includes(status)) throw new Error('Geçersiz durum.');
      const entry = await db.get<Order>(['order',id]); if (!entry.value) return NextResponse.json({error:'Sipariş bulunamadı.'},{status:404});
      const order = {...entry.value,status};
      const retention = order.userId ? undefined : {expireIn:Math.max(1,90*24*60*60*1000-(Date.now()-Date.parse(order.createdAt)))};
      const transaction = db.atomic().check(entry).set(entry.key,order,retention);
      if(order.userId) transaction.set(['orders',order.userId,id],order);
      if(!(await transaction.commit()).ok) return NextResponse.json({error:'Tekrar deneyin.'},{status:409});
      return NextResponse.json({order});
    }
    if (action === 'register') {
      const address = email(data.email); const password = text(data.password, 128);
      if (password.length < 12) throw new Error('Şifreniz en az 12 karakter olmalı.');
      const recoveryCode = token();
      const user: User = { id: crypto.randomUUID(), email: address, name: text(data.name, 100), password: hashPassword(password), recovery: digest(recoveryCode), createdAt: new Date().toISOString() };
      const existing = await db.get(['email', address]);
      if (existing.value) throw new Error('Bu e-posta ile hesap oluşturulamıyor.');
      const saved = await db.atomic().check(existing).set(['email', address], user.id).set(['user', user.id], user).commit();
      if (!saved.ok) throw new Error('Lütfen tekrar deneyin.');
      const response = await signedIn(user);
      response.body?.cancel();
      const result = NextResponse.json({ user: publicUser(user), recoveryCode });
      result.headers.set('set-cookie', response.headers.get('set-cookie')!);
      return result;
    }
    if (action === 'login' || action === 'recover') {
      const id = await db.get<string>(['email', email(data.email)]);
      const user = id.value ? (await db.get<User>(['user', id.value])).value : null;
      if (action === 'login') {
        const valid = verifyPassword(text(data.password, 128), user?.password || hashPassword('dummy-password'));
        if (!user || !valid) return NextResponse.json({ error: 'E-posta veya şifre hatalı.' }, { status: 401 });
      } else {
        if (!user || digest(text(data.recoveryCode, 128)) !== user.recovery) return NextResponse.json({ error: 'Kurtarma bilgileri hatalı.' }, { status: 401 });
        const password = text(data.password, 128); if (password.length < 12) throw new Error('Şifreniz en az 12 karakter olmalı.');
        const recoveryCode = token(); user.password = hashPassword(password); user.recovery = digest(recoveryCode);
        await db.set(['user', user.id], user);
        for await (const session of db.list<Session>({ prefix: ['session'] })) if (session.value?.userId === user.id) await db.delete(session.key);
        return NextResponse.json({ recoveryCode });
      }
      return signedIn(user!);
    }
    const user = await current(request);
    if (action === 'logout') {
      const secret = request.cookies.get(cookie)?.value; if (secret) await db.delete(['session', digest(secret)]);
      return clear(NextResponse.json({ ok: true }));
    }
    if (action === 'order') {
      const requestId = text(data.requestId, 64);
      if (!/^[a-zA-Z0-9-]+$/.test(requestId)) throw new Error('Geçersiz sipariş.');
      const orderKey = ['order-request', user?.id || 'guest', requestId];
      const existing = await db.get<Order>(orderKey);
      if (existing.value) return NextResponse.json({ order: existing.value });
      if (!Array.isArray(data.items) || !data.items.length || data.items.length > 20) throw new Error('Sepeti kontrol edin.');
      const items = data.items.map((line: { id: string; quantity: number }) => {
        const product = products.find(p => p.id === line.id);
        if (!product || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) throw new Error('Ürün adedini kontrol edin.');
        return { id: product.id, name: product.name, quantity: line.quantity, price: product.price };
      });
      const shipping = { name: text(data.name,100), phone: text(data.phone,30), email: email(data.email), address: text(data.address,500), city: text(data.city,100), district: text(data.district,100) };
      const subtotal = items.reduce((sum: number, item: { price: number; quantity: number }) => sum + item.price*item.quantity, 0);
      const order: Order = { id: `FB-${crypto.randomUUID()}`, userId: user?.id || null, items, shipping, total: subtotal + (subtotal >= 750 ? 0 : 89), status: 'Alındı', payment: 'demo-completed', createdAt: new Date().toISOString() };
      const retention = user ? undefined : {expireIn:90*24*60*60*1000};
      const transaction = db.atomic().check(existing).set(orderKey,order,retention).set(['order',order.id],order,retention).set(['schema','version'],1);
      if (user) transaction.set(['orders',user.id,order.id],order);
      if (!(await transaction.commit()).ok) return NextResponse.json({ error: 'Sipariş işleniyor. Tekrar deneyin.' }, { status: 409 });
      return NextResponse.json({ order }, { status: 201 });
    }
    if (!user) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
    if (action === 'profile') { user.name = text(data.name,100); await db.set(['user',user.id],user); return NextResponse.json({ user: publicUser(user) }); }
    if (action === 'delete') {
      if (!verifyPassword(text(data.password,128),user.password)) return NextResponse.json({ error: 'Şifre hatalı.' }, { status: 401 });
      for await (const session of db.list<Session>({ prefix: ['session'] })) if (session.value?.userId === user.id) await db.delete(session.key);
      for await (const order of db.list<Order>({ prefix: ['orders',user.id] })) { if (order.value) await db.delete(['order',order.value.id]); await db.delete(order.key); }
      for await (const order of db.list<Order>({ prefix: ['order-request',user.id] })) await db.delete(order.key);
      await db.delete(['email',user.email]); await db.delete(['user',user.id]);
      return clear(NextResponse.json({ ok: true }));
    }
    return NextResponse.json({ error: 'Bulunamadı.' }, { status: 404 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
    const message = error instanceof Error ? error.message : '';
    const safe = /^(Lütfen|Geçerli|Şifreniz|Bu e-posta|Kurtarma|Geçersiz|Sepeti|Ürün)/.test(message);
    return NextResponse.json({ error: safe ? message : 'Hizmet geçici olarak kullanılamıyor. Tekrar deneyin.' }, { status: safe ? 400 : 503 });
  }
}
