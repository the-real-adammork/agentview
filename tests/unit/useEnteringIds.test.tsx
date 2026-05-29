import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEnteringIds } from "../../src/frontend/live/useEnteringIds";

describe("useEnteringIds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports nothing on first paint so existing rows never flash on mount", () => {
    const { result } = renderHook(({ ids }) => useEnteringIds(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });
    expect(result.current.size).toBe(0);
  });

  it("reports an id that was absent at the previous commit as entering", () => {
    const { result, rerender } = renderHook(({ ids }) => useEnteringIds(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    act(() => rerender({ ids: ["c", "a", "b"] }));
    expect([...result.current]).toEqual(["c"]);
  });

  it("keeps an id flagged across intervening re-renders so the animation can actually play", () => {
    const { result, rerender } = renderHook(({ ids }) => useEnteringIds(ids, { durationMs: 700 }), {
      initialProps: { ids: ["a"] },
    });
    act(() => rerender({ ids: ["b", "a"] })); // b enters
    expect(result.current.has("b")).toBe(true);
    // A re-render that does not change the id set (a token tick, a parent
    // re-render) must NOT cancel the in-flight animation.
    act(() => rerender({ ids: ["b", "a"] }));
    expect(result.current.has("b")).toBe(true);
  });

  it("clears an entering id once the animation duration has elapsed", () => {
    const { result, rerender } = renderHook(({ ids }) => useEnteringIds(ids, { durationMs: 700 }), {
      initialProps: { ids: ["a"] },
    });
    act(() => rerender({ ids: ["b", "a"] }));
    expect(result.current.has("b")).toBe(true);
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.has("b")).toBe(false);
  });

  it("does not flash on pure reorders or steady-state updates (same id set)", () => {
    const { result, rerender } = renderHook(({ ids }) => useEnteringIds(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });
    act(() => rerender({ ids: ["c", "b", "a"] })); // same ids, reordered
    expect(result.current.size).toBe(0);
  });

  it("reports nothing while disabled, and does not flash the backlog when re-enabled", () => {
    const { result, rerender } = renderHook(
      ({ ids, enabled }) => useEnteringIds(ids, { enabled }),
      { initialProps: { ids: ["a"], enabled: false } },
    );
    act(() => rerender({ ids: ["b", "a"], enabled: false })); // b appeared while disabled
    expect(result.current.size).toBe(0);
    act(() => rerender({ ids: ["b", "a"], enabled: true })); // re-enabled: backlog must not flash
    expect(result.current.size).toBe(0);
    act(() => rerender({ ids: ["c", "b", "a"], enabled: true })); // genuine insert now animates
    expect([...result.current]).toEqual(["c"]);
  });

  it("treats a resetKey change as a fresh baseline so re-framing the list does not flash", () => {
    const { result, rerender } = renderHook(
      ({ ids, resetKey }) => useEnteringIds(ids, { resetKey }),
      { initialProps: { ids: ["a", "b"], resetKey: "filter:open" } },
    );
    // Context changes (e.g. a filter) and the visible set turns over entirely.
    act(() => rerender({ ids: ["x", "y", "z"], resetKey: "filter:closed" }));
    expect(result.current.size).toBe(0);
    // Subsequent real inserts in the new context still animate.
    act(() => rerender({ ids: ["w", "x", "y", "z"], resetKey: "filter:closed" }));
    expect([...result.current]).toEqual(["w"]);
  });
});
