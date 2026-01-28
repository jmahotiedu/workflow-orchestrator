import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App.js";

describe("App", () => {
  it("renders dashboard title", () => {
    render(<App />);
    expect(screen.getByText("Workflow Orchestrator")).toBeDefined();
  });
});
