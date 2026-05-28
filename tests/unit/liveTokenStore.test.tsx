import "@testing-library/jest-dom/vitest";

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createLiveTokenStore } from "../../src/frontend/live/liveTokenStore";
import {
  LiveSessionTokens,
  LiveTokenStoreContext,
  LiveTokenTotal,
  useLiveTokenValue,
} from "../../src/frontend/live/LiveTokens";

describe("createLiveTokenStore", () => {
  it("derives per-session values and the total from the session list", () => {
    const store = createLiveTokenStore();

    store.setSessions([
      { id: "a", tokenTotal: 100 },
      { id: "b", tokenTotal: 50, tokensUsed: 70 },
    ]);

    expect(store.getValue("a")).toBe(100);
    expect(store.getValue("b")).toBe(70); // tokensUsed wins over tokenTotal
    expect(store.getTotal()).toBe(170);
  });

  it("returns undefined for unknown sessions and zero total before any data", () => {
    const store = createLiveTokenStore();

    expect(store.getValue("missing")).toBeUndefined();
    expect(store.getTotal()).toBe(0);
  });

  it("notifies subscribers when sessions change and stops after unsubscribe", () => {
    const store = createLiveTokenStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.setSessions([{ id: "a", tokenTotal: 10 }]);
    expect(notifications).toBe(1);

    unsubscribe();
    store.setSessions([{ id: "a", tokenTotal: 20 }]);
    expect(notifications).toBe(1);
  });
});

describe("live token components re-render surgically", () => {
  it("updates only the subscribing leaf, not sibling sections", () => {
    const store = createLiveTokenStore();
    let siblingRenders = 0;

    function StaticSibling() {
      siblingRenders += 1;
      return <div data-testid="sibling">static section</div>;
    }

    render(
      <LiveTokenStoreContext.Provider value={store}>
        <StaticSibling />
        <LiveTokenTotal fallback={0} />
      </LiveTokenStoreContext.Provider>,
    );

    expect(screen.getByTestId("live-token-total")).toHaveTextContent("0");
    expect(siblingRenders).toBe(1);

    act(() => {
      store.setSessions([
        { id: "a", tokenTotal: 100 },
        { id: "b", tokenTotal: 70 },
      ]);
    });

    expect(screen.getByTestId("live-token-total")).toHaveTextContent("170");
    expect(siblingRenders).toBe(1); // the sibling never re-rendered
  });

  it("re-renders only the session whose token value changed", () => {
    const store = createLiveTokenStore();
    store.setSessions([
      { id: "a", tokenTotal: 10 },
      { id: "b", tokenTotal: 20 },
    ]);

    const renderCounts: Record<string, number> = { a: 0, b: 0 };
    function Probe({ id }: { id: string }) {
      const value = useLiveTokenValue(id, 0);
      renderCounts[id] += 1;
      return <div data-testid={`probe-${id}`}>{value}</div>;
    }

    render(
      <LiveTokenStoreContext.Provider value={store}>
        <Probe id="a" />
        <Probe id="b" />
      </LiveTokenStoreContext.Provider>,
    );

    expect(renderCounts).toEqual({ a: 1, b: 1 });

    act(() => {
      store.setSessions([
        { id: "a", tokenTotal: 999 },
        { id: "b", tokenTotal: 20 },
      ]);
    });

    expect(screen.getByTestId("probe-a")).toHaveTextContent("999");
    expect(screen.getByTestId("probe-b")).toHaveTextContent("20");
    expect(renderCounts.a).toBe(2); // changed → re-rendered
    expect(renderCounts.b).toBe(1); // unchanged → did not re-render
  });

  it("falls back to the provided value until the store has data", () => {
    const store = createLiveTokenStore();

    render(
      <LiveTokenStoreContext.Provider value={store}>
        <LiveSessionTokens sessionId="a" fallback={4242} />
      </LiveTokenStoreContext.Provider>,
    );

    expect(screen.getByText("4,242")).toBeVisible();

    act(() => {
      store.setSessions([{ id: "a", tokenTotal: 5000 }]);
    });

    expect(screen.getByText("5,000")).toBeVisible();
  });
});
