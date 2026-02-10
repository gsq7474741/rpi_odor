#!/bin/bash
# 创建 udev 规则，将 CP2104 传感器板固定为 /dev/enose-sensor
# 运行方式: scp 到 RPi5 后 sudo bash setup_udev_sensor.sh

RULE_FILE="/etc/udev/rules.d/99-enose-sensor.rules"

echo '# CP2104 USB to UART Bridge - ENose Sensor Board (SerialNumber: 02B74C1D)' > "$RULE_FILE"
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", ATTRS{serial}=="02B74C1D", SYMLINK+="enose-sensor", MODE="0666"' >> "$RULE_FILE"

echo "Created $RULE_FILE:"
cat "$RULE_FILE"

# 重新加载 udev 规则
udevadm control --reload-rules
udevadm trigger

echo ""
echo "Done. Check: ls -la /dev/enose-sensor"
ls -la /dev/enose-sensor 2>/dev/null || echo "(device not currently connected)"
