#pragma once

#include "connection_pool.hpp"
#include <optional>
#include <vector>
#include <chrono>
#include <string>

namespace db {

// ============================================================
// 液体记录
// ============================================================
struct LiquidRecord {
    int id{0};
    std::string name;
    std::string type;  // "sample", "rinse", "other"
    std::string description;
    float density{1.0f};
    std::string metadata_json;
    bool is_active{true};
    std::chrono::system_clock::time_point created_at;
    std::chrono::system_clock::time_point updated_at;
};

// ============================================================
// 泵配置记录
// ============================================================
struct PumpAssignmentRecord {
    int pump_index{0};
    std::optional<int> liquid_id;
    std::string notes;
    std::chrono::system_clock::time_point updated_at;
    // 容量相关字段
    double initial_volume_ml{0.0};
    double consumed_volume_ml{0.0};
    double low_volume_threshold_ml{10.0};
    
    // 计算属性
    double remaining_volume_ml() const {
        return std::max(0.0, initial_volume_ml - consumed_volume_ml);
    }
    
    bool is_low_volume() const {
        return initial_volume_ml > 0 && remaining_volume_ml() <= low_volume_threshold_ml;
    }
};

// ============================================================
// 清洗泵配置记录
// ============================================================
struct WashPumpAssignmentRecord {
    int pump_index{0};
    std::optional<int> liquid_id;
    std::string notes;
    std::chrono::system_clock::time_point created_at;
    std::chrono::system_clock::time_point updated_at;
    // 容量相关字段
    double initial_volume_ml{0.0};
    double consumed_volume_ml{0.0};
    double low_volume_threshold_ml{10.0};
    
    // 计算属性
    double remaining_volume_ml() const {
        return std::max(0.0, initial_volume_ml - consumed_volume_ml);
    }
    
    bool is_low_volume() const {
        return initial_volume_ml > 0 && remaining_volume_ml() <= low_volume_threshold_ml;
    }
};

// ============================================================
// 耗材记录
// ============================================================
struct ConsumableRecord {
    std::string id;
    std::string name;
    std::string type;  // "pump_tube", "carbon_filter", "vacuum_filter"
    int64_t accumulated_seconds{0};
    int64_t lifetime_seconds{0};
    float warning_threshold{0.2f};
    float critical_threshold{0.05f};
    std::chrono::system_clock::time_point last_reset_at;
    std::chrono::system_clock::time_point updated_at;
    
    // 计算属性
    float remaining_ratio() const {
        if (lifetime_seconds <= 0) return 1.0f;
        float used = static_cast<float>(accumulated_seconds) / lifetime_seconds;
        return std::max(0.0f, 1.0f - used);
    }
    
    int64_t remaining_seconds() const {
        int64_t diff = lifetime_seconds - accumulated_seconds;
        return diff > 0 ? diff : 0;
    }
    
    int status() const {  // 0=ok, 1=warning, 2=critical
        float ratio = remaining_ratio();
        if (ratio <= critical_threshold) return 2;
        if (ratio <= warning_threshold) return 1;
        return 0;
    }
};

// ============================================================
// 元数据字段记录
// ============================================================
struct MetadataFieldRecord {
    int id{0};
    std::string entity_type;
    std::string field_key;
    std::string field_name;
    std::string field_type;
    std::string description;
    bool is_required{false};
    std::string default_value;
    std::string options_json;
    int display_order{0};
    bool is_active{true};
};

// ============================================================
// 标签记录
// ============================================================
struct TagRecord {
    int id{0};
    std::string name;
    std::string category;  // aroma, flavor, intensity
    std::string color;
    int usage_count{0};
    std::chrono::system_clock::time_point created_at;
    std::chrono::system_clock::time_point updated_at;
};

// ============================================================
// 附件记录（图片等）
// ============================================================
struct AttachmentRecord {
    int id{0};
    int liquid_id{0};
    std::string field_key;      // 对应 metadata_fields.field_key
    std::string file_type;      // 'image', 'document'
    std::string file_name;      // 原始文件名
    std::string file_path;      // 存储路径
    int64_t file_size{0};       // 文件大小 (bytes)
    std::string mime_type;      // MIME 类型
    std::chrono::system_clock::time_point created_at;
};

// ============================================================
// 耗材仓库
// ============================================================
class ConsumableRepository {
public:
    ConsumableRepository() = default;
    
    // === 液体管理 ===
    std::vector<LiquidRecord> list_liquids(
        const std::string& type_filter = "",
        bool include_inactive = false,
        int limit = 100,
        int offset = 0);
    
    std::optional<LiquidRecord> get_liquid(int id);
    
    std::optional<int> create_liquid(
        const std::string& name,
        const std::string& type,
        const std::string& description,
        float density,
        const std::string& metadata_json);
    
    bool update_liquid(
        int id,
        const std::string& name,
        const std::string& type,
        const std::string& description,
        float density,
        const std::string& metadata_json,
        bool is_active);
    
    bool delete_liquid(int id);
    
    int count_liquids(const std::string& type_filter = "", bool include_inactive = false);
    
    // === 泵配置管理 ===
    std::vector<PumpAssignmentRecord> get_pump_assignments();
    
    bool set_pump_assignment(int pump_index, std::optional<int> liquid_id, const std::string& notes,
                             std::optional<double> initial_volume_ml = std::nullopt,
                             std::optional<double> low_volume_threshold_ml = std::nullopt);
    
    bool set_pump_volume(int pump_index, double initial_volume_ml,
                         std::optional<double> low_volume_threshold_ml = std::nullopt,
                         bool reset_consumed = true);
    
    bool add_pump_consumption(int pump_index, double volume_ml, std::optional<int> experiment_id = std::nullopt);
    
    std::optional<PumpAssignmentRecord> get_pump_assignment(int pump_index);
    
    // 根据液体ID查询绑定的泵（可能有多个泵绑定同一液体）
    std::vector<PumpAssignmentRecord> get_pumps_by_liquid_id(int liquid_id);
    
    // 获取液体的总可用余量（汇总所有绑定该液体的泵）
    double get_liquid_available_volume(int liquid_id);
    
    // === 清洗泵配置管理 ===
    std::vector<WashPumpAssignmentRecord> get_wash_pump_assignments();
    
    bool set_wash_pump_assignment(int pump_index, std::optional<int> liquid_id, const std::string& notes,
                                   std::optional<double> initial_volume_ml = std::nullopt,
                                   std::optional<double> low_volume_threshold_ml = std::nullopt);
    
    bool set_wash_pump_volume(int pump_index, double initial_volume_ml,
                               std::optional<double> low_volume_threshold_ml = std::nullopt,
                               bool reset_consumed = true);
    
    bool add_wash_pump_consumption(int pump_index, double volume_ml, std::optional<int> experiment_id = std::nullopt);
    
    std::optional<WashPumpAssignmentRecord> get_wash_pump_assignment(int pump_index);
    
    // === 耗材管理 ===
    std::vector<ConsumableRecord> get_all_consumables();
    
    std::optional<ConsumableRecord> get_consumable(const std::string& id);
    
    bool add_runtime(const std::string& id, int64_t seconds);
    
    bool reset_consumable(const std::string& id, const std::string& notes, int64_t new_lifetime_seconds = 0);
    
    bool update_lifetime(const std::string& id, int64_t lifetime_seconds);
    
    // === 元数据字段管理 ===
    std::vector<MetadataFieldRecord> list_metadata_fields(
        const std::string& entity_type,
        bool include_inactive = false);
    
    std::optional<int> create_metadata_field(
        const std::string& entity_type,
        const std::string& field_key,
        const std::string& field_name,
        const std::string& field_type,
        const std::string& description,
        bool is_required,
        const std::string& default_value,
        const std::string& options_json,
        int display_order);
    
    bool update_metadata_field(
        int id,
        const std::string& field_name,
        const std::string& description,
        bool is_required,
        const std::string& default_value,
        const std::string& options_json,
        int display_order,
        bool is_active);
    
    bool delete_metadata_field(int id);
    
    // === 标签管理 ===
    std::vector<TagRecord> list_tags(
        const std::string& category = "",
        const std::string& search = "",
        int limit = 100,
        bool order_by_usage = false);
    
    std::optional<int> create_tag(
        const std::string& name,
        const std::string& category,
        const std::string& color = "");
    
    bool delete_tag(int id);
    
    std::vector<TagRecord> get_tag_suggestions(
        const std::string& prefix,
        const std::string& category = "",
        int limit = 10);
    
    // === 液体标签关系 ===
    std::vector<TagRecord> get_liquid_tags(int liquid_id, const std::string& field_key = "aroma_notes");
    
    bool set_liquid_tags(int liquid_id, const std::vector<std::string>& tag_names, 
                         const std::string& field_key = "aroma_notes");
    
    std::vector<LiquidRecord> list_liquids_by_tags(
        const std::vector<std::string>& tag_names,
        const std::string& field_key = "aroma_notes",
        const std::string& type_filter = "",
        int limit = 100,
        int offset = 0);
    
    // === 附件管理 ===
    std::vector<AttachmentRecord> get_liquid_attachments(int liquid_id, const std::string& field_key = "");
    
    std::optional<int> create_liquid_attachment(
        int liquid_id,
        const std::string& field_key,
        const std::string& file_type,
        const std::string& file_name,
        const std::string& file_path,
        int64_t file_size,
        const std::string& mime_type);
    
    bool delete_liquid_attachment(int attachment_id);

private:
    std::string format_timestamp(const std::chrono::system_clock::time_point& tp);
    std::chrono::system_clock::time_point parse_timestamp(const std::string& ts);
};

} // namespace db
