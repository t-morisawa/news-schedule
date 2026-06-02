export type SourceId = "hackernews" | "zenn" | "devto" | "qiita" | "reddit";

export type Article = Readonly<{
  source: SourceId;
  title: string;
  url: string;
  author?: string;
  points?: number;
  comments?: number;
  publishedAt?: string;
  tags?: ReadonlyArray<string>;
  excerpt?: string;
  bodyText?: string;
}>;

export type SourceResult = Readonly<{
  source: SourceId;
  label: string;
  url: string;
  articles: ReadonlyArray<Article>;
  error?: string;
}>;
