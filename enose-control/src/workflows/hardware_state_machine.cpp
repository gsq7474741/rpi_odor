#include "workflows/hardware_state_machine.hpp"
#include <spdlog/spdlog.h>

namespace workflows {

HardwareStateMachine::HardwareStateMachine(std::shared_ptr<SystemState> legacy_state)
    : legacy_state_(std::move(legacy_state))
    , current_state_(HardwareState::IDLE)
{
    initialize_transition_rules();
    
    // 注册反向同步回调：当 SystemState (L0) 变化时，同步更新 HardwareStateMachine (L1)
    // 这解决了 Gemini 评估指出的"双重状态机同步风险"问题
    if (legacy_state_) {
        legacy_state_->set_state_callback(
            [this](SystemState::State old_state, SystemState::State new_state) {
                on_legacy_state_changed(old_state, new_state);
            }
        );
        spdlog::info("HardwareStateMachine: 已注册 SystemState 反向同步回调");
    }
    
    spdlog::info("HardwareStateMachine 初始化完成");
}

void HardwareStateMachine::initialize_transition_rules() {
    // 定义合法的状态转换
    valid_transitions_ = {
        // 从 IDLE 可以转换到任何准备状态
        {HardwareState::IDLE, {
            HardwareState::INJECT_PREPARING,
            HardwareState::DRAIN_PREPARING,
            HardwareState::CLEAN_PREPARING,
            HardwareState::SAMPLE_PREPARING,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        
        // 进样流程
        {HardwareState::INJECT_PREPARING, {
            HardwareState::INJECT_RUNNING,
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        {HardwareState::INJECT_RUNNING, {
            HardwareState::INJECT_STABILIZING,
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        {HardwareState::INJECT_STABILIZING, {
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        
        // 排废流程
        {HardwareState::DRAIN_PREPARING, {
            HardwareState::DRAIN_RUNNING,
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        {HardwareState::DRAIN_RUNNING, {
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        
        // 清洗流程
        {HardwareState::CLEAN_PREPARING, {
            HardwareState::CLEAN_FILLING,
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        {HardwareState::CLEAN_FILLING, {
            HardwareState::CLEAN_DRAINING,
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        {HardwareState::CLEAN_DRAINING, {
            HardwareState::CLEAN_FILLING,  // 循环清洗
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        
        // 采样流程
        {HardwareState::SAMPLE_PREPARING, {
            HardwareState::SAMPLE_ACQUIRING,
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        {HardwareState::SAMPLE_ACQUIRING, {
            HardwareState::IDLE,
            HardwareState::ERROR,
            HardwareState::EMERGENCY_STOP,
        }},
        
        // 错误状态只能恢复到 IDLE
        {HardwareState::ERROR, {
            HardwareState::IDLE,
        }},
        
        // 紧急停止只能恢复到 IDLE
        {HardwareState::EMERGENCY_STOP, {
            HardwareState::IDLE,
        }},
    };
}

TransitionResult HardwareStateMachine::request_transition(HardwareState target) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (current_state_ == target) {
        return TransitionResult::ok(current_state_, current_state_);
    }
    
    // 检查转换是否合法
    if (!can_transition_to(target)) {
        std::string error = "Invalid transition: " + 
            std::string(state_to_string(current_state_)) + " -> " + 
            std::string(state_to_string(target));
        spdlog::warn("HardwareStateMachine: {}", error);
        return TransitionResult::fail(error, current_state_);
    }
    
    // 执行转换
    HardwareState prev = current_state_;
    current_state_ = target;
    
    spdlog::info("HardwareStateMachine: {} -> {}", 
        state_to_string(prev), state_to_string(target));
    
    // 应用到旧版状态机
    apply_legacy_state(target);
    
    // 通知回调
    if (state_callback_) {
        state_callback_(prev, target);
    }
    
    return TransitionResult::ok(prev, target);
}

TransitionResult HardwareStateMachine::force_transition(HardwareState target) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    HardwareState prev = current_state_;
    current_state_ = target;
    
    spdlog::warn("HardwareStateMachine: FORCE {} -> {}", 
        state_to_string(prev), state_to_string(target));
    
    apply_legacy_state(target);
    
    if (state_callback_) {
        state_callback_(prev, target);
    }
    
    return TransitionResult::ok(prev, target);
}

bool HardwareStateMachine::can_transition_to(HardwareState target) const {
    auto it = valid_transitions_.find(current_state_);
    if (it == valid_transitions_.end()) {
        return false;
    }
    
    const auto& targets = it->second;
    return std::find(targets.begin(), targets.end(), target) != targets.end();
}

std::vector<HardwareState> HardwareStateMachine::get_available_transitions() const {
    std::lock_guard<std::mutex> lock(mutex_);
    
    auto it = valid_transitions_.find(current_state_);
    if (it == valid_transitions_.end()) {
        return {};
    }
    return it->second;
}

SystemState::State HardwareStateMachine::to_legacy_state(HardwareState state) const {
    switch (state) {
        case HardwareState::IDLE:
        case HardwareState::ERROR:
        case HardwareState::EMERGENCY_STOP:
            return SystemState::State::INITIAL;
            
        case HardwareState::INJECT_PREPARING:
        case HardwareState::INJECT_RUNNING:
        case HardwareState::INJECT_STABILIZING:
            return SystemState::State::INJECT;
            
        case HardwareState::DRAIN_PREPARING:
        case HardwareState::DRAIN_RUNNING:
            return SystemState::State::DRAIN;
            
        case HardwareState::CLEAN_PREPARING:
        case HardwareState::CLEAN_FILLING:
        case HardwareState::CLEAN_DRAINING:
            return SystemState::State::CLEAN;
            
        case HardwareState::SAMPLE_PREPARING:
        case HardwareState::SAMPLE_ACQUIRING:
            return SystemState::State::SAMPLE;
            
        default:
            return SystemState::State::INITIAL;
    }
}

HardwareState HardwareStateMachine::from_legacy_state(SystemState::State state) const {
    switch (state) {
        case SystemState::State::INITIAL:
            return HardwareState::IDLE;
        case SystemState::State::INJECT:
            return HardwareState::INJECT_RUNNING;
        case SystemState::State::DRAIN:
            return HardwareState::DRAIN_RUNNING;
        case SystemState::State::CLEAN:
            return HardwareState::CLEAN_FILLING;
        case SystemState::State::SAMPLE:
            return HardwareState::SAMPLE_ACQUIRING;
        default:
            return HardwareState::IDLE;
    }
}

void HardwareStateMachine::apply_legacy_state(HardwareState state) {
    if (!legacy_state_) return;
    
    auto legacy = to_legacy_state(state);
    legacy_state_->transition_to(legacy);
}

TransitionResult HardwareStateMachine::emergency_stop() {
    spdlog::error("HardwareStateMachine: EMERGENCY STOP triggered!");
    return force_transition(HardwareState::EMERGENCY_STOP);
}

TransitionResult HardwareStateMachine::recover_from_error() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (current_state_ != HardwareState::ERROR && 
        current_state_ != HardwareState::EMERGENCY_STOP) {
        return TransitionResult::fail("Not in error state", current_state_);
    }
    
    HardwareState prev = current_state_;
    current_state_ = HardwareState::IDLE;
    
    spdlog::info("HardwareStateMachine: Recovered from {} to IDLE", state_to_string(prev));
    
    apply_legacy_state(HardwareState::IDLE);
    
    if (state_callback_) {
        state_callback_(prev, HardwareState::IDLE);
    }
    
    return TransitionResult::ok(prev, HardwareState::IDLE);
}

void HardwareStateMachine::on_legacy_state_changed(
    SystemState::State old_state, SystemState::State new_state) 
{
    // 反向同步：当 SystemState (L0) 被外部修改时，同步 HardwareStateMachine (L1)
    // 这通常发生在：急停按钮触发、硬件限位开关触发、或其他非 Executor 路径的状态变更
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    // 将底层状态映射到细粒度状态
    HardwareState mapped_state = from_legacy_state(new_state);
    
    // 如果当前状态与映射状态一致，无需同步（避免循环触发）
    if (to_legacy_state(current_state_) == new_state) {
        return;
    }
    
    HardwareState prev = current_state_;
    current_state_ = mapped_state;
    
    spdlog::info("HardwareStateMachine: 反向同步 {} → {} (L0: {} → {})",
        state_to_string(prev), state_to_string(current_state_),
        SystemState::state_to_string(old_state),
        SystemState::state_to_string(new_state));
    
    // 通知状态变化监听器
    if (state_callback_) {
        state_callback_(prev, current_state_);
    }
}

} // namespace workflows
