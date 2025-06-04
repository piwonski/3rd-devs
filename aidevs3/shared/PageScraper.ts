import { RequestService } from './RequestService';
import { CacheService } from './CacheService';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

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
        const cleanedHtml = document.documentElement.outerHTML
            // .replace(/\/\/-->/g, '')          // Remove JS-style comment endings
            // .replace(/\/\/.*$/gm, '')         // Remove single-line JS comments
            // .replace(/\n\s*\n/g, '\n')        // Remove multiple empty lines
            // .trim();                          // Remove leading/trailing whitespace

        return cleanedHtml;
    }

    private extractLinksFromHtml(html: string, baseUrl: string): Link[] {
        const dom = new JSDOM(html);
        const document = dom.window.document;
        const baseUrlObj = new URL(baseUrl);
        const links = new Set<Link>();

        // Remove hidden elements before extracting links
        document.querySelectorAll('[style*="display: none"], [hidden], .hidden, .invisible, .collapsed, [class*="hidden"]')
            .forEach(el => el.remove());

        // Get all anchor tags
        const allAnchors = document.querySelectorAll('a[href]');
        console.log('Found anchors:', allAnchors.length);
        
        allAnchors.forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (!href) return;

            // Get text content, handling nested elements
            let text = '';
            const textNodes = Array.from(anchor.childNodes)
                .filter(node => node.nodeType === dom.window.Node.TEXT_NODE)
                .map(node => node.textContent?.trim())
                .filter(Boolean);
            text = textNodes.join(' ').trim() || href;
            
            const title = anchor.getAttribute('title')?.trim();
            
            console.log('Found link:', { href, text, title, outerHTML: anchor.outerHTML });
            
            // Skip unwanted links
            if (href === '/' || href.startsWith('#') || href.startsWith('javascript:')) {
                console.log('Skipping unwanted link:', href);
                return;
            }

            try {
                const fullUrl = new URL(href, baseUrl);
                // Include both internal and external links
                console.log('Adding link:', { href: fullUrl.toString(), text, title });
                links.add({ 
                    href: fullUrl.toString(),  // Use full URL for external links
                    text, 
                    title 
                });
            } catch (e) {
                console.warn('Invalid URL:', href);
            }
        });
        
        const result = Array.from(links);
        console.log('Final links:', result);
        return result;
    }

    async scrapePage(url: string): Promise<Page> {
        const html = await this.requestService.getText(url);
        
        const links = await this.cacheService.getOrFetch(this.getCacheKey(url, 'links'), async () => {
            const extractedLinks = this.extractLinksFromHtml(html, url);
            return JSON.stringify(extractedLinks);
        }).then(cachedLinks => JSON.parse(cachedLinks) as Link[]);
        
        const cleanedHtml = await this.cacheService.getOrFetch(this.getCacheKey(url, 'html'), async () => {
            return this.cleanHtml(html);
        });
        
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