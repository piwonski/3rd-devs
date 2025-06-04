import { RequestService } from './RequestService';
import { CacheService } from './CacheService';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { JSDOM } from 'jsdom';

export interface Link {
    href: string;
    text: string;
    title?: string;
}

export interface Page {
    url: string;
    markdown: string;
    html: string;
    links: Link[];
}

export class PageScraper {
    private readonly requestService: RequestService;
    private readonly cacheService: CacheService;
    private readonly nhm: NodeHtmlMarkdown;

    constructor(requestService: RequestService, cacheService: CacheService) {
        this.requestService = requestService;
        this.cacheService = cacheService;
        this.nhm = new NodeHtmlMarkdown({
            ignore: ['script', 'style', 'noscript', 'head', 'meta', 'link']
        });
    }

    private getCacheKey(url: string, extension: string = 'md'): string {
        return url
            .replace(/^https?:\/\//, '')  // Remove protocol
            .replace(/[^a-zA-Z0-9.-]/g, '_')  // Replace any non-alphanumeric chars with underscore
            .replace(/_+/g, '_')  // Replace multiple underscores with single one
            .replace(/^_|_$/g, '')  // Remove leading/trailing underscores
            + '.' + extension;
    }

    private extractLinksFromHtml(html: string, baseUrl: string): Link[] {
        const dom = new JSDOM(html);
        const links: Link[] = [];
        
        dom.window.document.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                const fullUrl = new URL(href, baseUrl).toString();
                // Skip if the link is equal to the base URL
                if (fullUrl !== baseUrl) {
                    links.push({
                        href: fullUrl,
                        text: anchor.textContent?.trim() || '',
                        title: anchor.getAttribute('title') || undefined
                    });
                }
            }
        });
        
        return links;
    }

    async scrapePage(url: string): Promise<Page> {
        const html = await this.requestService.getText(url);
        
        const links = await this.cacheService.getOrFetch(this.getCacheKey(url, 'links'), async () => {
            const extractedLinks = this.extractLinksFromHtml(html, url);
            return JSON.stringify(extractedLinks);
        }).then(cachedLinks => JSON.parse(cachedLinks) as Link[]);
        
        const markdown = await this.cacheService.getOrFetch(this.getCacheKey(url, 'md'), async () => {
            return this.nhm.translate(html);
        });

        return {
            url,
            markdown,
            html,
            links
        };
    }
} 