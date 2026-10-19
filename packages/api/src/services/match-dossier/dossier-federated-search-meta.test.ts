import { describe, expect, it, vi } from "vitest";
import {
  DOSSIER_FEDERATED_SEARCH_STACK,
  logDossierFederatedSearchStack,
} from "./dossier-federated-search-meta";

describe("dossier federated search stack logging", () => {
  it("logs OpenRouter model and web_search plugin for cost estimation", () => {
    expect(DOSSIER_FEDERATED_SEARCH_STACK.provider).toBe("openrouter");
    expect(DOSSIER_FEDERATED_SEARCH_STACK.tool).toBe("openrouter:web_search");
    expect(DOSSIER_FEDERATED_SEARCH_STACK.searchEngine).toBe("exa");
    expect(DOSSIER_FEDERATED_SEARCH_STACK.model.length).toBeGreaterThan(0);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logDossierFederatedSearchStack();
    expect(spy).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("dossier_federated_search_stack");
    expect(payload.model).toBe(DOSSIER_FEDERATED_SEARCH_STACK.model);
    spy.mockRestore();
  });
});
