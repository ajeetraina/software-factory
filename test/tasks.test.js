import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import * as db from "../src/db.js";

const app = createApp();

beforeEach(() => {
  db.reset();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /tasks", () => {
  it("creates a task", async () => {
    const res = await request(app).post("/tasks").send({ title: "write spec" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, title: "write spec", completed: false });
  });

  it("rejects an empty title", async () => {
    const res = await request(app).post("/tasks").send({ title: "  " });
    expect(res.status).toBe(400);
  });
});

describe("GET /tasks and /tasks/:id", () => {
  it("lists created tasks", async () => {
    await request(app).post("/tasks").send({ title: "a" });
    await request(app).post("/tasks").send({ title: "b" });
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("404s an unknown id", async () => {
    const res = await request(app).get("/tasks/999");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /tasks/:id", () => {
  it("deletes a task", async () => {
    await request(app).post("/tasks").send({ title: "temp" });
    const del = await request(app).delete("/tasks/1");
    expect(del.status).toBe(204);
    const get = await request(app).get("/tasks/1");
    expect(get.status).toBe(404);
  });
});

// The PATCH /tasks/:id suite is deliberately absent — the Test stage of the
// factory writes it from SPEC.md after the Coding stage implements the route.
