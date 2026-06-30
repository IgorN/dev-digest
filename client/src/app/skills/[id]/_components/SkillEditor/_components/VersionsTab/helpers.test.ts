import { describe, it, expect } from "vitest";
import { diffLines } from "./helpers";

describe("diffLines", () => {
  it("marks unchanged lines as eq", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { type: "eq", text: "a" },
      { type: "eq", text: "b" },
    ]);
  });

  it("detects an added line", () => {
    expect(diffLines("a", "a\nb")).toEqual([
      { type: "eq", text: "a" },
      { type: "add", text: "b" },
    ]);
  });

  it("detects a removed line", () => {
    expect(diffLines("a\nb", "a")).toEqual([
      { type: "eq", text: "a" },
      { type: "del", text: "b" },
    ]);
  });

  it("detects a replacement as del + add", () => {
    const d = diffLines("hello", "world");
    expect(d).toContainEqual({ type: "del", text: "hello" });
    expect(d).toContainEqual({ type: "add", text: "world" });
  });
});
