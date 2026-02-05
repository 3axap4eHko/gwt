import { vi } from "vitest";

vi.mock("bun", () => ({
  $: vi.fn(),
}));

vi.mock("../templates/AGENTS.md", () => ({
  default: "/mock/path/AGENTS.md",
}));
