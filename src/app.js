import express from "express";
import tasksRouter from "./routes/tasks.js";

// The Express app is built here (no listener) so tests can import it directly
// with supertest. src/server.js is the only place that binds a port.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/tasks", tasksRouter);

  // Fallback 404 for unknown routes.
  app.use((req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}

export default createApp;
