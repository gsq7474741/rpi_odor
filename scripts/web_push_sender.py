#!/usr/bin/env python3
"""
Web Push 发送器 - 由 C++ 后端 subprocess 调用
用法: python3 web_push_sender.py '{"title":"...", "body":"...", "url":"/run"}'
从数据库读取所有启用的推送订阅并发送通知。
"""
import sys
import json
import psycopg2
from pywebpush import webpush, WebPushException

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

VAPID_PRIVATE_KEY = "OnzuXW6ncsEm63nD5VRBpUDrvaUdDQnZmq7dpfLsESs"
VAPID_CLAIMS = {
    "sub": "mailto:gsq7474741@icloud.com",
}


def get_enabled_subscriptions():
    """从数据库获取所有启用的推送订阅"""
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, endpoint, key_p256dh, key_auth, device_name "
                "FROM push_subscriptions WHERE enabled = TRUE"
            )
            rows = cur.fetchall()
            return [
                {
                    "id": row[0],
                    "endpoint": row[1],
                    "key_p256dh": row[2],
                    "key_auth": row[3],
                    "device_name": row[4],
                }
                for row in rows
            ]
    finally:
        conn.close()


def send_push(subscription_info, data_json):
    """向单个订阅发送推送"""
    sub = {
        "endpoint": subscription_info["endpoint"],
        "keys": {
            "p256dh": subscription_info["key_p256dh"],
            "auth": subscription_info["key_auth"],
        },
    }

    # 根据 endpoint 推断 aud
    from urllib.parse import urlparse
    parsed = urlparse(subscription_info["endpoint"])
    claims = {
        **VAPID_CLAIMS,
        "aud": f"{parsed.scheme}://{parsed.netloc}",
    }

    webpush(
        sub,
        data_json,
        vapid_private_key=VAPID_PRIVATE_KEY,
        vapid_claims=claims,
        timeout=10,
    )


def main():
    if len(sys.argv) < 2:
        print("Usage: web_push_sender.py '<json_payload>'", file=sys.stderr)
        sys.exit(1)

    payload = sys.argv[1]

    # 验证 JSON 格式
    try:
        json.loads(payload)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON payload: {e}", file=sys.stderr)
        sys.exit(1)

    subscriptions = get_enabled_subscriptions()
    if not subscriptions:
        print("No enabled subscriptions found")
        return

    # 并发发送，每个订阅独立线程，互不阻塞
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _send_one(sub):
        name = sub['device_name'] or str(sub['id'])
        try:
            send_push(sub, payload)
            return (True, name, None)
        except WebPushException as e:
            # 410 Gone = 订阅已失效，自动清理
            if hasattr(e, 'response') and e.response is not None and e.response.status_code == 410:
                try:
                    conn = psycopg2.connect(**DB_CONFIG)
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM push_subscriptions WHERE id = %s", (sub["id"],))
                    conn.commit()
                    conn.close()
                except Exception:
                    pass
                return (False, name, f"expired (removed)")
            return (False, name, str(e)[:200])
        except Exception as e:
            return (False, name, str(e)[:200])

    success_count = 0
    fail_count = 0
    with ThreadPoolExecutor(max_workers=len(subscriptions)) as executor:
        futures = {executor.submit(_send_one, sub): sub for sub in subscriptions}
        for future in as_completed(futures):
            ok, name, err = future.result()
            if ok:
                print(f"OK: {name}")
                success_count += 1
            else:
                print(f"FAIL: {name}: {err}", file=sys.stderr)
                fail_count += 1

    print(f"Done: {success_count} sent, {fail_count} failed")


if __name__ == "__main__":
    main()
