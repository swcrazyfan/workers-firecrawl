import { describe, expect, it } from "vitest";
import {
	normalizeJsonSchema,
	validateAgainstSchema,
} from "../../src/ai/schema";

function normalized(schema: Record<string, unknown>) {
	return normalizeJsonSchema(schema).schema;
}

describe("normalizeJsonSchema", () => {
	it("strips unsupported keywords recursively", () => {
		const result = normalized({
			type: "object",
			properties: {
				price: {
					type: "number",
					minimum: 0,
					maximum: 100,
					default: 1,
					examples: [3],
					$comment: "ignore me",
				},
				name: {
					type: "string",
					pattern: "^a",
					minLength: 1,
					maxLength: 10,
					format: "email",
				},
			},
		});

		const properties = result.properties as Record<
			string,
			Record<string, unknown>
		>;
		expect(properties.price).toEqual({ type: "number" });
		expect(properties.name).toEqual({ type: "string" });
	});

	it("forces additionalProperties false and every property required", () => {
		const result = normalized({
			type: "object",
			properties: {
				a: { type: "string" },
				b: { type: "number" },
			},
			required: ["a"],
		});
		expect(result.additionalProperties).toBe(false);
		expect(result.required).toEqual(["a", "b"]);
	});

	it("treats a properties-only node as an object", () => {
		const result = normalized({
			properties: { a: { type: "string" } },
		});
		expect(result.type).toBe("object");
		expect(result.additionalProperties).toBe(false);
		expect(result.required).toEqual(["a"]);
	});

	it("preserves nullable object type unions", () => {
		const result = normalized({
			type: ["object", "null"],
			properties: { a: { type: "string" } },
		});
		expect(result.type).toEqual(["object", "null"]);
		expect(result.required).toEqual(["a"]);
	});

	it("wraps a bare array schema as a required items object", () => {
		const result = normalized({
			type: "array",
			items: { type: "string" },
		});
		expect(result.type).toBe("object");
		expect(result.additionalProperties).toBe(false);
		expect(result.required).toEqual(["items"]);
		expect(result.properties).toEqual({
			items: { type: "array", items: { type: "string" } },
		});
	});

	it("resolves local $refs", () => {
		const result = normalized({
			type: "object",
			properties: { price: { $ref: "#/$defs/Price" } },
			$defs: { Price: { type: "number" } },
		});
		const properties = result.properties as Record<string, unknown>;
		expect(properties.price).toEqual({ type: "number" });
	});

	it("resolves a $ref through a nested pointer", () => {
		const result = normalized({
			type: "object",
			properties: { a: { $ref: "#/definitions/Inner" } },
			definitions: { Inner: { type: "object", properties: { b: { type: "string" } } } },
		});
		const properties = result.properties as Record<string, Record<string, unknown>>;
		expect(properties.a.type).toBe("object");
		expect(properties.a.required).toEqual(["b"]);
	});

	it("leaves an unresolvable $ref in place and warns", () => {
		const { schema, warnings } = normalizeJsonSchema({
			type: "object",
			properties: { a: { $ref: "#/$defs/Missing" } },
		});
		const properties = schema.properties as Record<string, unknown>;
		expect(properties.a).toEqual({ $ref: "#/$defs/Missing" });
		expect(warnings.some((warning) => warning.includes("unresolved $ref"))).toBe(
			true,
		);
	});

	it("caps recursive $ref depth and warns", () => {
		const { schema, warnings } = normalizeJsonSchema({
			type: "object",
			properties: { self: { $ref: "#/$defs/Node" } },
			$defs: { Node: { $ref: "#/$defs/Node" } },
		});
		expect(warnings.length).toBeGreaterThan(0);
		expect(
			warnings.some(
				(warning) =>
					warning.includes("cyclic") || warning.includes("depth cap"),
			),
		).toBe(true);
		// The self-referential property is left as a $ref rather than looping.
		expect((schema.properties as Record<string, unknown>).self).toBeDefined();
	});

	it("never mutates the input", () => {
		const input = {
			type: "object",
			properties: { price: { type: "number", minimum: 0 } },
			required: [],
		};
		const snapshot = JSON.parse(JSON.stringify(input));
		normalizeJsonSchema(input);
		expect(input).toEqual(snapshot);
	});

	it("keeps enum and const values untouched", () => {
		const result = normalized({
			type: "object",
			properties: {
				status: { type: "string", enum: ["a", "b"], const: "a" },
			},
		});
		const status = (result.properties as Record<string, Record<string, unknown>>)
			.status;
		expect(status.enum).toEqual(["a", "b"]);
		expect(status.const).toBe("a");
	});
});

describe("validateAgainstSchema", () => {
	it("accepts a valid object", () => {
		const result = validateAgainstSchema(
			{ price: 3, name: "Widget" },
			{
				type: "object",
				properties: {
					price: { type: "number" },
					name: { type: "string" },
				},
				required: ["price", "name"],
			},
		);
		expect(result).toEqual({ ok: true });
	});

	it("reports a type mismatch with a readable path", () => {
		const result = validateAgainstSchema(
			{ price: "abc" },
			{
				type: "object",
				properties: { price: { type: "number" } },
				required: ["price"],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0]).toBe("$.price: expected number, got string");
		}
	});

	it("reports missing required properties", () => {
		const result = validateAgainstSchema(
			{},
			{
				type: "object",
				properties: { price: { type: "number" } },
				required: ["price"],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0]).toContain("$.price");
			expect(result.errors[0]).toContain("required");
		}
	});

	it("supports string/null unions", () => {
		const schema = {
			type: "object",
			properties: { name: { type: ["string", "null"] } },
			required: ["name"],
		} as const;
		expect(validateAgainstSchema({ name: null }, schema as never).ok).toBe(true);
		expect(validateAgainstSchema({ name: "x" }, schema as never).ok).toBe(true);
		const bad = validateAgainstSchema({ name: 5 }, schema as never);
		expect(bad.ok).toBe(false);
	});

	it("enforces enum membership", () => {
		const schema = {
			type: "object",
			properties: { status: { type: "string", enum: ["a", "b"] } },
			required: ["status"],
		};
		expect(validateAgainstSchema({ status: "a" }, schema).ok).toBe(true);
		const bad = validateAgainstSchema({ status: "c" }, schema);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.errors[0]).toContain("enum");
	});

	it("validates nested objects and arrays", () => {
		const schema = {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: { sku: { type: "string" } },
						required: ["sku"],
					},
				},
			},
			required: ["items"],
		};
		expect(
			validateAgainstSchema({ items: [{ sku: "x" }] }, schema).ok,
		).toBe(true);
		const bad = validateAgainstSchema({ items: [{ sku: 7 }] }, schema);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.errors[0]).toBe("$.items[0].sku: expected string, got integer");
	});

	it("accepts anyOf when at least one branch passes", () => {
		const schema = {
			type: "object",
			properties: {
				value: { anyOf: [{ type: "string" }, { type: "number" }] },
			},
			required: ["value"],
		};
		expect(validateAgainstSchema({ value: 4 }, schema).ok).toBe(true);
		const bad = validateAgainstSchema({ value: true }, schema);
		expect(bad.ok).toBe(false);
	});

	it("accepts oneOf when at least one branch passes", () => {
		const schema = {
			type: "object",
			properties: { value: { oneOf: [{ type: "boolean" }] } },
			required: ["value"],
		};
		expect(validateAgainstSchema({ value: true }, schema).ok).toBe(true);
	});

	it("does not throw on a malformed schema", () => {
		expect(() => validateAgainstSchema({ a: 1 }, null as never)).not.toThrow();
		expect(validateAgainstSchema({ a: 1 }, null as never).ok).toBe(false);
		expect(() =>
			validateAgainstSchema({ a: 1 }, { type: "object", properties: 42 }),
		).not.toThrow();
	});
});