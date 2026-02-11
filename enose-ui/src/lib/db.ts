import { Pool } from "pg";

const pool = new Pool({
  host: process.env.DB_HOST || "192.168.1.235",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "enose",
  user: process.env.DB_USER || "enose",
  password: process.env.DB_PASSWORD || "enose_secure_password_change_me",
  max: 5,
  idleTimeoutMillis: 30000,
});

export default pool;
