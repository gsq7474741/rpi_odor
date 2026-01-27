#include "workflows/action_executor.hpp"
#include <spdlog/spdlog.h>

namespace workflows {

// ActionExecutorBase 实现

void ActionExecutorBase::add_log(const std::string& message) {
    if (log_callback_) {
        log_callback_(message);
    } else {
        spdlog::info("[{}] {}", name(), message);
    }
}

bool ActionExecutorBase::check_stop_or_pause() {
    if (stop_check_callback_) {
        return stop_check_callback_();
    }
    return false;
}

// ActionExecutorFactory 实现

ActionExecutorFactory& ActionExecutorFactory::instance() {
    static ActionExecutorFactory factory;
    return factory;
}

std::shared_ptr<IActionExecutor> ActionExecutorFactory::get_executor(const std::string& action_type) {
    auto it = executors_.find(action_type);
    if (it != executors_.end()) {
        return it->second;
    }
    return nullptr;
}

std::shared_ptr<IActionExecutor> ActionExecutorFactory::get_executor_for_step(
    const enose::experiment::Step& step)
{
    std::string action_type;
    
    switch (step.action_case()) {
        case enose::experiment::Step::kInject:
            action_type = "inject";
            break;
        case enose::experiment::Step::kDrain:
            action_type = "drain";
            break;
        case enose::experiment::Step::kAcquire:
            action_type = "acquire";
            break;
        case enose::experiment::Step::kWash:
            action_type = "wash";
            break;
        case enose::experiment::Step::kWait:
            action_type = "wait";
            break;
        case enose::experiment::Step::kSetState:
            action_type = "set_state";
            break;
        case enose::experiment::Step::kSetGasPump:
            action_type = "set_gas_pump";
            break;
        case enose::experiment::Step::kLoop:
            action_type = "loop";
            break;
        case enose::experiment::Step::kPhaseMarker:
            action_type = "phase_marker";
            break;
        default:
            return nullptr;
    }
    
    return get_executor(action_type);
}

} // namespace workflows
