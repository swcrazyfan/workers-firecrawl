import { describe, expect, it } from "vitest";
import { buildDomainQuery, klFrom, mapTbs } from "../../src/search/params";

describe("search/params", () => {
	describe("mapTbs", () => {
		it("maps qdr:d", () => {
			expect(mapTbs("qdr:d")).toEqual({ df: "d", timeRange: "day", warnings: [] });
		});

		it("maps qdr:w", () => {
			expect(mapTbs("qdr:w")).toEqual({ df: "w", timeRange: "week", warnings: [] });
		});

		it("maps qdr:m", () => {
			expect(mapTbs("qdr:m")).toEqual({ df: "m", timeRange: "month", warnings: [] });
		});

		it("maps qdr:y", () => {
			expect(mapTbs("qdr:y")).toEqual({ df: "y", timeRange: "year", warnings: [] });
		});

		it("maps qdr:h to day with warning", () => {
			expect(mapTbs("qdr:h")).toEqual({
				df: "d",
				timeRange: "day",
				warnings: ["qdr:h unsupported, using day"],
			});
		});

		it("parses cdr custom date range with ISO reorder and warning", () => {
			const result = mapTbs("cdr:1,cd_min:09/01/2026,cd_max:09/15/2026");
			expect(result.df).toBe("2026-09-01..2026-09-15");
			expect(result.timeRange).toBe("week");
			expect(result.warnings).toContain("custom date range approximated for time_range");
		});

		it("approximates timeRange from cdr span", () => {
			expect(
				mapTbs("cdr:1,cd_min:09/01/2026,cd_max:09/02/2026").timeRange,
			).toBe("day");
			expect(
				mapTbs("cdr:1,cd_min:09/01/2026,cd_max:09/10/2026").timeRange,
			).toBe("week");
			expect(
				mapTbs("cdr:1,cd_min:09/01/2026,cd_max:10/15/2026").timeRange,
			).toBe("month");
			expect(
				mapTbs("cdr:1,cd_min:01/01/2026,cd_max:12/31/2026").timeRange,
			).toBe("year");
		});

		it("passes through bare tokens", () => {
			expect(mapTbs("d")).toEqual({ df: "d", timeRange: "day", warnings: [] });
			expect(mapTbs("w")).toEqual({ df: "w", timeRange: "week", warnings: [] });
			expect(mapTbs("m")).toEqual({ df: "m", timeRange: "month", warnings: [] });
			expect(mapTbs("y")).toEqual({ df: "y", timeRange: "year", warnings: [] });
			expect(mapTbs("day")).toEqual({ df: "d", timeRange: "day", warnings: [] });
			expect(mapTbs("week")).toEqual({ df: "w", timeRange: "week", warnings: [] });
			expect(mapTbs("month")).toEqual({ df: "m", timeRange: "month", warnings: [] });
			expect(mapTbs("year")).toEqual({ df: "y", timeRange: "year", warnings: [] });
		});

		it("drops sbd:1 with warning", () => {
			expect(mapTbs("sbd:1")).toEqual({
				warnings: ["sbd:1 sort-by-date unsupported"],
			});
		});

		it("drops unrecognized input with warning", () => {
			expect(mapTbs("foo:bar")).toEqual({
				warnings: ['tbs "foo:bar" not recognized'],
			});
		});

		it("returns empty object for undefined input", () => {
			expect(mapTbs(undefined)).toEqual({ warnings: [] });
		});

		it("returns empty object for empty string", () => {
			expect(mapTbs("")).toEqual({ warnings: [] });
		});
	});

	describe("klFrom", () => {
		it("fixes Mexico to mx-es", () => {
			expect(klFrom({ location: "Mexico" })).toBe("mx-es");
			expect(klFrom({ country: "MX", lang: "es" })).toBe("mx-es");
			expect(klFrom({ country: "mx" })).toBe("mx-es");
		});

		it("fixes United Kingdom to uk-en", () => {
			expect(klFrom({ location: "United Kingdom" })).toBe("uk-en");
			expect(klFrom({ country: "GB", lang: "en" })).toBe("uk-en");
			expect(klFrom({ country: "gb" })).toBe("uk-en");
		});

		it("fixes Germany to de-de", () => {
			expect(klFrom({ location: "Germany" })).toBe("de-de");
			expect(klFrom({ country: "DE", lang: "de" })).toBe("de-de");
			expect(klFrom({ country: "de" })).toBe("de-de");
		});

		it("fixes Japan to jp-jp", () => {
			expect(klFrom({ location: "Japan" })).toBe("jp-jp");
			expect(klFrom({ country: "JP", lang: "ja" })).toBe("jp-jp");
			expect(klFrom({ country: "jp" })).toBe("jp-jp");
		});

		it("fixes Brazil to br-pt", () => {
			expect(klFrom({ location: "Brazil" })).toBe("br-pt");
			expect(klFrom({ country: "BR", lang: "pt" })).toBe("br-pt");
			expect(klFrom({ country: "br" })).toBe("br-pt");
		});

		it("is case-insensitive", () => {
			expect(klFrom({ country: "mX", lang: "ES" })).toBe("mx-es");
			expect(klFrom({ location: "GERMANY" })).toBe("de-de");
		});

		it("does not substring-match locations", () => {
			expect(klFrom({ location: "Russia" })).toBe("ru-ru");
		});

		it("rejects short location strings", () => {
			expect(klFrom({ location: "us" })).toBe("us-en"); // falls through to default
			expect(klFrom({ location: "U" })).toBe("us-en");
		});

		it("rejects invalid characters in location", () => {
			expect(klFrom({ location: "us123" })).toBe("us-en");
			expect(klFrom({ location: "united states!" })).toBe("us-en"); // falls back
		});

		it("falls back to country-only when lang is unknown", () => {
			expect(klFrom({ country: "DE", lang: "xx" })).toBe("de-de");
		});

		it("falls back to lang-only when country is unknown", () => {
			expect(klFrom({ country: "XX", lang: "fr" })).toBe("fr-fr");
		});

		it("falls back to default when both unknown", () => {
			expect(klFrom({ country: "XX", lang: "xx" })).toBe("us-en");
		});

		it("falls back to default for empty input", () => {
			expect(klFrom({})).toBe("us-en");
		});
	});

	describe("buildDomainQuery", () => {
		it("appends OR-joined include domains", () => {
			expect(
				buildDomainQuery("test", {
					includeDomains: ["a.com", "b.com"],
				}),
			).toBe("test site:a.com OR site:b.com");
		});

		it("appends exclude domains", () => {
			expect(
				buildDomainQuery("test", {
					excludeDomains: ["x.com", "y.com"],
				}),
			).toBe("test -site:x.com -site:y.com");
		});

		it("handles include and exclude together", () => {
			expect(
				buildDomainQuery("test", {
					includeDomains: ["a.com"],
					excludeDomains: ["x.com"],
				}),
			).toBe("test site:a.com -site:x.com");
		});

		it("returns original query when both empty", () => {
			expect(buildDomainQuery("test", {})).toBe("test");
			expect(
				buildDomainQuery("test", { includeDomains: [], excludeDomains: [] }),
			).toBe("test");
		});
	});
});
