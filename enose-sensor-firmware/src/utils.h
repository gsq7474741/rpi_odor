/**
 * @file    utils.h
 * @brief   精简版工具类 - 移除SD卡和RTC依赖
 */

#ifndef UTILS_H
#define UTILS_H

#include <Arduino.h>
#include "demo_app.h"

class utils {
private:
    static uint64_t _tickMs;
    static uint64_t _tickOverFlowCnt;

public:
    /**
     * @brief 初始化工具模块
     * @return EDK_OK
     */
    static demoRetCode begin();

    /**
     * @brief 获取 tick 值 (毫秒)，处理溢出
     * @return 毫秒时间戳
     */
    static uint64_t getTickMs();

    /**
     * @brief 获取 ESP32 MAC 地址字符串
     * @return MAC 地址 (12字符十六进制)
     */
    static String getMacAddress();
};

#endif
