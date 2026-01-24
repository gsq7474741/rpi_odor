#include "connection_pool.hpp"
#include <spdlog/spdlog.h>
#include <chrono>

namespace db {

ConnectionPool& ConnectionPool::instance() {
    static ConnectionPool instance;
    return instance;
}

ConnectionPool::~ConnectionPool() {
    shutdown();
}

bool ConnectionPool::initialize(const std::string& connection_string, size_t pool_size) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (initialized_) {
        spdlog::warn("ConnectionPool already initialized");
        return true;
    }
    
    connection_string_ = connection_string;
    pool_size_ = pool_size;
    shutdown_ = false;
    
    spdlog::info("Initializing connection pool with {} connections", pool_size);
    
    try {
        for (size_t i = 0; i < pool_size; ++i) {
            auto conn = std::make_unique<pqxx::connection>(connection_string);
            if (conn->is_open()) {
                pool_.push(std::move(conn));
                spdlog::debug("Created connection {}/{}", i + 1, pool_size);
            } else {
                spdlog::error("Failed to open connection {}", i + 1);
                return false;
            }
        }
        
        initialized_ = true;
        spdlog::info("Connection pool initialized successfully");
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to initialize connection pool: {}", e.what());
        return false;
    }
}

void ConnectionPool::shutdown() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (!initialized_) return;
    
    shutdown_ = true;
    cv_.notify_all();
    
    while (!pool_.empty()) {
        pool_.pop();
    }
    
    initialized_ = false;
    spdlog::info("Connection pool shutdown");
}

ConnectionPool::ConnectionGuard ConnectionPool::acquire(int timeout_ms) {
    std::unique_lock<std::mutex> lock(mutex_);
    
    if (!initialized_ || shutdown_) {
        spdlog::warn("Attempting to acquire connection from uninitialized/shutdown pool");
        return ConnectionGuard(*this, nullptr);
    }
    
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    
    while (pool_.empty() && !shutdown_) {
        if (cv_.wait_until(lock, deadline) == std::cv_status::timeout) {
            spdlog::warn("Connection acquire timeout after {}ms", timeout_ms);
            return ConnectionGuard(*this, nullptr);
        }
    }
    
    if (shutdown_ || pool_.empty()) {
        return ConnectionGuard(*this, nullptr);
    }
    
    auto conn = std::move(pool_.front());
    pool_.pop();
    
    // 检查连接是否仍然有效
    try {
        if (!conn->is_open()) {
            spdlog::warn("Connection was closed, reconnecting...");
            conn = std::make_unique<pqxx::connection>(connection_string_);
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to verify/reconnect: {}", e.what());
        return ConnectionGuard(*this, nullptr);
    }
    
    return ConnectionGuard(*this, std::move(conn));
}

void ConnectionPool::release(std::unique_ptr<pqxx::connection> conn) {
    if (!conn) return;
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (shutdown_) {
        return;
    }
    
    pool_.push(std::move(conn));
    cv_.notify_one();
}

size_t ConnectionPool::available_count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return pool_.size();
}

// ConnectionGuard implementation
ConnectionPool::ConnectionGuard::ConnectionGuard(ConnectionPool& pool, std::unique_ptr<pqxx::connection> conn)
    : pool_(&pool), conn_(std::move(conn)) {}

ConnectionPool::ConnectionGuard::~ConnectionGuard() {
    if (conn_ && pool_) {
        pool_->release(std::move(conn_));
    }
}

ConnectionPool::ConnectionGuard::ConnectionGuard(ConnectionGuard&& other) noexcept
    : pool_(other.pool_), conn_(std::move(other.conn_)) {
    other.pool_ = nullptr;
}

ConnectionPool::ConnectionGuard& ConnectionPool::ConnectionGuard::operator=(ConnectionGuard&& other) noexcept {
    if (this != &other) {
        if (conn_ && pool_) {
            pool_->release(std::move(conn_));
        }
        pool_ = other.pool_;
        conn_ = std::move(other.conn_);
        other.pool_ = nullptr;
    }
    return *this;
}

} // namespace db
