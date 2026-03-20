"""模拟前端调用，检查 S#604 和 S#610 的帧 API 和 raw API 返回"""
import json
import urllib.request

BASE = "http://127.0.0.1:3000"

for sid, run_id in [(604, 29), (610, 35)]:
    print(f"\n{'='*60}")
    print(f"Sample #{sid} (run {run_id})")
    print('='*60)

    # 1. Frames API
    url = f"{BASE}/api/samples?action=frames&sampleId={sid}&method=linear&nSamples=100"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        print(f"\n  Frames API:")
        print(f"    success={data.get('success')}")
        print(f"    nSamples={data.get('nSamples')}, nSensors={data.get('nSensors')}")
        frames = data.get('frames', [])
        print(f"    frames count={len(frames)}")
        if frames:
            f0 = frames[0]
            print(f"    frame[0] frameIdx={f0.get('frameIdx')}, values len={len(f0.get('values', []))}")
            vals = f0.get('values', [])
            print(f"    frame[0] first 8 values: {vals[:8]}")
            # Check if values are all zero/NaN
            all_zero = all(v == 0 for v in vals[:8])
            print(f"    frame[0] all zeros? {all_zero}")
            # Check last frame
            fLast = frames[-1]
            print(f"    frame[-1] frameIdx={fLast.get('frameIdx')}, first 8: {fLast.get('values', [])[:8]}")
    except Exception as e:
        print(f"    ERROR: {e}")

    # 2. Raw sensor data API
    url = f"{BASE}/api/analytics/data?action=sensor-data&experimentId={run_id}&limit=5000"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        print(f"\n  Raw Sensor Data API:")
        print(f"    success={data.get('success')}")
        print(f"    total={data.get('total')}, returned={data.get('returned')}")
        rows = data.get('rows', [])
        print(f"    rows count={len(rows)}")
        if rows:
            r0 = rows[0]
            print(f"    row[0] ts={r0.get('ts')}, moxReadings len={len(r0.get('moxReadings', []))}")
            print(f"    row[0] moxReadings={r0.get('moxReadings', [])[:4]}...")
            
            # Simulate frontend filtering for the sample
            # Need sample startTimeMs and endTimeMs
            from datetime import datetime
            import psycopg2
            conn = psycopg2.connect(
                host="192.168.1.235", port=5432, database="enose",
                user="enose", password="enose_secure_password_change_me"
            )
            with conn.cursor() as cur:
                cur.execute("SELECT start_time_ms, end_time_ms FROM samples WHERE id = %s", (sid,))
                s_start, s_end = cur.fetchone()
            conn.close()
            
            # Filter like frontend does
            filtered = 0
            skipped = 0
            for row in rows:
                ts_str = row.get('ts')
                if ts_str:
                    ts_ms = int(datetime.fromisoformat(ts_str.replace('Z', '+00:00')).timestamp() * 1000)
                    if ts_ms >= s_start and ts_ms <= s_end:
                        filtered += 1
                    else:
                        skipped += 1
                else:
                    skipped += 1
            print(f"    After time filter [{s_start} ~ {s_end}]: kept={filtered}, skipped={skipped}")
    except Exception as e:
        print(f"    ERROR: {e}")
