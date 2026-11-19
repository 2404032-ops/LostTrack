const http = require("node:http");
const { port } = require("./config");
const { provisionInitialAdmin } = require("./auth");
const { initializeDb } = require("./database");
const handleRequest = require("./routes");

async function start() {
  await initializeDb();
  await provisionInitialAdmin();
  http.createServer(handleRequest).listen(port, process.env.HOST || "127.0.0.1", () => {
    console.log(`LostTrack running at http://localhost:${port}`);
  });
}

start().catch(error => {
  console.error("LostTrack startup failed:", error.message);
  process.exitCode = 1;
});
