/**
 * @file    cmd_handler.cpp
 * @brief   串口命令处理器实现
 */

#include "cmd_handler.h"

CmdHandler::CmdHandler() 
    : _serial(nullptr), _serial2(nullptr), _activeSerial(nullptr), 
      _sensors(nullptr), _isRunning(false) {}

void CmdHandler::begin(Stream& primary, Stream* secondary) {
    _serial = &primary;
    _serial2 = secondary;
    _activeSerial = _serial;  // 默认使用主串口
    _buffer.reserve(512);
    _buffer2.reserve(512);
}

bool CmdHandler::processSerial(Stream* serial, String& buffer) {
    if (!serial) return false;
    
    while (serial->available()) {
        char c = serial->read();
        if (c == '\n') {
            if (buffer.length() > 0) {
                StaticJsonDocument<1024> doc;
                DeserializationError err = deserializeJson(doc, buffer);
                buffer = "";
                
                if (!err) {
                    // 切换到收到命令的串口
                    _activeSerial = serial;
                    handleCommand(doc);
                    return true;
                } else {
                    Stream* oldActive = _activeSerial;
                    _activeSerial = serial;
                    sendError(0, -1, "JSON_PARSE_ERROR");
                    _activeSerial = oldActive;
                }
            }
        } else if (c != '\r') {
            buffer += c;
            if (buffer.length() > 1024) {
                buffer = "";
                Stream* oldActive = _activeSerial;
                _activeSerial = serial;
                sendError(0, -2, "BUFFER_OVERFLOW");
                _activeSerial = oldActive;
            }
        }
    }
    return false;
}

bool CmdHandler::process() {
    // 先检查主串口
    if (processSerial(_serial, _buffer)) {
        return true;
    }
    // 再检查备用串口
    if (processSerial(_serial2, _buffer2)) {
        return true;
    }
    return false;
}

void CmdHandler::handleCommand(const JsonDocument& doc) {
    const char* cmd = doc["cmd"];
    int id = doc["id"] | 0;
    
    if (!cmd) {
        sendError(id, -3, "MISSING_CMD");
        return;
    }
    
    if (strcmp(cmd, "sync") == 0) {
        cmdSync(id);
    } else if (strcmp(cmd, "init") == 0) {
        cmdInit(id, doc);
    } else if (strcmp(cmd, "config") == 0) {
        cmdConfig(id, doc);
    } else if (strcmp(cmd, "start") == 0) {
        cmdStart(id, doc);
    } else if (strcmp(cmd, "stop") == 0) {
        cmdStop(id);
    } else if (strcmp(cmd, "status") == 0) {
        cmdStatus(id);
    } else if (strcmp(cmd, "reset") == 0) {
        cmdReset(id);
    } else {
        sendError(id, -4, "UNKNOWN_CMD");
    }
}

void CmdHandler::cmdSync(int id) {
    sendAckWith(id, true, "tick_ms", (uint32_t)millis());
}

void CmdHandler::cmdInit(int id, const JsonDocument& doc) {
    if (_onInit) {
        const char* configFile = doc["params"]["config_file"] | "";
        demoRetCode ret = _onInit(String(configFile));
        
        if (ret >= EDK_OK) {
            sendAckWith(id, true, "sensors", 8);
        } else {
            sendError(id, ret, "INIT_FAILED");
        }
    } else {
        sendError(id, -5, "NO_INIT_HANDLER");
    }
}

void CmdHandler::cmdConfig(int id, const JsonDocument& doc) {
    if (_onConfig) {
        demoRetCode ret = _onConfig(doc);
        if (ret >= EDK_OK) {
            sendAck(id, true);
        } else {
            sendError(id, ret, "CONFIG_FAILED");
        }
    } else {
        sendError(id, -7, "NO_CONFIG_HANDLER");
    }
}

void CmdHandler::cmdStart(int id, const JsonDocument& doc) {
    if (_isRunning) {
        sendError(id, -6, "ALREADY_RUNNING");
        return;
    }
    
    std::vector<uint8_t> sensorList;
    JsonArrayConst sensors = doc["params"]["sensors"];
    
    if (sensors.isNull()) {
        for (uint8_t i = 0; i < 8; i++) {
            sensorList.push_back(i);
        }
    } else {
        for (JsonVariantConst v : sensors) {
            uint8_t idx = v.as<uint8_t>();
            if (idx < 8) {
                sensorList.push_back(idx);
            }
        }
    }
    
    _isRunning = true;
    if (_onStart) {
        _onStart(sensorList);
    }
    sendAck(id, true);
}

void CmdHandler::cmdStop(int id) {
    _isRunning = false;
    if (_onStop) {
        _onStop();
    }
    sendAck(id, true);
}

void CmdHandler::cmdStatus(int id) {
    StaticJsonDocument<512> doc;
    doc["type"] = "status";
    doc["id"] = id;
    doc["tick_ms"] = (uint32_t)millis();
    doc["running"] = _isRunning;
    
    JsonArray arr = doc.createNestedArray("sensors");
    if (_sensors) {
        uint8_t count = _sensors->getSensorCount();
        for (uint8_t i = 0; i < count; i++) {
            JsonObject obj = arr.createNestedObject();
            obj["idx"] = i;
            obj["id"] = _sensors->getSensorId(i);
            obj["ok"] = _sensors->isConfigured(i);
        }
    }
    
    serializeJson(doc, *_activeSerial);
    _activeSerial->println();
}

void CmdHandler::cmdReset(int id) {
    sendAck(id, true);
    delay(100);
    ESP.restart();
}

void CmdHandler::sendAck(int id, bool ok) {
    StaticJsonDocument<128> doc;
    doc["type"] = "ack";
    doc["id"] = id;
    doc["ok"] = ok;
    serializeJson(doc, *_activeSerial);
    _activeSerial->println();
}

void CmdHandler::sendError(int id, int code, const char* msg) {
    StaticJsonDocument<256> doc;
    doc["type"] = "error";
    doc["id"] = id;
    doc["code"] = code;
    doc["msg"] = msg;
    serializeJson(doc, *_activeSerial);
    _activeSerial->println();
}
