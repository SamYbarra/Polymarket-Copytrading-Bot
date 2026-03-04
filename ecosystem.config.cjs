const path = require("path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "btc5-tracker",
      cwd: root,
      script: "node",
      args: "dist/index.js",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      watch: false,
    },
    {
      name: "btc5-resolver",
      cwd: root,
      script: "node",
      args: "dist/resolver.js",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      watch: false,
    },
    {
      name: "btc5-auto-redeem",
      cwd: root,
      script: "node",
      args: "dist/scripts/run-auto-redeem.js",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      watch: false,
    },
    {
      name: "btc5-ml-service",
      cwd: root,
      script: process.env.PYTHON_CMD || "python3",
      args: "-m uvicorn ml.predict_server:app --host 0.0.0.0 --port 8005",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        ML_MODEL_DIR: path.join(root, "ml", "artifacts"),
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
    {
      name: "btc5-backend",
      cwd: path.join(root, "backend"),
      script: "node",
      args: "dist/main.js",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PORT: "3006",
      },
      autorestart: true,
      watch: false,
    },
    {
      name: "btc5-frontend",
      cwd: path.join(root, "frontend"),
      script: "node",
      args: [
        path.join(root, "frontend", "node_modules", "serve", "build", "main.js"),
        "-s",
        "dist",
        "-l",
        "3005",
      ],
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      watch: false,
    },
  ],
};
