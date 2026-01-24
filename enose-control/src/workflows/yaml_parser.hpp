#pragma once

#include <string>
#include "enose_experiment.pb.h"

namespace enose {
namespace workflows {

/**
 * YAML 到 Protobuf 解析器
 * 
 * 将 YAML 格式的实验程序转换为 ExperimentProgram protobuf 消息
 */
class YamlParser {
public:
    struct ParseResult {
        bool success = false;
        std::string error_message;
        ::enose::experiment::ExperimentProgram program;
    };
    
    /**
     * 解析 YAML 字符串为 ExperimentProgram
     * 
     * @param yaml_content YAML 格式的实验程序内容
     * @return 解析结果
     */
    static ParseResult parse(const std::string& yaml_content);
};

} // namespace workflows
} // namespace enose
