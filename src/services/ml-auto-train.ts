/**
 * Auto-train ML model after market resolution.
 * Spawns python ml/train.py in background; one run at a time, no blocking.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const ts = () => new Date().toISOString();

let trainingInProgress = false;
const PYTHON_CMD = process.env.PYTHON_CMD || "python3";

export function isAutoTrainEnabled(): boolean {
  return process.env.ENABLE_ML_AUTO_TRAIN !== "false";
}

/**
 * Trigger ML training in background after one or more markets were resolved.
 * No-op if auto-train is disabled or a training run is already in progress.
 */
export function triggerAutoTrain(): void {
  if (!isAutoTrainEnabled()) return;
  if (trainingInProgress) return;

  const cwd = process.cwd();
  const trainScript = join(cwd, "ml", "train.py");
  // Optional: skip if ml/train.py does not exist (e.g. ML not set up)
  if (!existsSync(trainScript)) {
    console.log(`${ts()} 🤖 Auto-train skipped: ml/train.py not found`);
    return;
  }

  trainingInProgress = true;
  console.log(`${ts()} 🤖 Auto-train started (background)`);

  const child = spawn(PYTHON_CMD, [trainScript], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  child.unref();

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("close", (code, signal) => {
    trainingInProgress = false;
    if (code === 0) {
      console.log(`${ts()} 🤖 Auto-train finished successfully`);
    } else {
      const msg = signal ? `signal ${signal}` : `exit ${code}`;
      console.error(`${ts()} ✗ Auto-train failed (${msg})`);
      if (stderr.slice(-300)) console.error(stderr.slice(-300));
    }
  });

  child.on("error", (err) => {
    trainingInProgress = false;
    console.error(`${ts()} ✗ Auto-train spawn failed`);
    if (err !== undefined) console.error(err);
  });
}
