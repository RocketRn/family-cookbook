#!/usr/bin/env python3
"""Independent reference implementation of Telegram initData signing (Python hmac).

Produces the known-good vectors committed at apps/api/test/fixtures/initdata-vector.json,
so the TypeScript test signer, the production validator and the browser dev signer are all
checked against something that is not any of them.

Bot-token (HMAC) method, per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
(confirmed by the product owner): the data-check-string is ALL received fields except `hash`,
sorted by key, as key=<value>, joined by "\\n". The `signature` field (used only by the
third-party Ed25519 method) is NOT removed for the HMAC method.

Usage: python3 scripts/initdata_vector.py > apps/api/test/fixtures/initdata-vector.json
"""
import hashlib
import hmac
import json
from urllib.parse import quote

BOT_TOKEN = "123456:TEST-FAKE-TOKEN-FOR-UNIT-TESTS"  # fake, test-only
AUTH_DATE = 1_760_000_000  # 2025-10-09T08:53:20Z
USER = {
    "id": 279058397,
    "first_name": "Vladislav + Vlad",
    "username": "vlad",
    "language_code": "ru",
    "allows_write_to_pm": True,
}
# Fake Ed25519-style signature (base64url, 86 chars). Its value is irrelevant to the HMAC
# method; what matters is that it is part of the data-check-string.
FAKE_SIGNATURE = ("c2lnbmF0dXJlLWZpZWxkLWZvci10ZXN0cy1vbmx5" * 3)[:86]


def vector(fields):
    data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    query = "&".join(f"{k}={quote(v, safe='')}" for k, v in fields.items()) + f"&hash={digest}"
    return {"dataCheckString": data_check_string, "hash": digest, "initData": query}


base = {
    "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
    "user": json.dumps(USER, separators=(",", ":"), ensure_ascii=False),
    "auth_date": str(AUTH_DATE),
    "start_param": "join_abc123",
}
with_signature = {**base, "signature": FAKE_SIGNATURE}

out = {"botToken": BOT_TOKEN, "authDate": AUTH_DATE, **vector(base), "withSignature": vector(with_signature)}
# The hash a WRONG implementation would produce if it also dropped `signature`.
out["withSignature"]["hashIfSignatureWereExcluded"] = vector(base)["hash"]
print(json.dumps(out, indent=2, ensure_ascii=False))
