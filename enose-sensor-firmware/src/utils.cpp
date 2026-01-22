/**
 * @file    utils.cpp
 * @brief   精简版工具类实现
 */

#include "utils.h"

uint64_t utils::_tickMs = 0;
uint64_t utils::_tickOverFlowCnt = 0;

demoRetCode utils::begin() {
    randomSeed(esp_random());
    return EDK_OK;
}

uint64_t utils::getTickMs() {
    uint64_t timeMs = millis();
    if (_tickMs > timeMs) {
        _tickOverFlowCnt++;
    }
    _tickMs = timeMs;
    return timeMs + (_tickOverFlowCnt * UINT64_C(0xFFFFFFFF));
}

String utils::getMacAddress() {
    uint64_t mac = ESP.getEfuseMac();
    char* macPtr = (char*)&mac;
    char macStr[13];
    
    sprintf(macStr, "%02X%02X%02X%02X%02X%02X", 
            macPtr[0], macPtr[1], macPtr[2], 
            macPtr[3], macPtr[4], macPtr[5]);
    
    return String(macStr);
}
