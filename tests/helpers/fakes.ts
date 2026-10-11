import { vi, type Mock } from "vitest";

import type {
  ContextLike,
  LaunchedBrowser,
  PageLike,
  ResponseLike,
} from "../../src/browser/types.js";

export function createResponse(status: number): ResponseLike {
  return { status: () => status };
}

export interface FakePageOptions {
  url?: () => string;
  title?: () => Promise<string>;
  body?: () => Promise<string>;
  goto?: PageLike["goto"];
  screenshot?: PageLike["screenshot"];
  close?: PageLike["close"];
}

export interface FakePage extends PageLike {
  goto: Mock<PageLike["goto"]>;
  screenshot: Mock<PageLike["screenshot"]>;
  close: Mock<PageLike["close"]>;
}

export function createFakePage(options: FakePageOptions = {}): FakePage {
  const body = options.body ?? (() => Promise.resolve(""));

  return {
    url: options.url ?? (() => "https://example.com/"),
    title: options.title ?? (() => Promise.resolve("Example")),
    locator: () => ({ innerText: body }),
    goto: vi.fn<PageLike["goto"]>(
      options.goto ?? (() => Promise.resolve(createResponse(200)))
    ),
    screenshot: vi.fn<PageLike["screenshot"]>(
      options.screenshot ?? (() => Promise.resolve(undefined))
    ),
    close: vi.fn<PageLike["close"]>(
      options.close ?? (() => Promise.resolve())
    ),
  };
}

export interface FakeContext extends ContextLike {
  newPage: Mock<ContextLike["newPage"]>;
  close: Mock<ContextLike["close"]>;
  pages: FakePage[];
}

export function createFakeContext(
  pageFactory: () => FakePage = () => createFakePage()
): FakeContext {
  const pages: FakePage[] = [];

  return {
    pages,
    newPage: vi.fn<ContextLike["newPage"]>(() => {
      const page = pageFactory();

      pages.push(page);

      return Promise.resolve(page);
    }),
    close: vi.fn<ContextLike["close"]>(() => Promise.resolve()),
  };
}

export interface FakeBrowser extends LaunchedBrowser {
  newContext: Mock<LaunchedBrowser["newContext"]>;
  close: Mock<LaunchedBrowser["close"]>;
  contexts: FakeContext[];
}

export function createFakeBrowser(
  contextFactory: () => FakeContext = () => createFakeContext()
): FakeBrowser {
  const contexts: FakeContext[] = [];

  return {
    contexts,
    newContext: vi.fn<LaunchedBrowser["newContext"]>(() => {
      const context = contextFactory();

      contexts.push(context);

      return Promise.resolve(context);
    }),
    close: vi.fn<LaunchedBrowser["close"]>(() => Promise.resolve()),
  };
}
