import { describe, it, expect } from "vitest";
import { reorder } from "./helpers";

describe("reorder", () => {
  it("moves an item forward", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(reorder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op for equal/out-of-range indices", () => {
    expect(reorder(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
