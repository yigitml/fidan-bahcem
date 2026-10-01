import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CART_QUANTITY, normalizeCart, subtractCartItems } from "../lib/cart";
import { AUTO_RECOVERY_TTL, MAX_RECOVERY_TTL, isOrderSubmission, parseCheckoutRecovery, type SavedOrderSubmission } from "../lib/checkout-recovery";

test("tampered stored carts discard invalid products and unsafe quantities", () => {
  assert.deepEqual(normalizeCart(null), []);
  assert.deepEqual(normalizeCart({ id: "findik", quantity: 1 }), []);
  assert.deepEqual(normalizeCart([
    null, false, "findik", { id: "unknown", quantity: 1 },
    { id: "findik", quantity: "2" }, { id: "findik", quantity: 1.5 },
    { id: "findik", quantity: -1 }, { id: "findik", quantity: Number.POSITIVE_INFINITY },
    { id: "findik", quantity: 2 }, { id: "cam", quantity: 0 },
  ]), [{ id: "findik", quantity: 2 }]);
});

test("duplicate stored lines cannot exceed the per-product purchase limit", () => {
  assert.deepEqual(normalizeCart([
    { id: "findik", quantity: 70 }, { id: "findik", quantity: 60 },
    { id: "cam", quantity: Number.MAX_SAFE_INTEGER },
  ]), [{ id: "findik", quantity: MAX_CART_QUANTITY }, { id: "cam", quantity: MAX_CART_QUANTITY }]);
});

test("checkout removes purchased quantities while retaining new cart additions", () => {
  assert.deepEqual(subtractCartItems([
    { id: "findik", quantity: 4 }, { id: "cam", quantity: 1 },
    { id: "leylandi", quantity: 3 },
  ], [{ id: "findik", quantity: 2 }, { id: "cam", quantity: 1 }]), [
    { id: "findik", quantity: 2 }, { id: "leylandi", quantity: 3 },
  ]);
});

test("changed or removed lines never produce negative cart quantities", () => {
  assert.deepEqual(subtractCartItems([
    { id: "findik", quantity: 1 }, { id: "cam", quantity: 2 },
  ], [{ id: "findik", quantity: 3 }, { id: "leylandi", quantity: 2 }]), [
    { id: "cam", quantity: 2 },
  ]);
  assert.deepEqual(subtractCartItems([], [{ id: "findik", quantity: 1 }]), []);
});

const now = Date.UTC(2026, 9, 1, 12);
const attempt: SavedOrderSubmission = {
  version: 1,
  savedAt: now - 1000,
  submission: {
    requestId: "ecf9d1a9-52c0-46b2-afb4-5f5c09b77323", checkoutUserId: null,
    items: [{ id: "findik", quantity: 2 }], name: "Demo Kullanıcı", email: "demo@example.com",
    phone: "0555 111 22 33", address: "Demo Mahallesi, Test Sokak 1", city: "İstanbul", district: "Kadıköy", demoConsent: true,
  },
};

test("serialized checkout restores its original identity, request ID, and immutable contact details", () => {
  assert.deepEqual(parseCheckoutRecovery(JSON.stringify(attempt), now), { kind: "valid", attempt });
  const signedIn = { ...attempt, submission: { ...attempt.submission, checkoutUserId: "cb12f5a5-122b-477f-9a74-2f81afed4af4" } };
  assert.deepEqual(parseCheckoutRecovery(JSON.stringify(signedIn), now), { kind: "valid", attempt: signedIn });
  assert.deepEqual(parseCheckoutRecovery(null, now), { kind: "none" });
});

test("older attempts require explicit recovery and expire before guest idempotency retention ends", () => {
  const older = { ...attempt, savedAt: now - AUTO_RECOVERY_TTL };
  assert.deepEqual(parseCheckoutRecovery(JSON.stringify(older), now), { kind: "older", attempt: older });
  assert.deepEqual(parseCheckoutRecovery(JSON.stringify({ ...attempt, savedAt: now - MAX_RECOVERY_TTL }), now), { kind: "expired" });
  assert.equal(parseCheckoutRecovery(JSON.stringify({ ...attempt, savedAt: now - MAX_RECOVERY_TTL + 1 }), now).kind, "older");
});

test("corrupt versions, future timestamps, malformed JSON, and oversized storage cannot restore a request", () => {
  for (const raw of ["{", "null", "[]", " ".repeat(16_385),
    JSON.stringify({ ...attempt, version: 2 }),
    JSON.stringify({ ...attempt, savedAt: now + 60_001 }),
    JSON.stringify({ ...attempt, savedAt: String(now) }),
  ]) assert.deepEqual(parseCheckoutRecovery(raw, now), { kind: "invalid" });
});

test("restoration rejects tampered identities, catalog lines, consent, and contact fields", () => {
  const invalid = [
    { requestId: "not-a-uuid" }, { checkoutUserId: "another-user" }, { checkoutUserId: undefined },
    { demoConsent: false }, { name: "x".repeat(101) }, { email: "invalid" },
    { phone: "123" }, { phone: "5555555555555555" }, { address: "short" }, { city: "" },
    { items: [{ id: "unknown", quantity: 1 }] }, { items: [{ id: "findik", quantity: 100 }] },
    { items: [{ id: "findik", quantity: 1.5 }] },
    { items: [{ id: "findik", quantity: 1 }, { id: "findik", quantity: 1 }] },
  ];
  for (const patch of invalid) {
    const submission = { ...attempt.submission, ...patch };
    assert.equal(isOrderSubmission(submission), false);
    assert.deepEqual(parseCheckoutRecovery(JSON.stringify({ ...attempt, submission }), now), { kind: "invalid" });
  }
});
