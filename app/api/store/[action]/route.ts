import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/database';
import { digest, dummyPasswordHash, email, hashPassword, password as passwordText, text, token, verifyPassword } from '@/lib/security';
import { products } from '@/lib/products';
import { clearSession as clear, currentUser as current, currentSession, deletionSession, publicUser, recentAuthenticationTTL, revokeSessions, sessionCookie as cookie, signedIn, type User } from '@/lib/auth';
import { cleanupBillingUser, exportBillingUser } from '@/lib/revenuecat';
import { readJsonObject, RequestError, sameOrigin, takeRateLimit } from '@/lib/http-security';

export const dynamic = 'force-dynamic';
type Order = { id: string; userId: string | null; createdAt: string; status: string; total: number; shipping: Record<string,string>; items: { id: string; name: string; quantity: number; price: number }[]; payment: string };
type OperatorSession = { createdAt: number };
const operatorSessionTTL = 60 * 60 * 1000;
async function operator(request: NextRequest) {
  const secret = request.cookies.get('fb_operator')?.value;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return null;
  const entry = await (await database()).get<OperatorSession>(['operator-session', digest(secret)]);
  if (!entry.value || !Number.isFinite(entry.value.createdAt) || entry.value.createdAt > Date.now() || Date.now() - entry.value.createdAt >= operatorSessionTTL) return null;
  return entry;
}

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
    if (action === 'me') {
      const pending = !user ? await deletionSession(request) : null;
      const deletionPending = !!pending?.user.deletingAt;
      return NextResponse.json({ user: user ? publicUser(user) : deletionPending ? publicUser(pending!.user) : null, deletionPending });
    }
    if (!user) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
    const orders: Order[] = [];
    for await (const entry of db.list<Order>({ prefix: ['orders', user.id] })) if (entry.value) orders.push(entry.value);
    if (action === 'orders') return NextResponse.json({ orders: orders.sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
    if (action === 'export') return NextResponse.json({ user: publicUser(user), orders, billing: await exportBillingUser(user.id) }, { headers: { 'Content-Disposition': 'attachment; filename="fidan-bahcem-verilerim.json"' } });
    return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  } catch { return NextResponse.json({ error: 'Hizmet geçici olarak kullanılamıyor.' }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: 'İstek reddedildi.' }, { status: 403 });
    const { action } = await context.params;
    const data = await readJsonObject(request);
    const db = await database();
    await takeRateLimit(request, action);
    if (action === 'admin-login') {
      const expected = process.env.ADMIN_KEY_HASH;
      if (!expected || digest(text(data.key,128)) !== expected) return NextResponse.json({error:'Yönetici anahtarı hatalı.'},{status:401});
      const secret = token(); await db.set(['operator-session',digest(secret)],{createdAt:Date.now()} satisfies OperatorSession,{expireIn:operatorSessionTTL});
      const response = NextResponse.json({ok:true}); response.cookies.set('fb_operator',secret,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:3600});return response;
    }
    if (action === 'admin-logout') {
      const secret = request.cookies.get('fb_operator')?.value; if(secret) await db.delete(['operator-session',digest(secret)]);
      const response = NextResponse.json({ok:true}); response.cookies.set('fb_operator','',{maxAge:0,path:'/'});return response;
    }
    if (action === 'admin-status') {
      const operatorEntry = await operator(request);
      if (!operatorEntry) return NextResponse.json({error:'Yönetici girişi gerekiyor.'},{status:401});
      const id = text(data.id,100); const status = text(data.status,30);
      if (!['Alındı','Hazırlanıyor','Kargoya verildi','Teslim edildi','İptal edildi'].includes(status)) throw new Error('Geçersiz durum.');
      const entry = await db.get<Order>(['order',id]); if (!entry.value) return NextResponse.json({error:'Sipariş bulunamadı.'},{status:404});
      const order = {...entry.value,status};
      const retention = order.userId ? undefined : {expireIn:Math.max(1,90*24*60*60*1000-(Date.now()-Date.parse(order.createdAt)))};
      const transaction = db.atomic().check(entry).check(operatorEntry).set(entry.key,order,retention);
      if(order.userId) {
        const account = await db.get<User>(['user', order.userId]);
        if (!account.value || account.value.deletingAt) return NextResponse.json({error:'Sipariş bulunamadı.'},{status:404});
        transaction.check(account).set(['orders',order.userId,id],order);
      }
      if (Date.now() - operatorEntry.value!.createdAt >= operatorSessionTTL) return NextResponse.json({error:'Yönetici girişi gerekiyor.'},{status:401});
      if(!(await transaction.commit()).ok) return NextResponse.json({error:'Tekrar deneyin.'},{status:409});
      return NextResponse.json({order});
    }
    if (action === 'register') {
      const address = email(data.email); const password = passwordText(data.password);
      if (password.length < 12) throw new Error('Şifreniz en az 12 karakter olmalı.');
      const recoveryCode = token();
      const user: User = { id: crypto.randomUUID(), email: address, name: text(data.name, 100), password: hashPassword(password), recovery: digest(recoveryCode), createdAt: new Date().toISOString() };
      const existing = await db.get(['email', address]);
      if (existing.value) throw new Error('Bu e-posta ile hesap oluşturulamıyor.');
      const saved = await db.atomic().check(existing).set(['email', address], user.id).set(['user', user.id], user).commit();
      if (!saved.ok) throw new Error('Lütfen tekrar deneyin.');
      return await signedIn(user, { recoveryCode });
    }
    if (action === 'login' || action === 'recover') {
      const id = await db.get<string>(['email', email(data.email)]);
      const user = id.value ? (await db.get<User>(['user', id.value])).value : null;
      if (action === 'login') {
        const valid = verifyPassword(passwordText(data.password), user?.password || dummyPasswordHash);
        if (!user || !user.password || user.deletingAt || !valid) return NextResponse.json({ error: 'E-posta veya şifre hatalı.' }, { status: 401 });
      } else {
        if (!user || !user.recovery || user.deletingAt || digest(text(data.recoveryCode, 128)) !== user.recovery) return NextResponse.json({ error: 'Kurtarma bilgileri hatalı.' }, { status: 401 });
        const password = passwordText(data.password); if (password.length < 12) throw new Error('Şifreniz en az 12 karakter olmalı.');
        const recoveryCode = token();
        const entry = await db.get<User>(['user', user.id]);
        if (!entry.value || entry.value.deletingAt || entry.value.recovery !== user.recovery) return NextResponse.json({ error: 'Kurtarma bilgileri hatalı.' }, { status: 401 });
        const updated = { ...entry.value, password: hashPassword(password), recovery: digest(recoveryCode), authVersion: (entry.value.authVersion || 0) + 1 };
        if (!(await db.atomic().check(entry).set(entry.key, updated).commit()).ok) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 409 });
        await revokeSessions(user.id, updated.authVersion);
        return clear(NextResponse.json({ recoveryCode }));
      }
      return await signedIn(user!);
    }
    const authenticated = await (action === 'delete' ? deletionSession(request) : currentSession(request));
    const user = authenticated?.user || null;
    if (action === 'logout') {
      const secret = request.cookies.get(cookie)?.value; if (secret) await db.delete(['session', digest(secret)]);
      return clear(NextResponse.json({ ok: true }));
    }
    if (action === 'order') {
      if ('checkoutUserId' in data && data.checkoutUserId !== (user?.id || null)) return NextResponse.json({ error: 'Oturumunuz değişti. İlk sipariş denemenizdeki hesabınızla devam edin.', code: 'checkout_session_changed' }, { status: 409 });
      const requestId = text(data.requestId, 64);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Geçersiz sipariş.');
      if (data.demoConsent !== true) throw new Error('Lütfen demo sipariş onayını işaretleyin.');
      const orderKey = ['order-request', user?.id || 'guest', requestId];
      if (!Array.isArray(data.items) || !data.items.length || data.items.length > 20) throw new Error('Sepeti kontrol edin.');
      const seen = new Set<string>();
      const items = data.items.map((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ürün adedini kontrol edin.');
        const line = value as { id?: unknown; quantity?: unknown };
        const product = products.find(p => p.id === line.id);
        if (!product || seen.has(product.id) || typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) throw new Error('Ürün adedini kontrol edin.');
        seen.add(product.id);
        return { id: product.id, name: product.name, quantity: line.quantity, price: product.price };
      });
      const shipping = { name: text(data.name,100), phone: text(data.phone,30), email: email(data.email), address: text(data.address,500), city: text(data.city,100), district: text(data.district,100) };
      if (!/^\+?[\d\s()-]{9,30}$/.test(shipping.phone) || shipping.phone.replace(/\D/g, '').length < 9 || shipping.phone.replace(/\D/g, '').length > 15) throw new Error('Geçerli telefon numarası girin.');
      const existing = await db.get<Order>(orderKey);
      if (existing.value) {
        const requestedLines = items.map(({ id, quantity }) => ({ id, quantity }));
        const savedLines = existing.value.items.map(({ id, quantity }) => ({ id, quantity }));
        if (JSON.stringify(savedLines) !== JSON.stringify(requestedLines) || JSON.stringify(existing.value.shipping) !== JSON.stringify(shipping)) return NextResponse.json({ error: 'Bu sipariş denemesinin bilgileri değişmiş. Yeni bir sipariş başlatın.' }, { status: 409 });
        if (authenticated && !(await db.atomic().check(existing).check(authenticated.userEntry).check(authenticated.entry).commit()).ok) return NextResponse.json({ error: 'Oturumunuz değişti. Siparişinizi doğrulamadan önce yeniden giriş yapın.' }, { status: 401 });
        return NextResponse.json({ order: existing.value });
      }
      const subtotal = items.reduce((sum: number, item: { price: number; quantity: number }) => sum + item.price*item.quantity, 0);
      const order: Order = { id: `FB-${crypto.randomUUID()}`, userId: user?.id || null, items, shipping, total: subtotal + (subtotal >= 750 ? 0 : 89), status: 'Alındı', payment: 'demo-completed', createdAt: new Date().toISOString() };
      const retention = user ? undefined : {expireIn:90*24*60*60*1000};
      const transaction = db.atomic().check(existing).set(orderKey,order,retention).set(['order',order.id],order,retention).set(['schema','version'],1);
      if (user) {
        const account = await db.get<User>(['user', user.id]);
        if (!account.value || account.value.deletingAt || (account.value.authVersion || 0) !== (user.authVersion || 0)) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
        transaction.check(account).check(authenticated!.entry).set(['orders',user.id,order.id],order);
      }
      if (!(await transaction.commit()).ok) return NextResponse.json({ error: 'Sipariş işleniyor. Tekrar deneyin.' }, { status: 409 });
      return NextResponse.json({ order }, { status: 201 });
    }
    if (!user) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
    if (action === 'profile') {
      const entry = authenticated!.userEntry;
      if (!entry.value || entry.value.deletingAt) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
      const updated = { ...entry.value, name: text(data.name, 100) };
      if (!(await db.atomic().check(entry).check(authenticated!.entry).set(entry.key, updated).commit()).ok) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 409 });
      return NextResponse.json({ user: publicUser(updated) });
    }
    if (action === 'password') {
      if (!user.password || !verifyPassword(passwordText(data.currentPassword), user.password)) return NextResponse.json({ error: 'Mevcut şifre hatalı.' }, { status: 401 });
      const password = passwordText(data.password);
      if (password.length < 12) throw new Error('Şifreniz en az 12 karakter olmalı.');
      const entry = authenticated!.userEntry;
      if (!entry.value || entry.value.deletingAt || entry.value.password !== user.password) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
      const recoveryCode = token();
      const updated = { ...entry.value, password: hashPassword(password), recovery: digest(recoveryCode), authVersion: (entry.value.authVersion || 0) + 1 };
      if (!(await db.atomic().check(entry).check(authenticated!.entry).set(entry.key, updated).commit()).ok) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 409 });
      await revokeSessions(user.id, updated.authVersion);
      return await signedIn(updated, { recoveryCode });
    }
    if (action === 'delete') {
      if (user.password) {
        if (!verifyPassword(passwordText(data.password),user.password)) return NextResponse.json({ error: 'Şifre hatalı.' }, { status: 401 });
      } else {
        const reauthenticatedAt = authenticated!.entry.value?.googleReauthenticatedAt || 0;
        if (!user.google || reauthenticatedAt > Date.now() || Date.now() - reauthenticatedAt > recentAuthenticationTTL) return NextResponse.json({ error: 'Hesabınızı silmeden önce Google ile yeniden doğrulayın.', code: 'reauthentication_required' }, { status: 401 });
        if (data.confirmation !== 'HESABIMI SİL') return NextResponse.json({ error: 'Silme onayını kontrol edin.' }, { status: 400 });
      }
      const entry = authenticated!.userEntry;
      if (!entry.value || entry.value.password !== user.password) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401 });
      if (!entry.value.deletingAt && !(await db.atomic().check(entry).check(authenticated!.entry).set(entry.key, { ...entry.value, deletingAt: new Date().toISOString(), deletionSessionDigest: authenticated!.entry.key[1] as string, authVersion: (entry.value.authVersion || 0) + 1 }).commit()).ok) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 409 });
      for await (const order of db.list<Order>({ prefix: ['orders',user.id] })) { if (order.value) await db.delete(['order',order.value.id]); await db.delete(order.key); }
      for await (const order of db.list<Order>({ prefix: ['order-request',user.id] })) await db.delete(order.key);
      await cleanupBillingUser(user.id);
      const pending = await db.get<User>(['user', user.id]);
      const address = await db.get<string>(['email', user.email]);
      const google = user.google ? await db.get<string>(['google-user', user.google.subject]) : null;
      if (!pending.value?.deletingAt || pending.value.deletionSessionDigest !== authenticated!.entry.key[1] || address.value !== user.id || (google && google.value !== user.id)) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 409 });
      const transaction = db.atomic().check(pending).check(address).check(authenticated!.entry).delete(pending.key).delete(address.key).delete(authenticated!.entry.key);
      if (google) transaction.check(google).delete(google.key);
      if (!(await transaction.commit()).ok) return NextResponse.json({ error: 'Lütfen tekrar deneyin.' }, { status: 409 });
      // Remaining sessions cannot authenticate without the user; TTL also removes them if cleanup is interrupted.
      await revokeSessions(user.id).catch(() => undefined);
      return clear(NextResponse.json({ ok: true }));
    }
    return NextResponse.json({ error: 'Bulunamadı.' }, { status: 404 });
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
    const message = error instanceof Error ? error.message : '';
    const safe = /^(Lütfen|Geçerli|Şifreniz|Bu e-posta|Kurtarma|Geçersiz|Sepeti|Ürün)/.test(message);
    return NextResponse.json({ error: safe ? message : 'Hizmet geçici olarak kullanılamıyor. Tekrar deneyin.' }, { status: safe ? 400 : 503 });
  }
}
