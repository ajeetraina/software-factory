import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);
// Bind 0.0.0.0, NOT 127.0.0.1 — Docker Sandbox port forwarding (`sbx ports`)
// can only reach services listening on all interfaces.
const HOST = process.env.HOST ?? "0.0.0.0";

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`TaskFlow listening on http://${HOST}:${PORT}`);
});
