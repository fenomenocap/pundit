import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __testApplyTakeQuery,
  buildPunditAskJsonHeaders,
  isTakeV2QueryValue,
  resetPunditTakeV2OptInForTests,
  syncPunditTakeV2OptInFromUrl,
} from "./pundit-take-v2-opt-in.ts";

describe("pundit take v2 opt-in", () => {
  const storage = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
  };

  afterEach(() => {
    storage.clear();
    resetPunditTakeV2OptInForTests();
  });

  it("accepts only exact v2 query value", () => {
    assert.equal(isTakeV2QueryValue("v2"), true);
    assert.equal(isTakeV2QueryValue("V2"), false);
    assert.equal(isTakeV2QueryValue("v2beta"), false);
    assert.equal(isTakeV2QueryValue(null), false);
  });

  it("sets session on v2 and ignores invalid take values", () => {
    __testApplyTakeQuery("v2", mockSessionStorage);
    assert.equal(mockSessionStorage.getItem("pundit.take.v2.optIn"), "1");
    storage.clear();
    __testApplyTakeQuery("banana", mockSessionStorage);
    assert.equal(mockSessionStorage.getItem("pundit.take.v2.optIn"), null);
  });

  it("buildPunditAskJsonHeaders matches legacy when opt-in is off", () => {
    assert.deepEqual(buildPunditAskJsonHeaders(), { "Content-Type": "application/json" });
  });

  it("buildPunditAskJsonHeaders adds x-pundit-take when session is active", () => {
    mockSessionStorage.setItem("pundit.take.v2.optIn", "1");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: mockSessionStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { search: "" } },
    });
    syncPunditTakeV2OptInFromUrl();
    assert.deepEqual(buildPunditAskJsonHeaders(), {
      "Content-Type": "application/json",
      "x-pundit-take": "v2",
    });
  });
});
