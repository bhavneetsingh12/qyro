import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://postgres:postgres@localhost:5432/postgres";

import { shouldPinRequestTransaction, waitForResponse } from "./tenant";

function makeReq(headers: Record<string, string> = {}, path = "/api/leads") {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    path: string;
  };
  req.headers = headers;
  req.path = path;
  return req;
}

function makeRes() {
  return new EventEmitter();
}

test("shouldPinRequestTransaction returns false for SSE accept header", () => {
  const req = makeReq({ accept: "text/event-stream" });
  assert.equal(shouldPinRequestTransaction(req as any), false);
});

test("shouldPinRequestTransaction returns false for stream path", () => {
  const req = makeReq({}, "/stream");
  assert.equal(shouldPinRequestTransaction(req as any), false);
});

test("shouldPinRequestTransaction returns true for normal API requests", () => {
  const req = makeReq({ accept: "application/json" }, "/api/v1/tenants/settings");
  assert.equal(shouldPinRequestTransaction(req as any), true);
});

test("waitForResponse resolves on finish", async () => {
  const req = makeReq();
  const res = makeRes();

  const pending = waitForResponse(req as any, res as any);
  res.emit("finish");

  await assert.doesNotReject(pending);
});

test("waitForResponse resolves on aborted request", async () => {
  const req = makeReq();
  const res = makeRes();

  const pending = waitForResponse(req as any, res as any);
  req.emit("aborted");

  await assert.doesNotReject(pending);
});

test("waitForResponse rejects on response error", async () => {
  const req = makeReq();
  const res = makeRes();

  const pending = waitForResponse(req as any, res as any);
  res.emit("error", new Error("response failed"));

  await assert.rejects(pending, /response failed/);
});