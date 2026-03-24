import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// VAPID public key - 前端订阅时需要
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 
  "BN5klMscVbp0ny9QqmIh2q5hSV7yT8UtrFyuxq-KGi9PdZQoghf7C4-yityv9keIVLEzpTGUonGF0uffbNR5xyo";

// GET: 获取 VAPID public key 和已订阅设备列表
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");

  try {
    if (action === "vapid-key") {
      return NextResponse.json({ vapidPublicKey: VAPID_PUBLIC_KEY });
    }

    // 默认：获取所有订阅
    const result = await pool.query(
      "SELECT id, device_name, endpoint, enabled, created_at, updated_at FROM push_subscriptions ORDER BY created_at DESC"
    );
    return NextResponse.json({ subscriptions: result.rows });
  } catch (error) {
    console.error("Push subscription GET error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

// POST: 注册新订阅 / 删除订阅 / 切换启用状态
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "subscribe": {
        const { endpoint, keys, deviceName } = body;
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
          return NextResponse.json(
            { error: "Missing subscription fields" },
            { status: 400 }
          );
        }
        const result = await pool.query(
          `INSERT INTO push_subscriptions (endpoint, key_p256dh, key_auth, device_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (endpoint) DO UPDATE SET
             key_p256dh = EXCLUDED.key_p256dh,
             key_auth = EXCLUDED.key_auth,
             device_name = EXCLUDED.device_name,
             enabled = TRUE
           RETURNING id, device_name, endpoint, enabled, created_at`,
          [endpoint, keys.p256dh, keys.auth, deviceName || ""]
        );
        return NextResponse.json({ subscription: result.rows[0] });
      }

      case "unsubscribe": {
        const { id, endpoint: ep } = body;
        if (id) {
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
        } else if (ep) {
          await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [ep]);
        }
        return NextResponse.json({ success: true });
      }

      case "toggle": {
        const { id: toggleId, enabled } = body;
        if (!toggleId) {
          return NextResponse.json({ error: "Missing id" }, { status: 400 });
        }
        await pool.query(
          "UPDATE push_subscriptions SET enabled = $1 WHERE id = $2",
          [enabled, toggleId]
        );
        return NextResponse.json({ success: true });
      }

      case "rename": {
        const { id: renameId, deviceName: newName } = body;
        if (!renameId) {
          return NextResponse.json({ error: "Missing id" }, { status: 400 });
        }
        await pool.query(
          "UPDATE push_subscriptions SET device_name = $1 WHERE id = $2",
          [newName || "", renameId]
        );
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Push subscription POST error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
