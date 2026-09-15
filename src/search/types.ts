import { z } from "zod";

export const webResultSchema = z.object({
	url: z.string().url(),
	title: z.string(),
	description: z.string(),
	position: z.number().int(),
});

export const newsResultSchema = z.object({
	url: z.string().url(),
	title: z.string(),
	snippet: z.string(),
	date: z.string().optional(),
	imageUrl: z.string().optional(),
	position: z.number().int(),
});

export const imageResultSchema = z.object({
	url: z.string().optional(),
	title: z.string().optional(),
	imageUrl: z.string().url(),
	imageWidth: z.number().int().optional(),
	imageHeight: z.number().int().optional(),
	position: z.number().int(),
});

export type WebResult = z.infer<typeof webResultSchema>;
export type NewsResult = z.infer<typeof newsResultSchema>;
export type ImageResult = z.infer<typeof imageResultSchema>;

export interface SearchResults {
	web?: WebResult[];
	news?: NewsResult[];
	images?: ImageResult[];
}

export interface SearchOutcome {
	results: SearchResults;
	warnings: string[];
}

export interface SearchInput {
	query: string;
	limit: number;
	sources: ("web" | "news" | "images")[];
	tbs?: string;
	lang?: string;
	country?: string;
	location?: string;
	safe?: boolean;
	includeDomains?: string[];
	excludeDomains?: string[];
}
