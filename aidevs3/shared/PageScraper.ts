import { RequestService } from './RequestService';
import { CacheService } from './CacheService';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

export interface Page {
    url: string;
    markdown: string;
    html: string;
    links: string[];
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

    private cleanHtml(html: string): string {
        const dom = new JSDOM(html);
        const document = dom.window.document;

        // Remove elements with inline style display: none
        document.querySelectorAll('[style*="display: none"]').forEach(el => el.remove());

        // Remove elements with the hidden attribute
        document.querySelectorAll('[hidden]').forEach(el => el.remove());

        // Remove elements with specific classes that might contain hidden content
        document.querySelectorAll('.hidden, .invisible, .collapsed, [class*="hidden"]').forEach(el => el.remove());

        // Remove HTML comments using TreeWalker
        const walker = document.createTreeWalker(
            document.body,
            dom.window.NodeFilter.SHOW_COMMENT,
            null
        );
        const comments: Comment[] = [];
        let node;
        while (node = walker.nextNode()) {
            comments.push(node as Comment);
        }
        comments.forEach(comment => comment.remove());

        // Get the cleaned HTML and remove any remaining JS-style comments
        const cleanedHtml = document.body.innerHTML;
        return cleanedHtml
            .replace(/\/\/-->/g, '')          // Remove JS-style comment endings
            .replace(/\/\/.*$/gm, '');        // Remove single-line JS comments
    }

    private extractLinksFromHtml(html: string): string[] {
        const dom = new JSDOM(html);
        const document = dom.window.document;
        const links = new Set<string>();

        // Get all anchor tags
        document.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href');
            // Only include relative URLs (sub-pages) and exclude main page
            if (href && 
                !href.startsWith('#') && 
                !href.startsWith('javascript:') && 
                !href.startsWith('http') && 
                href !== '/') {
                links.add(href);
            }
        });

        return Array.from(links);
    }

    async scrapePage(url: string): Promise<Page> {
        const html = await this.requestService.getText(url);
        const cleanedHtml = await this.cacheService.getOrFetch(this.getCacheKey(url, 'html'), async () => {
            return this.cleanHtml(html);
        });
        
        const links = await this.cacheService.getOrFetch(this.getCacheKey(url, 'links'), async () => {
            const extractedLinks = this.extractLinksFromHtml(cleanedHtml);
            return JSON.stringify(extractedLinks);
        }).then(cachedLinks => JSON.parse(cachedLinks) as string[]);
        
        const markdown = await this.cacheService.getOrFetch(this.getCacheKey(url, 'md'), async () => {
            return this.nhm.translate(cleanedHtml);
        });

        return {
            url,
            markdown,
            html: cleanedHtml,
            links
        };
    }
} 