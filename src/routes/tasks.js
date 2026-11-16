import { Router } from "express";
import * as db from "../db.js";

const router = Router();

// GET /tasks — list all tasks
router.get("/", (req, res) => {
  res.json(db.list());
});

// GET /tasks/:id — fetch one task
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "id must be an integer" });
  }
  const task = db.get(id);
  if (!task) {
    return res.status(404).json({ error: "task not found" });
  }
  res.json(task);
});

// POST /tasks — create a task
router.post("/", (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required and must be a non-empty string" });
  }
  const task = db.create({ title: title.trim() });
  res.status(201).json(task);
});

// DELETE /tasks/:id — delete a task
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "id must be an integer" });
  }
  const removed = db.remove(id);
  if (!removed) {
    return res.status(404).json({ error: "task not found" });
  }
  res.status(204).end();
});

// NOTE: PATCH /tasks/:id is intentionally NOT implemented.
// It is the feature the software factory adds end-to-end. See README.

export default router;
