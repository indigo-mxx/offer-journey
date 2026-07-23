import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("includes the cloud workspace, access control, and sharing surfaces", async () => {
  const [page, tracker, route, schema, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recruitment-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /getChatGPTUser/);
  assert.match(tracker, /SharingPanel/);
  assert.match(tracker, /visibility/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /owner_email/);
  assert.match(route, /group_members/);
  assert.match(schema, /applications/);
  assert.match(hosting, /"d1": "DB"/);
});
