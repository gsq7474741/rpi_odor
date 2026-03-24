#!/usr/bin/env python3
"""Quick test for web_push_sender.py on RPi"""
import subprocess
import sys
import json

payload = json.dumps({"title": "测试推送", "body": "这是一条测试消息", "url": "/run"})
result = subprocess.run(
    [sys.executable, "/home/user/rpi_odor/scripts/web_push_sender.py", payload],
    capture_output=True, text=True
)
print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)
print("Return code:", result.returncode)
