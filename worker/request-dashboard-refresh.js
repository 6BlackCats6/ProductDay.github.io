#!/usr/bin/env node

// Queue a normal current-month refresh without AI-led source collection.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const APP_ROOT = "/Users/AlekseiSereda/Codex/ProductDay.github.io";
const CONFIG_PATH = path.join(APP_ROOT, "worker", "product-day-worker.env");
const SUPABASE_URL = "https://jcrwuejwgezsxeuznwly.supabase.co";
const DASHBOARD_EMAIL = "alexseredauk@gmail.com";
const args = process.argv.slice(2);

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const secret = readEnv(CONFIG_PATH).PRODUCT_DAY_SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("PRODUCT_DAY_SUPABASE_SECRET_KEY is missing.");
  const statusIndex = args.indexOf("--status");
  if (statusIndex >= 0) return print(await requestById(secret, args[statusIndex + 1]));

  const heartbeat = await latestHeartbeat(secret);
  if (!heartbeat || Date.now() - new Date(heartbeat.checked_at).getTime() > 3 * 60 * 1000) {
    print({ status: "offline", message: "Refresh service offline." });
    process.exitCode = 2;
    return;
  }

  let request = await activeRequest(secret);
  if (!request) {
    const user = await dashboardUser(secret);
    const rows = await rest(secret, "/rest/v1/refresh_requests", "POST", { requested_by: user.id }, "return=representation");
    request = rows[0];
  }
  wakeWorker();
  if (args.includes("--wait")) request = await waitForCompletion(secret, request.id);
  print(request);
}

function wakeWorker() {
  spawnSync("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/com.productday.refresh-worker`], { encoding: "utf8" });
}
async function latestHeartbeat(secret) {
  const rows = await rest(secret, "/rest/v1/worker_heartbeat?select=checked_at&order=checked_at.desc&limit=1", "GET");
  return rows[0];
}
async function activeRequest(secret) {
  const rows = await rest(secret, "/rest/v1/refresh_requests?status=in.(queued,running)&order=requested_at.desc&limit=1", "GET");
  return rows[0];
}
async function requestById(secret, id) {
  if (!id) throw new Error("Pass a request id after --status.");
  const rows = await rest(secret, `/rest/v1/refresh_requests?id=eq.${encodeURIComponent(id)}&select=id,status,message,requested_at,started_at,finished_at,snapshot_id`, "GET");
  if (!rows[0]) throw new Error("Refresh request not found.");
  return rows[0];
}
async function dashboardUser(secret) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, { headers: authHeaders(secret) });
  if (!response.ok) throw new Error(`Could not find dashboard user: ${await response.text()}`);
  const users = (await response.json()).users || [];
  const user = users.find((candidate) => candidate.email === DASHBOARD_EMAIL);
  if (!user) throw new Error("Dashboard user not found.");
  return user;
}
async function waitForCompletion(secret, id) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const request = await requestById(secret, id);
    if (["completed", "failed", "skipped"].includes(request.status)) return request;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Refresh did not finish within 20 minutes.");
}
async function rest(secret, pathname, method, body, prefer) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: { ...authHeaders(secret), "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`Supabase ${method} ${pathname} failed: ${await response.text()}`);
  return response.status === 204 ? [] : response.json();
}
function authHeaders(secret) { return { apikey: secret, Authorization: `Bearer ${secret}` }; }
function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes("=") && !line.trim().startsWith("#")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
  }));
}
function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
