"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Clock3,
  Folder,
  Grid2X2,
} from "lucide-react";
import { PRODUCT_HUB_NAV, PRODUCT_HUB_ORIGIN, PRODUCT_HUB_RESOURCES } from "@/lib/productHub";

const resourceIcons = [BookOpen, Folder, Grid2X2, Clock3];

export function useEmbeddedInProductHub() {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inFrame =
      params.get("embed") === "1" ||
      document.documentElement.classList.contains("mv-embedded") ||
      window.self !== window.top;
    if (inFrame) document.documentElement.classList.add("mv-embedded");
    setEmbedded(inFrame);
  }, []);
  return embedded;
}

export function ProductHubHeader({ account }: { account?: ReactNode }) {
  const embedded = useEmbeddedInProductHub();
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const resourcesRef = useRef<HTMLDetailsElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);

  const closeMenus = () => {
    setMobileOpen(false);
    if (resourcesRef.current) resourcesRef.current.open = false;
    if (accountRef.current) accountRef.current.open = false;
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) closeMenus();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  if (embedded) return null;

  return (
    <header
      className="hub-header"
      ref={headerRef}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) closeMenus();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const owner = event.target instanceof Element ? event.target.closest("details") : null;
        closeMenus();
        if (owner) owner.querySelector("summary")?.focus();
        else menuRef.current?.focus();
      }}
    >
      <a className="hub-brand" href={PRODUCT_HUB_ORIGIN} aria-label="Product Hub Home">
        <span className="hub-wordmark" role="img" aria-label="Likewize" />
        <span className="hub-divider" aria-hidden="true" />
        <span className="hub-name">Product Hub</span>
      </a>
      <button
        ref={menuRef}
        type="button"
        className="hub-mobile-menu"
        aria-expanded={mobileOpen}
        aria-controls="hub-navigation"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        <Grid2X2 size={14} aria-hidden="true" /> Menu
      </button>
      <nav
        className={`hub-navigation${mobileOpen ? " is-open" : ""}`}
        id="hub-navigation"
        aria-label="Main navigation"
      >
        {PRODUCT_HUB_NAV.map((item) => {
          const active = "local" in item && item.local;
          return (
            <a
              key={item.label}
              href={item.href}
              className={active ? "nav-active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </a>
          );
        })}
        <details className="hub-resources" ref={resourcesRef}>
          <summary>
            Resources <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="hub-resource-menu">
            <span className="hub-eyebrow">Go deeper</span>
            {PRODUCT_HUB_RESOURCES.map((item, index) => {
              const Icon = resourceIcons[index] ?? BookOpen;
              return (
                <a href={item.href} key={item.href}>
                  <Icon size={20} aria-hidden="true" />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </details>
      </nav>
      {account}
    </header>
  );
}
