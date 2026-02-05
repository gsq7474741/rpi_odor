#pragma once

#include <optional>
#include <string>
#include <vector>
#include <cstdint>

namespace db {

struct PhaseTransitionRecord {
    int32_t id = 0;
    int32_t sample_id = 0;
    std::string phase_name;
    int64_t start_time_ms = 0;
    std::optional<int64_t> end_time_ms;
    int16_t phase_order = 0;
};

class PhaseTransitionRepository {
public:
    PhaseTransitionRepository() = default;
    ~PhaseTransitionRepository() = default;

    std::optional<int32_t> create_transition(
        int32_t sample_id,
        const std::string& phase_name,
        int64_t start_time_ms,
        int16_t phase_order
    );

    bool complete_transition(
        int32_t sample_id,
        int16_t phase_order,
        int64_t end_time_ms
    );

    bool complete_all_transitions(
        int32_t sample_id,
        int64_t end_time_ms
    );

    std::vector<PhaseTransitionRecord> get_transitions_by_sample(int32_t sample_id);

    std::optional<PhaseTransitionRecord> get_current_transition(int32_t sample_id);
};

} // namespace db
