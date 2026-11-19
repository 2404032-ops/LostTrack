const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { readRequestBody } = require("../src/http-utils");

test("request bodies are decoded across chunks and limited by bytes", () => {
  const acceptedRequest = new EventEmitter();
  acceptedRequest.destroy = () => assert.fail("request within limit was destroyed");
  let received;
  readRequestBody(acceptedRequest, 2, body => { received = body; });
  acceptedRequest.emit("data", Buffer.from([0xc3]));
  acceptedRequest.emit("data", Buffer.from([0xa9]));
  acceptedRequest.emit("end");
  assert.equal(received, "é");

  const oversizedRequest = new EventEmitter();
  let destroyed = false;
  let oversizedBody;
  oversizedRequest.destroy = () => { destroyed = true; };
  readRequestBody(oversizedRequest, 1, body => { oversizedBody = body; });
  oversizedRequest.emit("data", Buffer.from("é"));
  oversizedRequest.emit("end");
  assert.equal(destroyed, true);
  assert.equal(oversizedBody, undefined);
});
