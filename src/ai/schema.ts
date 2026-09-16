// Dependency-light JSON Schema handling for the extraction pipeline. These
// helpers implement only the subset the pipeline emits and validates; unknown
// keywords are ignored rather than rejected.

const UNSUPPORTED_KEYWORDS = new Set([
	"default",
	"pattern",
	"format",
	"minItems",
	"maxItems",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"uniqueItems",
	"patternProperties",
	"unevaluatedProperties",
	"$comment",
	"examples",
]);

// Keys whose values are data, not subschemas, so they must not be walked.
const OPAQUE_KEYWORDS = new Set([
	"required",
	"enum",
	"const",
	"type",
	"additionalProperties",
]);

const MAX_REF_DEPTH = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => cloneValue(item));
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = cloneValue(item);
		}
		return out;
	}
	return value;
}

function decodePointerToken(token: string): string {
	return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(root: Record<string, unknown>, ref: string): unknown {
	if (!ref.startsWith("#")) return undefined;
	const pointer = ref.slice(1);
	if (pointer === "" || pointer === "/") return root;

	const tokens = pointer.replace(/^\//, "").split("/").map(decodePointerToken);

	let current: unknown = root;
	for (const token of tokens) {
		if (Array.isArray(current)) {
			const index = Number(token);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) {
				return undefined;
			}
			current = current[index];
			continue;
		}
		if (isPlainObject(current)) {
			if (!(token in current)) return undefined;
			current = current[token];
			continue;
		}
		return undefined;
	}
	return current;
}

function isObjectNode(node: Record<string, unknown>): boolean {
	if (node.type === "object") return true;
	if (isPlainObject(node.properties)) return true;
	return Array.isArray(node.type) && node.type.includes("object");
}

function normalizeRefNode(
	node: Record<string, unknown>,
	root: Record<string, unknown>,
	refDepth: number,
	visited: Set<string>,
	warnings: string[],
): Record<string, unknown> {
	const ref = node.$ref as string;

	if (refDepth >= MAX_REF_DEPTH) {
		warnings.push(`$ref depth cap reached at ${ref}`);
		return { ...node };
	}
	if (visited.has(ref)) {
		warnings.push(`cyclic $ref: ${ref}`);
		return { ...node };
	}

	const target = resolvePointer(root, ref);
	if (target === undefined) {
		warnings.push(`unresolved $ref: ${ref}`);
		return { ...node };
	}

	const nextVisited = new Set(visited);
	nextVisited.add(ref);
	return normalizeNode(
		cloneValue(target),
		root,
		refDepth + 1,
		nextVisited,
		warnings,
	) as Record<string, unknown>;
}

function normalizeNode(
	value: unknown,
	root: Record<string, unknown>,
	refDepth: number,
	visited: Set<string>,
	warnings: string[],
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) =>
			normalizeNode(item, root, refDepth, visited, warnings),
		);
	}
	if (!isPlainObject(value)) return value;

	if (typeof value.$ref === "string") {
		return normalizeRefNode(value, root, refDepth, visited, warnings);
	}

	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (UNSUPPORTED_KEYWORDS.has(key)) continue;
		if (OPAQUE_KEYWORDS.has(key)) {
			out[key] = cloneValue(child);
			continue;
		}
		out[key] = normalizeNode(child, root, refDepth, visited, warnings);
	}

	if (isObjectNode(out)) {
		out.additionalProperties = false;
		const properties = isPlainObject(out.properties) ? out.properties : {};
		out.required = Object.keys(properties);
		if (out.type === undefined) out.type = "object";
	}

	return out;
}

export function normalizeJsonSchema(schema: Record<string, unknown>): {
	schema: Record<string, unknown>;
	warnings: string[];
} {
	const warnings: string[] = [];
	const source = cloneValue(schema) as Record<string, unknown>;

	// Local `$ref`s are resolved against the original structure, before any
	// root wrapping moves nodes around.
	const root: Record<string, unknown> =
		source.type === "array"
			? {
					type: "object",
					properties: { items: source },
					required: ["items"],
					additionalProperties: false,
				}
			: source;

	const normalized = normalizeNode(
		root,
		source,
		0,
		new Set(),
		warnings,
	) as Record<string, unknown>;
	return { schema: normalized, warnings };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function actualType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "number";
	}
	return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
	switch (expected) {
		case "null":
			return value === null;
		case "array":
			return Array.isArray(value);
		case "object":
			return isPlainObject(value);
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		default:
			// Unknown type keywords are ignored.
			return true;
	}
}

function deepEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return false;
	if (typeof left === "object") {
		try {
			return JSON.stringify(left) === JSON.stringify(right);
		} catch {
			return false;
		}
	}
	return false;
}

function validateNode(
	value: unknown,
	schema: Record<string, unknown>,
	path: string,
	errors: string[],
): void {
	const rawType = schema.type;
	if (rawType !== undefined) {
		const expected = Array.isArray(rawType) ? rawType : [rawType];
		const valid = expected.some(
			(entry) => typeof entry === "string" && matchesType(value, entry),
		);
		if (!valid) {
			errors.push(
				`${path}: expected ${expected.join(" | ")}, got ${actualType(value)}`,
			);
			return;
		}
	}

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		if (!schema.enum.some((entry) => deepEqual(entry, value))) {
			errors.push(`${path}: value not in enum`);
		}
	}

	for (const keyword of ["anyOf", "oneOf"] as const) {
		const branches = schema[keyword];
		if (!Array.isArray(branches) || branches.length === 0) continue;
		const passed = branches.some((branch) => {
			if (!isPlainObject(branch)) return false;
			const branchErrors: string[] = [];
			validateNode(value, branch, path, branchErrors);
			return branchErrors.length === 0;
		});
		if (!passed) errors.push(`${path}: does not match ${keyword}`);
	}

	if (isPlainObject(value)) {
		if (Array.isArray(schema.required)) {
			for (const key of schema.required) {
				if (typeof key === "string" && !(key in value)) {
					errors.push(`${path}.${key}: required property missing`);
				}
			}
		}
		if (isPlainObject(schema.properties)) {
			for (const [key, child] of Object.entries(schema.properties)) {
				if (key in value && isPlainObject(child)) {
					validateNode(value[key], child, `${path}.${key}`, errors);
				}
			}
		}
	}

	if (Array.isArray(value) && schema.items !== undefined) {
		if (Array.isArray(schema.items)) {
			schema.items.forEach((child, index) => {
				if (index < value.length && isPlainObject(child)) {
					validateNode(value[index], child, `${path}[${index}]`, errors);
				}
			});
		} else if (isPlainObject(schema.items)) {
			value.forEach((item, index) => {
				validateNode(
					item,
					schema.items as Record<string, unknown>,
					`${path}[${index}]`,
					errors,
				);
			});
		}
	}
}

export function validateAgainstSchema(
	value: unknown,
	schema: Record<string, unknown>,
): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	try {
		if (!isPlainObject(schema)) {
			return { ok: false, errors: ["schema must be an object"] };
		}
		validateNode(value, schema, "$", errors);
	} catch (error) {
		return {
			ok: false,
			errors: [`invalid schema: ${(error as Error).message}`],
		};
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
