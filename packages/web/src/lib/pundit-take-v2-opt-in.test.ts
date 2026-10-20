import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __testApplyTakeQuery,
  buildPunditAskJsonHeaders,
  isPunditTakeV2RenderingActive,
  isTakeLegacyQueryValue,
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
    assert.equal(isTakeLegacyQueryValue("legacy"), true);
    assert.equal(isTakeLegacyQueryValue("Legacy"), false);
    assert.equal(isTakeLegacyQueryValue("v2"), false);
  });

  it("sets session on v2 and ignores invalid take values", () => {
    __testApplyTakeQuery("v2", mockSessionStorage);
    assert.equal(mockSessionStorage.getItem("pundit.take.v2.optIn"), "1");
    storage.clear();
    __testApplyTakeQuery("banana", mockSessionStorage);
    assert.equal(mockSessionStorage.getItem("pundit.take.v2.optIn"), null);
  });

  it("sets session on legacy the same way as v2", () => {
    __testApplyTakeQuery("legacy", mockSessionStorage);
    assert.equal(mockSessionStorage.getItem("pundit.take.v2.optIn"), "legacy");
    storage.clear();
    __testApplyTakeQuery("legacy-beta", mockSessionStorage);
    assert.equal(mockSessionStorage.getItem("pundit.take.v2.optIn"), null);
  });

  it("default ask headers omit x-pundit-take", () => {
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
    assert.equal(isPunditTakeV2RenderingActive(), true);
  });

  it("default rendering is v2 and legacy session sends x-pundit-take legacy", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: mockSessionStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { search: "" } },
    });
    syncPunditTakeV2OptInFromUrl();
    assert.equal(isPunditTakeV2RenderingActive(), true);
    assert.deepEqual(buildPunditAskJsonHeaders(), { "Content-Type": "application/json" });

    mockSessionStorage.setItem("pundit.take.v2.optIn", "legacy");
    resetPunditTakeV2OptInForTests();
    mockSessionStorage.setItem("pundit.take.v2.optIn", "legacy");
    syncPunditTakeV2OptInFromUrl();
    assert.equal(isPunditTakeV2RenderingActive(), false);
    assert.deepEqual(buildPunditAskJsonHeaders(), {
      "Content-Type": "application/json",
      "x-pundit-take": "legacy",
    });
  });
});
