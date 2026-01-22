/**
 * @file    cmd_handler.h
 * @brief   串口命令处理器 - 处理来自树莓派上位机的命令
 */

#ifndef CMD_HANDLER_H
#define CMD_HANDLER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include <vector>
#include "demo_app.h"
#include "core/sensor_array.h"

class CmdHandler {
public:
    using StartCallback = std::function<void(const std::vector<uint8_t>&)>;
    using StopCallback = std::function<void()>;
    using InitCallback = std::function<demoRetCode(const String&)>;
    using ConfigCallback = std::function<demoRetCode(const JsonDocument&)>;

    CmdHandler();
    
    void begin(Stream& primary, Stream* secondary = nullptr);
    
    void setStartCallback(StartCallback cb) { _onStart = cb; }
    void setStopCallback(StopCallback cb) { _onStop = cb; }
    void setInitCallback(InitCallback cb) { _onInit = cb; }
    void setConfigCallback(ConfigCallback cb) { _onConfig = cb; }
    void setSensorArray(ISensorArray* sensors) { _sensors = sensors; }
    
    /**
     * @brief 处理串口输入，应在 loop() 中调用
     * @return true 如果有命令被处理
     */
    bool process();
    
    /**
     * @brief 发送确认响应
     */
    void sendAck(int id, bool ok);
    
    /**
     * @brief 发送带额外数据的确认响应
     */
    template<typename T>
    void sendAckWith(int id, bool ok, const char* key, T value);
    
    /**
     * @brief 发送错误响应
     */
    void sendError(int id, int code, const char* msg);
    
    /**
     * @brief 获取当前活跃的输出串口
     */
    Stream* getActiveSerial() { return _activeSerial ? _activeSerial : _serial; }
    
private:
    Stream* _serial;           // 主串口 (USB)
    Stream* _serial2;          // 备用串口 (GPIO 16/17)
    Stream* _activeSerial;     // 当前活跃的串口 (收到命令的那个)
    String _buffer;
    String _buffer2;           // 第二个串口的缓冲区
    
    StartCallback _onStart;
    StopCallback _onStop;
    InitCallback _onInit;
    ConfigCallback _onConfig;
    ISensorArray* _sensors;
    
    bool _isRunning;
    
    bool processSerial(Stream* serial, String& buffer);
    
    void handleCommand(const JsonDocument& doc);
    void cmdSync(int id);
    void cmdInit(int id, const JsonDocument& doc);
    void cmdConfig(int id, const JsonDocument& doc);
    void cmdStart(int id, const JsonDocument& doc);
    void cmdStop(int id);
    void cmdStatus(int id);
    void cmdReset(int id);
};

template<typename T>
void CmdHandler::sendAckWith(int id, bool ok, const char* key, T value) {
    StaticJsonDocument<256> doc;
    doc["type"] = "ack";
    doc["id"] = id;
    doc["ok"] = ok;
    doc[key] = value;
    serializeJson(doc, *_activeSerial);
    _activeSerial->println();
}

#endif
