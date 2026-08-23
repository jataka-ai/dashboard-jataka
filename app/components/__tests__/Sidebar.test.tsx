import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../Sidebar";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: {
      firstName: "Test",
      lastName: "User",
      primaryEmailAddress: { emailAddress: "test@example.com" },
    },
  }),
  SignOutButton: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("Sidebar ROI access", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  it.each(["ARCHITECT", "AUDITOR"] as const)(
    "shows ROI Analytics to %s users",
    (userRole) => {
      render(<Sidebar orgName="Acme" userRole={userRole} />);

      expect(
        screen.getByRole("link", { name: "ROI Analytics" }),
      ).toHaveAttribute("href", "/roi-analytics");
    },
  );

  it.each(["DEVELOPER", ""] as const)(
    "hides ROI Analytics from %s users",
    (userRole) => {
      render(<Sidebar orgName="Acme" userRole={userRole} />);

      expect(
        screen.queryByRole("link", { name: "ROI Analytics" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps the complete current navigation in Master view", () => {
    render(<Sidebar orgName="Acme" userRole="ARCHITECT" />);

    expect(screen.getByRole("link", { name: "Dependency Graph" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Developer Tools" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Audit Logs" })).toBeVisible();
  });

  it("reduces Regular User navigation to support essentials", () => {
    render(<Sidebar orgName="Acme" userRole="ARCHITECT" />);

    fireEvent.change(screen.getByLabelText("Dashboard persona"), {
      target: { value: "REGULAR_USER" },
    });

    expect(screen.getByRole("link", { name: "Ask Support" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Knowledge Q&A" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Public Status" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Dependency Graph" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Integrations" })).toBeNull();
  });

  it("persists the chosen persona for the next page", () => {
    render(<Sidebar orgName="Acme" userRole="ARCHITECT" />);

    fireEvent.change(screen.getByLabelText("Dashboard persona"), {
      target: { value: "SUPER_USER" },
    });

    expect(window.localStorage.getItem("jataka.dashboard.persona")).toBe(
      "SUPER_USER",
    );
  });
});
