#include "phase_transition_repository.hpp"
#include "connection_pool.hpp"
#include <spdlog/spdlog.h>
#include <pqxx/pqxx>

namespace db {

std::optional<int32_t> PhaseTransitionRepository::create_transition(
    int32_t sample_id,
    const std::string& phase_name,
    int64_t start_time_ms,
    int16_t phase_order
) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("PhaseTransitionRepository: failed to acquire connection");
        return std::nullopt;
    }

    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            R"(
                INSERT INTO sample_phase_transitions 
                    (sample_id, phase_name, start_time_ms, phase_order)
                VALUES ($1, $2, $3, $4)
                RETURNING id
            )",
            sample_id,
            phase_name,
            start_time_ms,
            phase_order
        );
        
        txn.commit();
        
        if (!result.empty()) {
            int32_t id = result[0][0].as<int32_t>();
            spdlog::debug("PhaseTransitionRepository: created transition id={} for sample_id={}, phase={}",
                         id, sample_id, phase_name);
            return id;
        }
        return std::nullopt;
        
    } catch (const std::exception& e) {
        spdlog::error("PhaseTransitionRepository: create_transition error: {}", e.what());
        return std::nullopt;
    }
}

bool PhaseTransitionRepository::complete_transition(
    int32_t sample_id,
    int16_t phase_order,
    int64_t end_time_ms
) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("PhaseTransitionRepository: failed to acquire connection");
        return false;
    }

    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            R"(
                UPDATE sample_phase_transitions 
                SET end_time_ms = $3
                WHERE sample_id = $1 AND phase_order = $2 AND end_time_ms IS NULL
            )",
            sample_id,
            phase_order,
            end_time_ms
        );
        
        txn.commit();
        
        spdlog::debug("PhaseTransitionRepository: completed transition sample_id={}, phase_order={}",
                     sample_id, phase_order);
        return result.affected_rows() > 0;
        
    } catch (const std::exception& e) {
        spdlog::error("PhaseTransitionRepository: complete_transition error: {}", e.what());
        return false;
    }
}

bool PhaseTransitionRepository::complete_all_transitions(
    int32_t sample_id,
    int64_t end_time_ms
) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("PhaseTransitionRepository: failed to acquire connection");
        return false;
    }

    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            R"(
                UPDATE sample_phase_transitions 
                SET end_time_ms = $2
                WHERE sample_id = $1 AND end_time_ms IS NULL
            )",
            sample_id,
            end_time_ms
        );
        
        txn.commit();
        
        spdlog::debug("PhaseTransitionRepository: completed all transitions for sample_id={}, count={}",
                     sample_id, result.affected_rows());
        return true;
        
    } catch (const std::exception& e) {
        spdlog::error("PhaseTransitionRepository: complete_all_transitions error: {}", e.what());
        return false;
    }
}

std::vector<PhaseTransitionRecord> PhaseTransitionRepository::get_transitions_by_sample(int32_t sample_id) {
    std::vector<PhaseTransitionRecord> records;
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("PhaseTransitionRepository: failed to acquire connection");
        return records;
    }

    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            R"(
                SELECT id, sample_id, phase_name, start_time_ms, end_time_ms, phase_order
                FROM sample_phase_transitions
                WHERE sample_id = $1
                ORDER BY phase_order
            )",
            sample_id
        );
        
        txn.commit();
        
        for (const auto& row : result) {
            PhaseTransitionRecord record;
            record.id = row[0].as<int32_t>();
            record.sample_id = row[1].as<int32_t>();
            record.phase_name = row[2].as<std::string>();
            record.start_time_ms = row[3].as<int64_t>();
            if (!row[4].is_null()) {
                record.end_time_ms = row[4].as<int64_t>();
            }
            record.phase_order = row[5].as<int16_t>();
            records.push_back(std::move(record));
        }
        
    } catch (const std::exception& e) {
        spdlog::error("PhaseTransitionRepository: get_transitions_by_sample error: {}", e.what());
    }
    
    return records;
}

std::optional<PhaseTransitionRecord> PhaseTransitionRepository::get_current_transition(int32_t sample_id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("PhaseTransitionRepository: failed to acquire connection");
        return std::nullopt;
    }

    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            R"(
                SELECT id, sample_id, phase_name, start_time_ms, end_time_ms, phase_order
                FROM sample_phase_transitions
                WHERE sample_id = $1 AND end_time_ms IS NULL
                ORDER BY phase_order DESC
                LIMIT 1
            )",
            sample_id
        );
        
        txn.commit();
        
        if (!result.empty()) {
            const auto& row = result[0];
            PhaseTransitionRecord record;
            record.id = row[0].as<int32_t>();
            record.sample_id = row[1].as<int32_t>();
            record.phase_name = row[2].as<std::string>();
            record.start_time_ms = row[3].as<int64_t>();
            if (!row[4].is_null()) {
                record.end_time_ms = row[4].as<int64_t>();
            }
            record.phase_order = row[5].as<int16_t>();
            return record;
        }
        
    } catch (const std::exception& e) {
        spdlog::error("PhaseTransitionRepository: get_current_transition error: {}", e.what());
    }
    
    return std::nullopt;
}

} // namespace db
