import { expect, test } from "bun:test";
import { FrontApp } from "./front-app.ts";

test("the front app is unknown until an overlay reports it", () => {
  expect(new FrontApp().value).toBe("unknown");
});

test("listeners hear only real changes", () => {
  const front = new FrontApp();
  const heard: string[] = [];
  const off = front.subscribe((app) => heard.push(app));
  front.set("terminal");
  front.set("terminal");
  front.set("other");
  off();
  front.set("desktop");
  expect(heard).toEqual(["terminal", "other"]);
  expect(front.value).toBe("desktop");
});
