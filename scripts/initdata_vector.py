#!/usr/bin/env python3
"""Independent reference implementation of Telegram initData signing (Python hmac).

Used once to produce the known-good vector committed at
apps/api/test/fixtures/initdata-vector.json, so the TypeScript test helper and the
production validator are checked against something that is not either of them.

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

fields = {
    "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
    "user": json.dumps(USER, separators=(",", ":"), ensure_ascii=False),
    "auth_date": str(AUTH_DATE),
    "start_param": "join_abc123",
}

data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
digest = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

query = "&".join(f"{k}={quote(v, safe='')}" for k, v in fields.items()) + f"&hash={digest}"

print(json.dumps({
    "botToken": BOT_TOKEN,
    "authDate": AUTH_DATE,
    "dataCheckString": data_check_string,
    "hash": digest,
    "initData": query,
}, indent=2, ensure_ascii=False))
