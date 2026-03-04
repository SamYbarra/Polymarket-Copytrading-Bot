const path = require("path");

const backendDir = path.join(__dirname, "backend");
const frontendDir = path.join(__dirname, "frontend");

module.exports = {
  apps: [
    {
      name: "regime-api",
      cwd: backendDir,
      script: "python3",
      args: ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8006"],
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "2s",
      env: { PYTHONUNBUFFERED: "1" },
    },
    {
      name: "regime-dashboard",
      cwd: frontendDir,
      script: "npm",
      args: ["run", "start"],
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "2s",
    },
  ],
};
