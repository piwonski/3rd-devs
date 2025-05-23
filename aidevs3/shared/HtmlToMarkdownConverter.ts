import TurndownService from "turndown";

export class HtmlToMarkdownConverter {
    private turndownService: TurndownService;
    private baseUrl: string;

    constructor(baseUrl: string = 'https://c3ntrala.ag3nts.org/dane') {
        this.baseUrl = baseUrl;
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            bulletListMarker: '-',
            strongDelimiter: '**',
            linkStyle: 'inlined',
            hr: '---'
        });
    }

    private convertToAbsoluteUrl(url: string): string {
        if (url.startsWith('http')) return url;
        return url.startsWith('/') ? `${this.baseUrl}${url}` : `${this.baseUrl}/${url}`;
    }

    private cleanHtml(html: string): string {
        // Remove style elements and their contents
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        // Remove HTML comments
        html = html.replace(/<!--[\s\S]*?-->/g, '');
        
        // Handle image sources
        html = html.replace(/<img[^>]+src="([^"]+)"[^>]*>/g, (match, src) => {
            const absoluteSrc = this.convertToAbsoluteUrl(src);
            return match.replace(src, absoluteSrc);
        });
        
        // Handle links
        html = html.replace(/<a[^>]+href="([^"]+)"[^>]*>/g, (match, href) => {
            const absoluteHref = this.convertToAbsoluteUrl(href);
            return match.replace(href, absoluteHref);
        });
        
        return html;
    }

    public async convert(html: string): Promise<string> {
        const cleanedHtml = this.cleanHtml(html);
        return this.turndownService.turndown(cleanedHtml);
    }
}