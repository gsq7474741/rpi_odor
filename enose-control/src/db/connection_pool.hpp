#pragma once

#include <pqxx/pqxx>
#include <memory>
#include <mutex>
#include <queue>
#include <condition_variable>
#include <string>
#include <atomic>

namespace db {

class ConnectionPool {
public:
    static ConnectionPool& instance();
    
    // 初始化连接池
    bool initialize(const std::string& connection_string, size_t pool_size = 5);
    
    // 关闭连接池
    void shutdown();
    
    // 获取连接 (RAII wrapper)
    class ConnectionGuard {
    public:
        ConnectionGuard(ConnectionPool& pool, std::unique_ptr<pqxx::connection> conn);
        ~ConnectionGuard();
        
        ConnectionGuard(const ConnectionGuard&) = delete;
        ConnectionGuard& operator=(const ConnectionGuard&) = delete;
        ConnectionGuard(ConnectionGuard&& other) noexcept;
        ConnectionGuard& operator=(ConnectionGuard&& other) noexcept;
        
        pqxx::connection& get() { return *conn_; }
        pqxx::connection* operator->() { return conn_.get(); }
        bool valid() const { return conn_ != nullptr; }
        
    private:
        ConnectionPool* pool_;
        std::unique_ptr<pqxx::connection> conn_;
    };
    
    // 获取连接 (阻塞，带超时)
    ConnectionGuard acquire(int timeout_ms = 5000);
    
    // 检查是否已初始化
    bool is_initialized() const { return initialized_; }
    
    // 获取连接池状态
    size_t available_count() const;
    size_t total_count() const { return pool_size_; }
    
private:
    ConnectionPool() = default;
    ~ConnectionPool();
    
    ConnectionPool(const ConnectionPool&) = delete;
    ConnectionPool& operator=(const ConnectionPool&) = delete;
    
    void release(std::unique_ptr<pqxx::connection> conn);
    
    std::string connection_string_;
    size_t pool_size_{0};
    std::atomic<bool> initialized_{false};
    std::atomic<bool> shutdown_{false};
    
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::queue<std::unique_ptr<pqxx::connection>> pool_;
};

} // namespace db
