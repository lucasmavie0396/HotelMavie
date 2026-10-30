import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ImageResult {
  title: string;
  url: string;
  thumb: string;
  source: string | null;
  license: string | null;
  author: string | null;
}

export interface ImageSearchResponse {
  provider: 'google' | 'wikimedia';
  results: ImageResult[];
}

interface WikimediaPage {
  title: string;
  index?: number;
  imageinfo?: {
    thumburl?: string;
    mime?: string;
    descriptionurl?: string;
    extmetadata?: { LicenseShortName?: { value?: string }; Artist?: { value?: string } };
  }[];
}

interface GoogleItem {
  title?: string;
  link?: string;
  mime?: string;
  displayLink?: string;
  image?: { contextLink?: string; thumbnailLink?: string };
}

const USER_AGENT = 'MAVIE-HGest/1.0 (gestao hoteleira)';
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

function plain(value?: string) {
  return (value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

@Injectable()
export class ImageSearchService {
  constructor(private readonly config: ConfigService) {}

  get googleConfigured() {
    return Boolean(this.config.get<string>('GOOGLE_SEARCH_API_KEY') && this.config.get<string>('GOOGLE_SEARCH_CX'));
  }

  search(query: string): Promise<ImageSearchResponse> {
    return this.googleConfigured ? this.google(query) : this.wikimedia(query);
  }

  private async getJson<T>(url: string, failure: string): Promise<T> {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? String(response.status));
      }
      return (await response.json()) as T;
    } catch (error) {
      throw new BadGatewayException(`${failure}${error instanceof Error && error.message ? ` (${error.message})` : ''}`);
    }
  }

  private async google(query: string): Promise<ImageSearchResponse> {
    const pages = await Promise.all(
      [1, 11].map((start) =>
        this.getJson<{ items?: GoogleItem[] }>(
          `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({
            key: this.config.get<string>('GOOGLE_SEARCH_API_KEY')!,
            cx: this.config.get<string>('GOOGLE_SEARCH_CX')!,
            q: query,
            searchType: 'image',
            safe: 'active',
            num: '10',
            start: String(start),
          })}`,
          'A pesquisa Google nao respondeu',
        ),
      ),
    );
    const seen = new Set<string>();
    const results = pages
      .flatMap((page) => page.items ?? [])
      .filter((item) => item.link?.startsWith('https://') && (!item.mime || IMAGE_MIMES.includes(item.mime)) && !seen.has(item.link) && seen.add(item.link))
      .map((item) => ({
        title: plain(item.title) || query,
        url: item.link!,
        thumb: item.image?.thumbnailLink ?? item.link!,
        source: item.image?.contextLink ?? null,
        license: null,
        author: item.displayLink ?? null,
      }));
    return { provider: 'google', results };
  }

  private async wikimedia(query: string): Promise<ImageSearchResponse> {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrnamespace: '6',
      gsrlimit: '24',
      gsrsearch: `${query} filetype:bitmap`,
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '600',
    });
    const data = await this.getJson<{ query?: { pages?: Record<string, WikimediaPage> } }>(
      `https://commons.wikimedia.org/w/api.php?${params}`,
      'A pesquisa de imagens nao esta disponivel agora. Tenta mais tarde ou cola o link de uma imagem',
    );
    const results = Object.values(data.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((page) => ({ page, info: page.imageinfo?.[0] }))
      .filter(({ info }) => info?.thumburl && IMAGE_MIMES.includes(info.mime ?? ''))
      .map(({ page, info }) => ({
        title: page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        url: info!.thumburl!,
        thumb: info!.thumburl!,
        source: info!.descriptionurl ?? null,
        license: plain(info!.extmetadata?.LicenseShortName?.value) || null,
        author: plain(info!.extmetadata?.Artist?.value).slice(0, 80) || null,
      }));
    return { provider: 'wikimedia', results };
  }
}
