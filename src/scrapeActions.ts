import type { Page } from "@cloudflare/puppeteer";
import { z } from "zod";

// v2 scrape `actions` support (spec 016). The six executable action types run
// on the live page inside `extractContent`, AFTER load and BEFORE format
// extraction. pdf / executeJavascript / scrape are accepted-and-warn (same
// compatibility posture as unimplemented formats). This module must keep a
// type-only puppeteer import so unit tests never pull Browser Rendering code.

export const scrapeActionSchema = z.union([
	z.object({
		type: z.literal("wait"),
		milliseconds: z.number().int().min(1),
	}),
	z.object({
		type: z.literal("wait"),
		selector: z.string().min(1),
	}),
	z.object({
		type: z.literal("click"),
		selector: z.string().min(1),
		all: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("write"),
		text: z.string(),
	}),
	z.object({
		type: z.literal("press"),
		key: z.string().min(1),
	}),
	z.object({
		type: z.literal("scroll"),
		direction: z.enum(["up", "down"]).optional(),
		selector: z.string().min(1).optional(),
	}),
	z.object({
		type: z.literal("screenshot"),
		fullPage: z.boolean().optional(),
		// Unbounded on purpose: the vendored contract types quality as a plain
		// integer (bounds are prose only). Invalid values fail at the browser
		// layer like the real API, not with a 400 here.
		quality: z.number().int().optional(),
		viewport: z
			.object({
				width: z.number().int(),
				height: z.number().int(),
			})
			.optional(),
	}),
	// Accepted-and-warn from here down.
	z.object({
		type: z.literal("pdf"),
		format: z
			.enum([
				"A0",
				"A1",
				"A2",
				"A3",
				"A4",
				"A5",
				"A6",
				"Letter",
				"Legal",
				"Tabloid",
				"Ledger",
			])
			.optional(),
		landscape: z.boolean().optional(),
		scale: z.number().optional(),
	}),
	z.object({
		type: z.literal("executeJavascript"),
		script: z.string(),
	}),
	z.object({
		type: z.literal("scrape"),
	}),
]);

export type ClickAction = { type: "click"; selector: string; all?: boolean };
export type WriteAction = { type: "write"; text: string };
export type PressAction = { type: "press"; key: string };
export type ScrollAction = {
	type: "scroll";
	direction?: "up" | "down";
	selector?: string;
};
export type ScreenshotAction = {
	type: "screenshot";
	fullPage?: boolean;
	quality?: number;
	viewport?: { width: number; height: number };
};

export type ExecutableAction =
	| { type: "wait"; milliseconds: number }
	| { type: "wait"; selector: string }
	| ClickAction
	| WriteAction
	| PressAction
	| ScrollAction
	| ScreenshotAction;

export type ScrapeAction =
	| ExecutableAction
	| { type: "pdf"; format?: string; landscape?: boolean; scale?: number }
	| { type: "executeJavascript"; script: string }
	| { type: "scrape" };

const EXECUTABLE_ACTION_TYPES = [
	"wait",
	"click",
	"write",
	"press",
	"scroll",
	"screenshot",
] as const;

const UNIMPLEMENTED_ACTIONS = ["pdf", "executeJavascript", "scrape"] as const;

export interface ActionPlan {
	executable: ExecutableAction[];
	warnings: string[];
}

// Splits a validated actions array: the executable types flow to the page
// runner, the rest become deduped warnings (dedupe matches the format
// convention in normalizeFormats). Input is deliberately `unknown[]`: the
// strictNullChecks-off zod inference types the route's validated body loosely,
// and chanfana has already enforced the schema by the time this runs.
export function filterExecutableActions(
	actions: readonly unknown[] | undefined,
): ActionPlan {
	const executable: ExecutableAction[] = [];
	const warnings: string[] = [];
	const warnOnce = (warning: string) => {
		if (!warnings.includes(warning)) {
			warnings.push(warning);
		}
	};

	for (const action of actions ?? []) {
		const type = (action as { type?: unknown })?.type;
		if (typeof type !== "string") {
			continue;
		}
		if ((EXECUTABLE_ACTION_TYPES as readonly string[]).includes(type)) {
			executable.push(action as ExecutableAction);
			continue;
		}
		if ((UNIMPLEMENTED_ACTIONS as readonly string[]).includes(type)) {
			warnOnce(`action ${type} is not supported by this deployment`);
		}
		// Anything else was rejected by request validation.
	}

	return { executable, warnings };
}

export interface ActionResult {
	screenshots: string[];
}

export interface RunActionOptions {
	timeout?: number;
}

const DEFAULT_SELECTOR_TIMEOUT_MS = 30000;

// Executes the action list strictly in order on the live page. A throwing
// action (missing click target, selector timeout) rejects the promise — the
// caller maps that to its own error envelope. Only screenshot actions produce
// output: base64 strings, in encounter order.
export async function runScrapeActions(
	page: Page,
	actions: ExecutableAction[],
	options?: RunActionOptions,
): Promise<ActionResult> {
	const screenshots: string[] = [];
	const selectorTimeout = options?.timeout ?? DEFAULT_SELECTOR_TIMEOUT_MS;

	for (const action of actions) {
		switch (action.type) {
			case "wait": {
				if ("milliseconds" in action) {
					await page.waitForTimeout(action.milliseconds);
				} else {
					await page.waitForSelector(action.selector, {
						timeout: selectorTimeout,
					});
				}
				break;
			}
			case "click": {
				if (action.all === true) {
					const handles = await page.$$(action.selector);
					for (const handle of handles) {
						await handle.click();
					}
				} else {
					await page.click(action.selector);
				}
				break;
			}
			case "write": {
				await page.keyboard.type(action.text);
				break;
			}
			case "press": {
				await page.keyboard.press(
					action.key as Parameters<typeof page.keyboard.press>[0],
				);
				break;
			}
			case "scroll": {
				const direction = action.direction ?? "down";
				if (action.selector !== undefined) {
					await page.evaluate(
						(selector: string, dir: string) => {
							const el = document.querySelector<HTMLElement>(selector);
							if (el === null) {
								throw new Error(`scroll selector not found: ${selector}`);
							}
							el.scrollTop += dir === "up" ? -el.clientHeight : el.clientHeight;
						},
						action.selector,
						direction,
					);
				} else {
					await page.evaluate((dir: string) => {
						window.scrollBy(
							0,
							dir === "up" ? -window.innerHeight : window.innerHeight,
						);
					}, direction);
				}
				break;
			}
			case "screenshot": {
				if (action.viewport !== undefined) {
					await page.setViewport({ ...action.viewport });
				}
				screenshots.push(
					await page.screenshot({
						encoding: "base64",
						fullPage: action.fullPage ?? false,
						// PNG rejects `quality`; only JPEG accepts it.
						...(action.quality !== undefined && {
							type: "jpeg" as const,
							quality: action.quality,
						}),
					}),
				);
				break;
			}
		}
	}

	return { screenshots };
}
