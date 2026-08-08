module.exports = {
  apps: [
    {
      name: "educenter-backend",
      script: "dist/index.js",
      instances: "max", // Use all CPU cores
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      // Auto-restart on failure
      max_memory_restart: "500M",
      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
