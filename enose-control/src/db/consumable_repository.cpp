#include "consumable_repository.hpp"
#include <spdlog/spdlog.h>
#include <iomanip>
#include <sstream>

namespace db {

// ============================================================
// 时间戳工具函数
// ============================================================

std::string ConsumableRepository::format_timestamp(const std::chrono::system_clock::time_point& tp) {
    auto time_t = std::chrono::system_clock::to_time_t(tp);
    std::stringstream ss;
    ss << std::put_time(std::gmtime(&time_t), "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

std::chrono::system_clock::time_point ConsumableRepository::parse_timestamp(const std::string& ts) {
    std::tm tm = {};
    std::istringstream ss(ts);
    ss >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");
    return std::chrono::system_clock::from_time_t(std::mktime(&tm));
}

// ============================================================
// 液体管理
// ============================================================

std::vector<LiquidRecord> ConsumableRepository::list_liquids(
    const std::string& type_filter,
    bool include_inactive,
    int limit,
    int offset) {
    
    std::vector<LiquidRecord> results;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) {
            spdlog::error("ConsumableRepository: Failed to acquire connection");
            return results;
        }
        
        std::string sql = "SELECT id, name, type, description, density, "
                         "COALESCE(metadata::text, '{}'), is_active, created_at, updated_at "
                         "FROM liquids WHERE 1=1";
        
        if (!type_filter.empty()) {
            sql += " AND type = " + conn->quote(type_filter);
        }
        if (!include_inactive) {
            sql += " AND is_active = true";
        }
        sql += " ORDER BY name LIMIT " + std::to_string(limit) + 
               " OFFSET " + std::to_string(offset);
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(sql);
        
        for (const auto& row : res) {
            LiquidRecord record;
            record.id = row[0].as<int>();
            record.name = row[1].as<std::string>();
            record.type = row[2].as<std::string>();
            record.description = row[3].is_null() ? "" : row[3].as<std::string>();
            record.density = row[4].as<float>();
            record.metadata_json = row[5].as<std::string>();
            record.is_active = row[6].as<bool>();
            record.created_at = parse_timestamp(row[7].as<std::string>());
            record.updated_at = parse_timestamp(row[8].as<std::string>());
            results.push_back(record);
        }
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::list_liquids error: {}", e.what());
    }
    
    return results;
}

std::optional<LiquidRecord> ConsumableRepository::get_liquid(int id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "SELECT id, name, type, description, density, "
            "COALESCE(metadata::text, '{}'), is_active, created_at, updated_at "
            "FROM liquids WHERE id = " + std::to_string(id));
        
        if (res.empty()) return std::nullopt;
        
        const auto& row = res[0];
        LiquidRecord record;
        record.id = row[0].as<int>();
        record.name = row[1].as<std::string>();
        record.type = row[2].as<std::string>();
        record.description = row[3].is_null() ? "" : row[3].as<std::string>();
        record.density = row[4].as<float>();
        record.metadata_json = row[5].as<std::string>();
        record.is_active = row[6].as<bool>();
        record.created_at = parse_timestamp(row[7].as<std::string>());
        record.updated_at = parse_timestamp(row[8].as<std::string>());
        
        txn.commit();
        return record;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::get_liquid error: {}", e.what());
        return std::nullopt;
    }
}

std::optional<int> ConsumableRepository::create_liquid(
    const std::string& name,
    const std::string& type,
    const std::string& description,
    float density,
    const std::string& metadata_json) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "INSERT INTO liquids (name, type, description, density, metadata) "
            "VALUES (" + conn->quote(name) + ", " + conn->quote(type) + ", " +
            conn->quote(description) + ", " + std::to_string(density) + ", " +
            conn->quote(metadata_json) + "::jsonb) RETURNING id");
        
        int id = res[0][0].as<int>();
        txn.commit();
        
        spdlog::info("Created liquid: {} (id={})", name, id);
        return id;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::create_liquid error: {}", e.what());
        return std::nullopt;
    }
}

bool ConsumableRepository::update_liquid(
    int id,
    const std::string& name,
    const std::string& type,
    const std::string& description,
    float density,
    const std::string& metadata_json,
    bool is_active) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec(
            "UPDATE liquids SET name = " + conn->quote(name) +
            ", type = " + conn->quote(type) +
            ", description = " + conn->quote(description) +
            ", density = " + std::to_string(density) +
            ", metadata = " + conn->quote(metadata_json) + "::jsonb" +
            ", is_active = " + (is_active ? "true" : "false") +
            " WHERE id = " + std::to_string(id));
        
        txn.commit();
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::update_liquid error: {}", e.what());
        return false;
    }
}

bool ConsumableRepository::delete_liquid(int id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec("DELETE FROM liquids WHERE id = " + std::to_string(id));
        txn.commit();
        
        spdlog::info("Deleted liquid id={}", id);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::delete_liquid error: {}", e.what());
        return false;
    }
}

int ConsumableRepository::count_liquids(const std::string& type_filter, bool include_inactive) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return 0;
        
        std::string sql = "SELECT COUNT(*) FROM liquids WHERE 1=1";
        if (!type_filter.empty()) {
            sql += " AND type = " + conn->quote(type_filter);
        }
        if (!include_inactive) {
            sql += " AND is_active = true";
        }
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(sql);
        txn.commit();
        
        return res[0][0].as<int>();
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::count_liquids error: {}", e.what());
        return 0;
    }
}

// ============================================================
// 泵配置管理
// ============================================================

std::vector<PumpAssignmentRecord> ConsumableRepository::get_pump_assignments() {
    std::vector<PumpAssignmentRecord> results;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return results;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "SELECT pump_index, liquid_id, notes, updated_at, "
            "COALESCE(initial_volume_ml, 0), COALESCE(consumed_volume_ml, 0), "
            "COALESCE(low_volume_threshold_ml, 10) "
            "FROM pump_assignments ORDER BY pump_index");
        
        for (const auto& row : res) {
            PumpAssignmentRecord record;
            record.pump_index = row[0].as<int>();
            record.liquid_id = row[1].is_null() ? std::nullopt : std::optional<int>(row[1].as<int>());
            record.notes = row[2].is_null() ? "" : row[2].as<std::string>();
            record.updated_at = parse_timestamp(row[3].as<std::string>());
            record.initial_volume_ml = row[4].as<double>();
            record.consumed_volume_ml = row[5].as<double>();
            record.low_volume_threshold_ml = row[6].as<double>();
            results.push_back(record);
        }
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::get_pump_assignments error: {}", e.what());
    }
    
    return results;
}

bool ConsumableRepository::set_pump_assignment(int pump_index, std::optional<int> liquid_id, const std::string& notes,
                                                std::optional<double> initial_volume_ml,
                                                std::optional<double> low_volume_threshold_ml) {
    if (pump_index < 0 || pump_index > 7) {
        spdlog::error("Invalid pump_index: {}", pump_index);
        return false;
    }
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        std::string liquid_id_str = liquid_id.has_value() ? std::to_string(*liquid_id) : "NULL";
        
        std::string sql = "UPDATE pump_assignments SET liquid_id = " + liquid_id_str +
            ", notes = " + conn->quote(notes);
        
        if (initial_volume_ml.has_value()) {
            sql += ", initial_volume_ml = " + std::to_string(*initial_volume_ml);
            sql += ", consumed_volume_ml = 0";  // 绑定新液体时重置消耗量
        }
        if (low_volume_threshold_ml.has_value()) {
            sql += ", low_volume_threshold_ml = " + std::to_string(*low_volume_threshold_ml);
        }
        
        sql += " WHERE pump_index = " + std::to_string(pump_index);
        
        pqxx::work txn(conn.get());
        txn.exec(sql);
        txn.commit();
        
        spdlog::info("Set pump {} assignment to liquid_id={}", pump_index, 
                     liquid_id.has_value() ? std::to_string(*liquid_id) : "NULL");
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::set_pump_assignment error: {}", e.what());
        return false;
    }
}

bool ConsumableRepository::set_pump_volume(int pump_index, double initial_volume_ml,
                                           std::optional<double> low_volume_threshold_ml,
                                           bool reset_consumed) {
    if (pump_index < 0 || pump_index > 7) {
        spdlog::error("Invalid pump_index: {}", pump_index);
        return false;
    }
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        std::string sql = "UPDATE pump_assignments SET initial_volume_ml = " + 
                          std::to_string(initial_volume_ml);
        
        if (reset_consumed) {
            sql += ", consumed_volume_ml = 0";
        }
        if (low_volume_threshold_ml.has_value()) {
            sql += ", low_volume_threshold_ml = " + std::to_string(*low_volume_threshold_ml);
        }
        
        sql += " WHERE pump_index = " + std::to_string(pump_index);
        
        pqxx::work txn(conn.get());
        txn.exec(sql);
        txn.commit();
        
        spdlog::info("Set pump {} volume to {} ml (reset_consumed={})", 
                     pump_index, initial_volume_ml, reset_consumed);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::set_pump_volume error: {}", e.what());
        return false;
    }
}

bool ConsumableRepository::add_pump_consumption(int pump_index, double volume_ml, 
                                                std::optional<int> experiment_id) {
    if (pump_index < 0 || pump_index > 7) {
        spdlog::error("Invalid pump_index: {}", pump_index);
        return false;
    }
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        
        // 更新消耗量
        txn.exec(
            "UPDATE pump_assignments SET consumed_volume_ml = "
            "COALESCE(consumed_volume_ml, 0) + " + std::to_string(volume_ml) +
            " WHERE pump_index = " + std::to_string(pump_index));
        
        // 获取当前绑定的液体ID
        pqxx::result res = txn.exec(
            "SELECT liquid_id FROM pump_assignments WHERE pump_index = " + 
            std::to_string(pump_index));
        
        std::string liquid_id_str = "NULL";
        if (!res.empty() && !res[0][0].is_null()) {
            liquid_id_str = std::to_string(res[0][0].as<int>());
        }
        
        // 记录历史
        std::string exp_id_str = experiment_id.has_value() ? std::to_string(*experiment_id) : "NULL";
        txn.exec(
            "INSERT INTO pump_consumption_history (pump_index, liquid_id, volume_ml, experiment_id) "
            "VALUES (" + std::to_string(pump_index) + ", " + liquid_id_str + ", " +
            std::to_string(volume_ml) + ", " + exp_id_str + ")");
        
        txn.commit();
        
        spdlog::debug("Added {} ml consumption to pump {}", volume_ml, pump_index);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::add_pump_consumption error: {}", e.what());
        return false;
    }
}

std::optional<PumpAssignmentRecord> ConsumableRepository::get_pump_assignment(int pump_index) {
    if (pump_index < 0 || pump_index > 7) {
        return std::nullopt;
    }
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "SELECT pump_index, liquid_id, notes, updated_at, "
            "COALESCE(initial_volume_ml, 0), COALESCE(consumed_volume_ml, 0), "
            "COALESCE(low_volume_threshold_ml, 10) "
            "FROM pump_assignments WHERE pump_index = " + std::to_string(pump_index));
        
        if (res.empty()) return std::nullopt;
        
        const auto& row = res[0];
        PumpAssignmentRecord record;
        record.pump_index = row[0].as<int>();
        record.liquid_id = row[1].is_null() ? std::nullopt : std::optional<int>(row[1].as<int>());
        record.notes = row[2].is_null() ? "" : row[2].as<std::string>();
        record.updated_at = parse_timestamp(row[3].as<std::string>());
        record.initial_volume_ml = row[4].as<double>();
        record.consumed_volume_ml = row[5].as<double>();
        record.low_volume_threshold_ml = row[6].as<double>();
        
        txn.commit();
        return record;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::get_pump_assignment error: {}", e.what());
        return std::nullopt;
    }
}

// ============================================================
// 耗材管理
// ============================================================

std::vector<ConsumableRecord> ConsumableRepository::get_all_consumables() {
    std::vector<ConsumableRecord> results;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return results;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "SELECT id, name, type, accumulated_seconds, lifetime_seconds, "
            "warning_threshold, critical_threshold, last_reset_at, updated_at "
            "FROM consumables ORDER BY type, id");
        
        for (const auto& row : res) {
            ConsumableRecord record;
            record.id = row[0].as<std::string>();
            record.name = row[1].as<std::string>();
            record.type = row[2].as<std::string>();
            record.accumulated_seconds = row[3].as<int64_t>();
            record.lifetime_seconds = row[4].as<int64_t>();
            record.warning_threshold = row[5].as<float>();
            record.critical_threshold = row[6].as<float>();
            record.last_reset_at = parse_timestamp(row[7].as<std::string>());
            record.updated_at = parse_timestamp(row[8].as<std::string>());
            results.push_back(record);
        }
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::get_all_consumables error: {}", e.what());
    }
    
    return results;
}

std::optional<ConsumableRecord> ConsumableRepository::get_consumable(const std::string& id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "SELECT id, name, type, accumulated_seconds, lifetime_seconds, "
            "warning_threshold, critical_threshold, last_reset_at, updated_at "
            "FROM consumables WHERE id = " + conn->quote(id));
        
        if (res.empty()) return std::nullopt;
        
        const auto& row = res[0];
        ConsumableRecord record;
        record.id = row[0].as<std::string>();
        record.name = row[1].as<std::string>();
        record.type = row[2].as<std::string>();
        record.accumulated_seconds = row[3].as<int64_t>();
        record.lifetime_seconds = row[4].as<int64_t>();
        record.warning_threshold = row[5].as<float>();
        record.critical_threshold = row[6].as<float>();
        record.last_reset_at = parse_timestamp(row[7].as<std::string>());
        record.updated_at = parse_timestamp(row[8].as<std::string>());
        
        txn.commit();
        return record;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::get_consumable error: {}", e.what());
        return std::nullopt;
    }
}

bool ConsumableRepository::add_runtime(const std::string& id, int64_t seconds) {
    if (seconds <= 0) return true;  // 无需更新
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        
        // 获取当前值
        pqxx::result res = txn.exec(
            "SELECT accumulated_seconds FROM consumables WHERE id = " + conn->quote(id));
        
        if (res.empty()) {
            spdlog::warn("Consumable not found: {}", id);
            return false;
        }
        
        int64_t old_value = res[0][0].as<int64_t>();
        int64_t new_value = old_value + seconds;
        
        // 更新累积时间
        txn.exec(
            "UPDATE consumables SET accumulated_seconds = " + std::to_string(new_value) +
            " WHERE id = " + conn->quote(id));
        
        // 记录历史
        txn.exec(
            "INSERT INTO consumable_history (consumable_id, action, old_accumulated_seconds, "
            "new_accumulated_seconds, delta_seconds) VALUES (" +
            conn->quote(id) + ", 'runtime_add', " + std::to_string(old_value) + ", " +
            std::to_string(new_value) + ", " + std::to_string(seconds) + ")");
        
        txn.commit();
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::add_runtime error: {}", e.what());
        return false;
    }
}

bool ConsumableRepository::reset_consumable(const std::string& id, const std::string& notes) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        
        // 获取当前值
        pqxx::result res = txn.exec(
            "SELECT accumulated_seconds FROM consumables WHERE id = " + conn->quote(id));
        
        if (res.empty()) {
            spdlog::warn("Consumable not found: {}", id);
            return false;
        }
        
        int64_t old_value = res[0][0].as<int64_t>();
        
        // 重置累积时间
        txn.exec(
            "UPDATE consumables SET accumulated_seconds = 0, last_reset_at = NOW() "
            "WHERE id = " + conn->quote(id));
        
        // 记录历史
        txn.exec(
            "INSERT INTO consumable_history (consumable_id, action, old_accumulated_seconds, "
            "new_accumulated_seconds, delta_seconds, notes) VALUES (" +
            conn->quote(id) + ", 'reset', " + std::to_string(old_value) + ", 0, " +
            std::to_string(-old_value) + ", " + conn->quote(notes) + ")");
        
        txn.commit();
        spdlog::info("Reset consumable: {} (was {} seconds)", id, old_value);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::reset_consumable error: {}", e.what());
        return false;
    }
}

bool ConsumableRepository::update_lifetime(const std::string& id, int64_t lifetime_seconds) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec(
            "UPDATE consumables SET lifetime_seconds = " + std::to_string(lifetime_seconds) +
            " WHERE id = " + conn->quote(id));
        
        txn.commit();
        spdlog::info("Updated consumable {} lifetime to {} seconds", id, lifetime_seconds);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::update_lifetime error: {}", e.what());
        return false;
    }
}

// ============================================================
// 元数据字段管理
// ============================================================

std::vector<MetadataFieldRecord> ConsumableRepository::list_metadata_fields(
    const std::string& entity_type,
    bool include_inactive) {
    
    std::vector<MetadataFieldRecord> results;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return results;
        
        std::string sql = "SELECT id, entity_type, field_key, field_name, field_type, "
                         "description, is_required, default_value, "
                         "COALESCE(options::text, '{}'), display_order, is_active "
                         "FROM metadata_fields WHERE entity_type = " + conn->quote(entity_type);
        
        if (!include_inactive) {
            sql += " AND is_active = true";
        }
        sql += " ORDER BY display_order, field_key";
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(sql);
        
        for (const auto& row : res) {
            MetadataFieldRecord record;
            record.id = row[0].as<int>();
            record.entity_type = row[1].as<std::string>();
            record.field_key = row[2].as<std::string>();
            record.field_name = row[3].as<std::string>();
            record.field_type = row[4].as<std::string>();
            record.description = row[5].is_null() ? "" : row[5].as<std::string>();
            record.is_required = row[6].as<bool>();
            record.default_value = row[7].is_null() ? "" : row[7].as<std::string>();
            record.options_json = row[8].as<std::string>();
            record.display_order = row[9].as<int>();
            record.is_active = row[10].as<bool>();
            results.push_back(record);
        }
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::list_metadata_fields error: {}", e.what());
    }
    
    return results;
}

std::optional<int> ConsumableRepository::create_metadata_field(
    const std::string& entity_type,
    const std::string& field_key,
    const std::string& field_name,
    const std::string& field_type,
    const std::string& description,
    bool is_required,
    const std::string& default_value,
    const std::string& options_json,
    int display_order) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        pqxx::result res = txn.exec(
            "INSERT INTO metadata_fields (entity_type, field_key, field_name, field_type, "
            "description, is_required, default_value, options, display_order) VALUES (" +
            conn->quote(entity_type) + ", " + conn->quote(field_key) + ", " +
            conn->quote(field_name) + ", " + conn->quote(field_type) + ", " +
            conn->quote(description) + ", " + (is_required ? "true" : "false") + ", " +
            conn->quote(default_value) + ", " + conn->quote(options_json) + "::jsonb, " +
            std::to_string(display_order) + ") RETURNING id");
        
        int id = res[0][0].as<int>();
        txn.commit();
        
        spdlog::info("Created metadata field: {}.{} (id={})", entity_type, field_key, id);
        return id;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::create_metadata_field error: {}", e.what());
        return std::nullopt;
    }
}

bool ConsumableRepository::update_metadata_field(
    int id,
    const std::string& field_name,
    const std::string& description,
    bool is_required,
    const std::string& default_value,
    const std::string& options_json,
    int display_order,
    bool is_active) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec(
            "UPDATE metadata_fields SET field_name = " + conn->quote(field_name) +
            ", description = " + conn->quote(description) +
            ", is_required = " + (is_required ? "true" : "false") +
            ", default_value = " + conn->quote(default_value) +
            ", options = " + conn->quote(options_json) + "::jsonb" +
            ", display_order = " + std::to_string(display_order) +
            ", is_active = " + (is_active ? "true" : "false") +
            " WHERE id = " + std::to_string(id));
        
        txn.commit();
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::update_metadata_field error: {}", e.what());
        return false;
    }
}

bool ConsumableRepository::delete_metadata_field(int id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec("DELETE FROM metadata_fields WHERE id = " + std::to_string(id));
        txn.commit();
        
        spdlog::info("Deleted metadata field id={}", id);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("ConsumableRepository::delete_metadata_field error: {}", e.what());
        return false;
    }
}

} // namespace db
