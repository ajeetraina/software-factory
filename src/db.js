// In-memory task store behind a small repository interface.
//
// Persistence is intentionally swappable: the whole module exposes a handful of
// synchronous functions, so replacing this with SQLite (better-sqlite3 or the
// built-in node:sqlite) is a self-contained change the factory can make later.

let tasks = [];
let nextId = 1;

export function reset() {
  tasks = [];
  nextId = 1;
}

export function list() {
  return tasks.map((t) => ({ ...t }));
}

export function get(id) {
  const task = tasks.find((t) => t.id === id);
  return task ? { ...task } : undefined;
}

export function create({ title }) {
  const now = new Date().toISOString();
  const task = {
    id: nextId++,
    title,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  return { ...task };
}

export function remove(id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tasks.splice(index, 1);
  return true;
}
